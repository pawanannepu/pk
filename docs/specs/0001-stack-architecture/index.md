# 0001. Build pk in TypeScript on Bun as one process with a typed event core

**Date**: 2026-11-21
**Status**: In Progress

## Summary

pk will be written in TypeScript and shipped as a single binary built with Bun (a fast JavaScript runtime that can compile an app into one file), so users install nothing else. Everything runs in one process. The core (agent loop, tools, permissions, providers) is a library that reports what it is doing as one ordered stream of typed events, and the full screen terminal UI, headless `pk -p` and tests all read that stream. The code lives in one repo split into small packages with strict, checked dependency rules, so a vendor SDK, the UI library or a Bun only API can never leak into the core. The UI's native library is kept in a private pk folder that only you can write to, never in the shared temp folder.

## Decision

**Chosen option**: Option 1: TypeScript on Bun, one process modular monolith with a typed event core (see [rationale.md](rationale.md#options-considered)).

pk is a strict TypeScript workspace on a pinned Bun release, compiled with `bun build --compile` into one binary per target on that target's own CI runner. The core is a set of runtime neutral packages that emit a typed event stream. The frontends (an OpenTUI full screen TUI and a headless runner) and the `cli` composition root (the one place that wires everything together) sit on top. pk-bench drives the real binary from outside.

**Implementation skills**: `opentui` (`anomalyco/opentui`, `.claude/skills/opentui/`) · `solid-js-1x-best-practices-and-api` (`doeixd/solid-skill`, `.claude/skills/solid-js-1x-best-practices-and-api/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`)

## Proposed stack

| Layer | Choice | Reason |
|---|---|---|
| Architecture pattern | Modular monolith, one process; the core is a library | The simplest thing a solo builder can build, test and debug. A local server can be layered on the same event stream later (basis: monolith first) |
| Language | TypeScript, ESM only; compiler options below | You know it, contributors know it, and the official provider SDKs are TypeScript first |
| Runtime | Bun 1.3.14 or later, one exact version pinned in root `package.json` (`packageManager`) and in CI | Runs TypeScript directly, has a built in test runner and package manager, compiles to one binary. 1.3.14 is OpenTUI's floor (basis: the installed `opentui` skill, runtime support page) |
| Packaging | `scripts/build.ts` calls `Bun.build` with `compile`, `minify: true`, no bytecode until startup is measured. Targets: `bun-darwin-arm64`, `bun-darwin-x64-baseline`, `bun-linux-x64-baseline`, `bun-linux-arm64` (glibc). Linux builds define `process.env.OPENTUI_LIBC` as `"glibc"`. `.env` and `bunfig.toml` autoloading is turned off in the compiled binary (`--no-compile-autoload-dotenv`, `--no-compile-autoload-bunfig`, or the matching `Bun.build` options; confirm the names in the pinned Bun). Output: `dist/pk-<os>-<arch>` | One binary, no runtime needed. Bun embeds OpenTUI's native library, parser worker and grammars (basis: the installed `opentui` skill, standalone executables page). Baseline x64 builds run on CPUs without AVX2 (a set of newer CPU instructions) at negligible cost for a CLI. Without autoload off, a user's project `.env` would be loaded into pk, a secrets and behavior risk. Install channels and signing belong to #29 |
| Native library location | At run time the OpenTUI native library lives in a private pk folder, `<cache>/native/<opentui version>-<library hash>/` (mode 0700, owned by you, on a path only you or root can change), never in `$TMPDIR`. Bun can only load an embedded library from a real file and reads its extraction folder (`BUN_TMPDIR`, else `TMPDIR`) once at startup, so on the interactive path a compiled `pk` replaces itself (`process.execve`, same PID) with `BUN_TMPDIR` set to that folder. Details in *Process behavior* | Bun's cache check compares only the file size, and on Linux `/tmp` is shared with a predictable name, so another local user could plant a library that pk would load. The folder works with a read only `TMPDIR` too (probes in [rationale.md](rationale.md#native-library-location-update-2026-11-21)) |
| Supported platforms | macOS 13 or later (arm64, x64); Linux glibc 2.35 or later (x64, arm64). musl and Alpine are unsupported: the binary exits with a clear message if run there | The floor is set by the CI build images below |
| Repo layout | Bun workspaces, one package per module under `packages/` (map below); conventions in *Workspace conventions* | Boundaries are explicit dependencies, not discipline |
| Interactive UI | OpenTUI with the Solid binding (`@opentui/core`, `@opentui/solid`), full screen (alternate screen). Exact version pinned (no `^` range); it is pre 1.0 and 0.9.0 removed APIs, so read the release notes before each upgrade | Built for Bun, with full screen layout, a culling ScrollBox and a list layout mode for long transcripts. Solid's fine grained updates suit token by token streaming |
| UI fallback | Ink 8 (React), only if the OpenTUI proof fails. The proof harness (`pk __tui-smoke`) is UI agnostic so an Ink hello can be run through it in about a day | Mature, but full screen would need a hand built scroll view; unverified inside a Bun binary |
| CLI parsing | commander | Subcommands (`pk login`), generated `--help`, typed, no dependencies |
| Schemas and validation | Zod 4 | One schema yields the type, runtime validation and JSON Schema (tool definitions sent to models, the published settings `$schema`) |
| Provider access | Official SDKs inside adapters: `openai` (any OpenAI compatible endpoint by `baseURL`), `@anthropic-ai/sdk` (#20). SDK clients are created with `maxRetries: 0` | SSE parsing (streamed server events) and types come for free; vendor types stop at the adapter. `provider` owns the one retry policy, so retries never stack |
| Settings | JSON files with a published JSON Schema: user `settings.json` in the config dir, project `.pk/settings.json`. Written only through `atomicWriteFile` | Native everywhere and safe to write back. Shape owned by #3 |
| Local data | Plain files: JSONL (one JSON record per line, append only) for sessions, history and cost records, written through `appendJsonl`; small JSON index files written through `atomicWriteFile` | Survives crashes and concurrent pk processes, readable and greppable, no database engine ships. Record shapes owned by #3, #22, #24 |
| Data directories | `paths()` in `env` returns `{ config, state, cache }`. macOS: all three are `~/.pk`. Linux: `$XDG_CONFIG_HOME/pk`, `$XDG_STATE_HOME/pk`, `$XDG_CACHE_HOME/pk` with the XDG defaults. `XDG_*` is ignored on macOS. `PK_HOME` set: all three are `PK_HOME` itself (flat). File and folder names (`settings.json`, `sessions/`, `history.jsonl`, `costs/`, `logs/`) are identical everywhere | Each platform's convention, one layout for code and docs. `PK_HOME` isolates tests and bench runs |
| Logging | In house JSONL logger in `env`, writing to `<state>/logs/` with rotation at a size cap. Default level `info` never logs prompts, model output or file contents. `--debug` raises the level and mirrors to stderr. Never writes to stdout | No logger threads to break the compiled binary; stdout stays clean for headless output. No telemetry, ever |
| Secret redaction | One `redact()` in `env`, applied by the logger, session writer, headless JSON writer and error formatting | The scope requires secrets absent from logs, transcripts, errors and headless JSON (#18, #24, #26), not only logs |
| Errors | Typed error classes extending `PkError` (in `env`) with a stable string `code`; thrown inside packages, caught at the loop boundary | The loop can tell a rate limit from a bad tool input from a bug and turn each into a model visible tool error or a user message |
| Cancellation | One `AbortSignal` passed through every provider call, tool run and permission wait | Esc (#15) must stop any step cleanly |
| Subprocesses | Core packages spawn with `node:child_process` (shell tool #9, git context #16, hooks #35, MCP stdio servers #36, sandbox #32) | Keeps the core free of Bun APIs |
| Threads | pk's own code starts no worker threads. OpenTUI's own embedded Tree-sitter worker is allowed. CPU heavy work (search #11) uses external processes or chunked async work | Workers are the compile time risk; OpenTUI's is already proven embedded |
| Tests | `bun test`, colocated `*.test.ts`, offline through the scripted fake provider. A `bunfig.toml` test preload registers the Solid plugin and sets `PK_HOME` to a fresh temp dir. TUI tests render in memory with `@opentui/core/testing`. Compiled binary tests are separate (`test:e2e`) | Tests run on the shipping runtime with no network, no real terminal and no access to the real home directory |
| Lint, format, types | Biome (lint plus format) and per package `tsc --noEmit` | One fast tool and one type check. #1 ships them at defaults; #2 tightens them |
| CI | GitHub Actions. `ci.yml` on every push: install with `--frozen-lockfile`, then `check` on `ubuntu-22.04` and `macos-15`. `build.yml`: each target built natively and smoke run on its own runner: `macos-15` (arm64), `macos-15-intel`, `ubuntu-22.04` (x64), `ubuntu-22.04-arm` | Native builds avoid a multi OS install and unsigned cross built macOS binaries. OpenTUI's own CI tests only macOS arm64 and Linux x64, so this is the only place the other two targets run (basis: the installed `opentui` skill). Tagged releases belong to #29 |
| Secrets | OS keychain, mechanism decided by #18 | Constraint for #18: it must work inside a Bun compiled binary on all four targets |

## Workspace conventions

- **Root**: `package.json` (workspaces `packages/*`, `version` is the single source of pk's version, scripts below), committed `bun.lock`, `bunfig.toml`, `tsconfig.base.json`, `biome.json`, `scripts/`, `.github/workflows/`.
- **Scripts**: `dev` (run `cli` from source), `build` (`scripts/build.ts`, host target by default, `--target` for one), `typecheck` (`tsc --noEmit` in every package), `lint` (Biome), `test` (`bun test`), `test:e2e` (compiled binary tests), `check` (lint, typecheck, boundary check, test).
- **Each package**: `package.json` with `"name": "@pk/<name>"`, `"private": true`, `"type": "module"`, `"exports": { ".": "./src/index.ts" }`, sibling dependencies as `"workspace:*"`; its own `tsconfig.json` extending the base. No deep imports (`@pk/x/src/...`).
- **Compiler options** (base): `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `module: "preserve"`, `moduleResolution: "bundler"`, `target: "ESNext"`, `noEmit`. Not `exactOptionalPropertyTypes` (friction with Zod's optional fields). Core packages set `"types": ["node"]`; only `cli`, `tui`, `platform` add Bun's types, so any `Bun.*` call in core fails the type check. `tui` sets `jsx: "preserve"` and `jsxImportSource` per the `opentui` skill's Solid page.
- **Solid JSX** must compile in three places, all proven by the scaffold: `dev`, `bun test` (through the preload), and `scripts/build.ts` (which registers the `@opentui/solid` Bun plugin).
- **Version**: `scripts/build.ts` injects the root `version` with `define`; `pk --version` prints it.

## Module map

Each module is a workspace package `@pk/<name>`, private (users get the binary, nothing is published to npm). `src/index.ts` is the only public entry; tests are colocated.

| Package | Owns | May depend on | Created by |
|---|---|---|---|
| `schema` | Zod schemas and types shared by everything: messages, content blocks, tool definitions, calls and results, usage, session records, settings, and the `AgentEvent` union (exact shapes: #3) | `zod` | #1 (stub) |
| `env` | `paths()`, settings load and merge, `atomicWriteFile`, `appendJsonl`, `redact()`, the logger, `PkError` | `schema` | #1 |
| `provider` | Provider interface, provider errors, the retry and backoff policy, the scripted fake provider | `schema`, `env` | #1 (stub) |
| `provider-openai` | OpenAI compatible adapter (#5) | `provider`, `schema`, `env`, `openai`, `zod` (chunk schemas, [spec 0004](../0004-provider-layer-openai-adapter/index.md)) | #1 (stub) |
| `provider-anthropic` | Anthropic native adapter (#20) | `provider`, `schema`, `env`, `@anthropic-ai/sdk` | #20 |
| `permissions` | Modes, allow and deny rules, the always ask list, a pure decision function (#7, #10) | `schema`, `env` | #1 (stub) |
| `tools` | The `Tool` interface (definition plus executor) and the built in tools (#6, #8, #9, #11, #12). Tools never ask for permission themselves | `schema`, `env` | #1 (stub) |
| `agent` | The loop, context assembly, sessions (persistence tap), compaction; emits the event stream; asks `permissions` before each tool run; declares the `AppServices` interface | `schema`, `env`, `provider`, `permissions`, `tools` | #1 (stub) |
| `tui` | OpenTUI and Solid UI: renders events, answers requests, owns slash commands (#13), reaches stores and settings only through `AppServices` | `schema`, `agent`, `env`, `@opentui/*`, `solid-js` | #1 (smoke screen only) |
| `headless` | `pk -p` runner and its text and JSON output contract (#26) | `schema`, `agent`, `env` | #1 (stub) |
| `platform` | Bun only implementations of interfaces declared by core packages | `schema`, `env`, the package whose interface it implements | when first needed |
| `cli` | The `pk` binary entry and composition root: commander, the provider registry (the only importer of adapter packages), the `Tool[]` list handed to `agent`, the `AppServices` object handed to `tui`, signals, terminal restore, the exit code table, the hidden `PK_FAKE_SCRIPT` switch | any `@pk/*` except `bench`, `commander` | #1 |
| `bench` | pk-bench (#27, #28), its own `pk-bench` command. Runs the compiled `pk` binary as a subprocess and parses its headless JSON | `schema` | #27 |

**Dependency rules** (`scripts/check-boundaries.ts`, run by `check` and CI, fails on any violation):
- It scans static imports, dynamic `import()`, `export ... from` and type only imports in every `.ts` and `.tsx` file (for example with `Bun.Transpiler` `scanImports`).
- Each package's `package.json` dependencies must equal what the table allows, for both `@pk/*` and external packages. Every import must be declared. No cycles. `cli` and `bench` never depend on each other.
- Each vendor SDK is imported only by its own adapter. `@opentui/*` and `solid-js` only by `tui`. `commander` only by `cli`.
- Core packages (`schema`, `env`, `provider*`, `permissions`, `tools`, `agent`, `headless`) never import `bun` or `bun:*` and contain no `Bun.` reference (text scan). Exception: `*.test.ts` files may import `bun:test`. Bun only APIs live in `cli`, `tui` and `platform`; a core package that needs one declares an interface that `platform` implements and `cli` injects.
- Wiring is plain constructor arguments assembled in `cli`. No dependency injection framework, no module level singletons, so tests build sessions from fakes.

## Core to frontend contract

The shape is fixed here; the exact event list and fields belong to #3 and #6.

- `agent` exposes a session object. Running a turn returns `AsyncIterable<AgentEvent>` (an ordered stream read with `for await`, which has exactly one reader) and takes an `AbortSignal`.
- Every event carries a monotonically increasing `seq` (a number that only goes up) and a `type` from the `AgentEvent` union in `schema`. #3 adds an agent id field so subagent events (#38) can be told apart.
- Every turn ends with exactly one final `turn_end` event carrying a `reason` (for example done, interrupted, turn limit, error). An abort ends the stream with `turn_end` instead of throwing.
- A question for the user (a permission prompt, today) is an event with a `requestId`. The turn waits until the frontend calls `session.respond(requestId, answer)` or the signal aborts. `headless` answers from flags and rules and never waits on a person (#26).
- The one reader is the frontend (`tui`, `headless`) or a test. Session persistence (#24) is a tap inside `agent` that records each event before yielding it, so no frontend has to forward events to storage. No frontend reaches into core state any other way; anything else it needs (credentials, model catalog, cost and session stores, settings) comes through `AppServices`.

## Process behavior (owned by `cli`)

- **Lazy UI**: `cli` loads `@pk/tui` with a dynamic `import()` only for interactive mode, so `pk --version`, `pk -p` and other subcommands never load OpenTUI's native library.
- **Terminal restore**: on normal exit, SIGINT, SIGTERM, an uncaught error or an unhandled rejection, `cli` makes sure the terminal leaves the alternate screen, shows the cursor, turns mouse reporting off and leaves raw mode before exiting. SIGTSTP (Ctrl+Z) suspends cleanly and redraws on resume.
- **Exit codes**: `cli` owns one exit code table (0 success, 1 failure, 2 usage error at the start); #26 extends it.
- **Native library home** (owned by `cli`, one function, `ensureNativeHome()`). The private folder is trusted because only your user id can write to it, not because of any content check (Bun checks only the size). Code already running as you is out of scope.
  - **Where it runs**: first thing in every action handler that loads `@pk/tui` (today `__tui-smoke`; later interactive `pk`), after commander has parsed the arguments and after the not a terminal refusal, and before the logger, `createProcessGuard`, or any read of stdin or write to stdout. Module level code in `cli` must stay free of side effects so this holds. It never runs for `pk --version`, `--help`, `pk -p`, or a refused non terminal run.
  - **Only in a compiled binary**: `Bun.main` starts with `/$bunfs/`. From source (`bun run dev`) OpenTUI loads from `node_modules`, nothing is extracted, and the function returns at once. In a compiled binary, if `typeof process.execve !== "function"`, fail closed.
  - **Target folder**: `<native>/<id>/`, where `<native>` is `realpath(<cache>)/native`. `<cache>` comes from `paths().cache` made absolute with `path.resolve` (so a relative `PK_HOME` is fixed before anything else). If `homedir()` throws or returns an empty or relative path and `PK_HOME` is unset, fail closed. `<id>` is `<opentui version>-<first 12 hex of the SHA 256 of the embedded native library>`, both injected by `scripts/build.ts` with `define` (`PK_NATIVE_ID`), so the same library always maps to the same folder and the name is always path safe. `realpath` is used so a symlinked `~/.pk` or cache folder (common in dotfiles setups) still works.
  - **Trusted path check**: create missing folders one level at a time with `mkdir(path, { mode: 0o700 })`, tolerating `EEXIST` (another pk got there first) and checking again after. Then check every folder from `/` down to the target folder on the resolved path. Every ancestor must be owned by you (`process.geteuid()`) or by root, and must not be writable by group or others unless its sticky bit is set. `<native>` and `<native>/<id>` must, using `lstat` (which does not follow links), be real directories (not symlinks), owned by you, with `(mode & 0o700) === 0o700` and `(mode & 0o077) === 0`. `BUN_TMPDIR` is then set to the resolved absolute target, never to a path with a link in it.
  - **Loop guard, then exec or restore** (in this order, in the one function): if `PK_NATIVE_DIR` and `BUN_TMPDIR` both equal the resolved target, this is the image after the exec: restore (below) and run the trusted path check once more, right before the dynamic `import("@pk/tui")`. Otherwise (no marker, a stale marker, or a marker that does not match `BUN_TMPDIR`), exec: `process.execve(process.execPath, [process.execPath, ...process.argv.slice(2)], env)`. `env` is a map of string values only (undefined dropped): the current environment plus `BUN_TMPDIR=<target>`, `PK_NATIVE_DIR=<target>`, and `PK_USER_BUN_TMPDIR=<JSON of your original BUN_TMPDIR>` (the JSON keeps "unset" and "set but empty" apart). `argv[1]` in a compiled binary is the internal `/$bunfs/...` path, so it is dropped. Commander's program name stays the fixed `pk`, so `--help` text does not change.
  - **Restore** (in the new image): set `BUN_TMPDIR` back from `PK_USER_BUN_TMPDIR` (deleted if you had none, empty if it was empty), then delete `PK_USER_BUN_TMPDIR` and `PK_NATIVE_DIR`. Bun read `BUN_TMPDIR` at startup, so the library still goes to the private folder, while every tool pk later runs (#9, #16, #35, #36) inherits your own environment.
  - **State across the exec**: kernel state carries over (open files, the terminal and its settings, process group, working directory, ignored signals). JS level state does not, which is why the exec comes before any handler is installed or any stdio is used. A signal in that brief window just ends pk, and the terminal is untouched (nothing has changed it yet).
  - **Fail closed, one message per cause**: write one line straight to stderr (the logger does not exist yet) and exit 1 (`EXIT.failure`). Never fall back to `$TMPDIR`. Messages: wrong owner ("`<folder>` belongs to another user; set `PK_HOME` to a folder you own"), loose permissions ("run `chmod 700 <folder>`"), a symlink where a folder must be, an untrusted ancestor ("`<folder>` can be changed by other users; set `PK_HOME`"), no home folder ("set `PK_HOME`"), the binary missing at `process.execPath` (ENOENT or EACCES on exec, usually an upgrade replaced it: "pk was updated while starting; run it again"), and the library failing to load from the folder ("the cache folder may be on a `noexec` mount; set `PK_HOME`").
  - **Cleanup**: right after `guard.attach(screen)` succeeds, remove other entries in `<native>` whose modification time is more than 7 days old, owned by you, checked with `lstat`, never following links, files and folders alike. Best effort: a failure is logged as a warning. The 7 day rule means a different pk version starting at the same moment is never broken.

## Rationale

Reasoning, options weighed and references: see [rationale.md](rationale.md).

## Consequences

**Positive**:
- One install command and one binary on all four targets.
- Contributors work in TypeScript with official SDKs; tests run offline and never touch the real home directory.
- One event contract for the TUI, headless mode, sessions and tests makes #24 and #26 cheap later.
- The boundary check and per package types turn "no vendor, UI or Bun code in the core" into a build failure.

**Negative / tradeoffs**:
- Binaries are large (Bun embeds its runtime; 97.8 MB measured on macOS arm64) and memory is higher than Rust.
- The interactive path pays one extra program load (the self exec, about 25 ms) and keeps a 7 MB library copy per OpenTUI native library build in the cache folder (older copies go after 7 days unused). A home folder that is read only, or a cache folder with loose permissions, stops interactive `pk` with an error instead of starting.
- The native library fix leans on two Bun behaviors that are not documented promises: `BUN_TMPDIR` choosing the extraction folder, and the size only cache check. A Bun upgrade must rerun the e2e proof before it lands.
- OpenTUI is pre 1.0, so upgrades can break APIs. Its native library is tested upstream on only two of the four targets. If a target breaks, the TUI moves to Ink, which costs a rewrite of `tui` and a hand built scroll view.
- Full screen means the transcript is not in the terminal's own scrollback; pk must provide scrolling, search, selection and copy (#4, #14, #15).
- Core code cannot use convenient Bun APIs (`Bun.spawn`, `Bun.file`, `bun:sqlite`). The core is not proven to run on Node; that would need a bundle step and is not promised.
- Plain file storage means cost history and session lists are computed by scanning files.
- A dozen packages, mostly stubs at first, is real setup for a solo builder. It is accepted because per package types are what keep Bun APIs out of the core.

**Neutral**:
- The repo is not under git yet; the scaffold starts it.
- Each later adapter is a new package, not a folder.

**Constraints the scaffold (this feature's build) must honor**:
- **First proof**: the hidden `pk __tui-smoke` command renders an OpenTUI and Solid hello screen, handles one resize and exits on a timer, restoring the terminal. CI drives it through a PTY (a pseudo terminal; Bun's `Bun.spawn` `terminal` option if the pinned Bun has it, else `script`). The smoke run also proves the native library home (*Process behavior*). For these checks the smoke's result line also prints its PID and the values of `BUN_TMPDIR`, `PK_NATIVE_DIR` and `PK_USER_BUN_TMPDIR` after the restore. (1) With a read only, empty `TMPDIR` the smoke exits 0; afterwards `TMPDIR` is still empty, `<PK_HOME>/native/<id>/` has mode 0700 and contains a `.bun-*` library file, the PID matches the spawned process (proof of an exec, not a child), and the restored variables equal what the test passed in (once with `BUN_TMPDIR` unset, once set to a value), with both markers gone. (2) A stale `PK_NATIVE_DIR` equal to the target, without `BUN_TMPDIR`, still execs and still puts the library in the private folder (the loop guard does not trust the marker alone). (3) `<PK_HOME>/native` created beforehand as mode 0755 makes the smoke exit 1 with the folder named; `TMPDIR` stays empty. (4) `<PK_HOME>/native` planted as a symlink makes it exit 1; nothing is written at the link's target. (5) `PK_HOME` set inside a folder that others can write (mode 0777, no sticky bit) makes it exit 1. (6) `PK_HOME` reached through a symlinked parent folder works, and `BUN_TMPDIR` holds the resolved path. (7) Two smokes started at the same moment both exit 0; record the outcome. Permission cases (3), (4) and (5) are skipped with a printed note when the test runs as root, since root ignores permissions. On Linux the `build.yml` e2e is the gate: this proof is not met until it passes on `ubuntu-22.04` and `ubuntu-22.04-arm`. Unit tests cover the trusted path check (owner, symlink, mode, ancestors, sticky bit), the restore (unset, empty and set values), the loop guard, and each fail closed message. During `/develop`, the proof runs locally on your machine's target. The four target `build.yml` is written then but can only go green after the first push, so the keep OpenTUI or switch to Ink decision stays pending until it does; record the outcome as an update to this spec.
- **Done when** (from the scope): `pk --version` builds and runs from the compiled binary on macOS and Linux, and `check` passes on the empty workspace. #1 ships minimal working versions of `biome.json` (Biome defaults), `scripts/check-boundaries.ts`, `ci.yml` and `build.yml`; #2 tightens rules, adds pre commit checks and writes `AGENTS.md`.
- **Smoke turn**: the compiled binary runs `pk -p` once against the scripted fake provider (selected by `PK_FAKE_SCRIPT`), once the `headless` and `provider` stubs can carry it.

## Follow-up

- [x] #4 Terminal UI foundation: decide what interactive `pk` does when stdout is not a terminal (full screen is impossible there): refuse with a hint to use `pk -p`, or fall back to plain line output. Decided in [spec 0003](../0003-terminal-ui-foundation/index.md) (AC-20): refuse, exit 2, with a `pk -p` hint.
- [ ] #4, #14, #15: full screen means pk owns scrolling, transcript search, text selection and copy (decide mouse capture versus native selection), and whether the transcript is printed to normal scrollback on exit.
- [ ] #18 Login & keychain storage: pick a keychain mechanism that works inside a Bun compiled binary on all four targets (check whether Bun's built in secrets API fits; avoid native Node addons that can't be embedded).
- [ ] #2 Coding standards & tooling: tighten Biome rules, add pre commit checks, and record these conventions in root `AGENTS.md`.
- [ ] #29 Release & distribution: install channels, macOS code signing and notarization, the license, the clean room statement, and the supported platform floor in the README.
- [ ] Linux native library proof: the size only cache check and `BUN_TMPDIR` behavior were probed on macOS arm64 only. The `build.yml` e2e run on `ubuntu-22.04` and `ubuntu-22.04-arm` is the first Linux evidence; record the outcome here. If Bun on Linux loads the library from memory instead (no file at all), the self exec is harmless but could be skipped there.
- [ ] Consider reporting upstream to Bun that the embedded library cache checks only the file size, with an option to set the extraction folder at build time. If Bun adds one, the self exec can go.
- [ ] Verify at scaffold time: Bun binary size and startup per target; that `macos-15-intel` and `ubuntu-22.04-arm` are still live GitHub runner labels; the exact names of the compile autoload options and the PTY spawn option in the pinned Bun.
- [ ] `AGENTS.md` (written by `/audit` in #2): list the installed skills in `## Agent skills`. `opentui` and `solid-js-1x-best-practices-and-api` apply only to `packages/tui`, so they belong in `packages/tui/AGENTS.md` with a pointer from root; `zod` is project wide (root). Record `MCP servers: GitHub (github/github-mcp-server)` once connected, and `Declined: github-actions (callstackincubator/agent-skills), React Native CI only`.
- [ ] Connect the GitHub MCP server yourself (a setting on your side, for example `claude mcp add`), ideally before #2 and #29 set up CI: https://github.com/github/github-mcp-server
- [ ] No fitting Agent Skill was found for commander, Bun (its official skill could not be confirmed) or general GitHub Actions. The Anthropic SDK is covered by the `claude-api` skill already in your Claude Code setup, for #20.
