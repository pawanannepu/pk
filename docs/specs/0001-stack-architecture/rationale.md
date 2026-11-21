# 0001. Rationale: stack & architecture

The decision record for [index.md](index.md). Builds never need this file.

## Context

pk is an open source terminal coding agent for macOS and Linux, built clean room by one person with no hard deadline. Every later feature (40 of them in the scope) sits on this choice, and the scope puts it first because it is the one place tools are chosen (basis: the pk scope, foundations epic, #1).

The forces, in the engineer's own priority answers, all weighted equally:
- **One command install.** Users should get one binary and need no runtime on their machine.
- **Fast startup and low memory.** pk is opened many times a day and runs long sessions.
- **Contributor friendly.** It is open source, so the code must be easy to read, build and extend.
- **Solo build speed.** One builder has to reach the MVP (#1 to #29).

Other fixed constraints: two API styles from the start (OpenAI compatible and Anthropic native), with Gemini native later. No telemetry, so everything stays on the user's machine. Plain output under `NO_COLOR` or when not a terminal. Strict separation of provider, loop, tools, permissions, UI, headless and bench, so no vendor detail leaks into the loop. A headless JSON mode and a bench harness that grades pk by running it (basis: the pk scope header and #26, #27). The engineer is comfortable in TypeScript and Rust. The build approach is Tracer Bullet: Slice 1 must thread one real path through every layer, so the layers have to exist and connect cheaply from day one (basis: tracer bullet development, walking skeleton).

Not deciding now blocks every slice. Deciding wrong is expensive: the language, process model and module boundaries are the costliest things to change once 40 features sit on them.

## Options considered

All four are one process designs unless noted. The structural calls (core as a library, typed event stream, a package per module, black box bench) hold for options 1 to 3.

### Option 1: TypeScript on Bun, OpenTUI full screen, compiled binary (chosen)

A strict TypeScript workspace on Bun, shipped through `bun build --compile`, with an OpenTUI and Solid full screen UI and official SDKs inside the adapters.

**Pros**:
- A single binary with no runtime needed, on all four targets, from one toolchain.
- The language contributors know best for AI tooling, with official OpenAI and Anthropic SDKs.
- The fastest path solo: no compile step in development, and a built in test runner and package manager.

**Cons**:
- Large binaries and higher memory than native code.
- OpenTUI is pre 1.0 and its native library is tested upstream on only two of the four targets.
- Bun is younger than Node, and some npm packages assume Node internals.

### Option 2: Rust, ratatui, hand written HTTP adapters

A Cargo workspace with one crate per module, ratatui and crossterm for the UI, `reqwest` plus a hand written SSE parser per API style.

**Pros**:
- The smallest binary (around 10 to 20 MB), the fastest startup, the lowest memory.
- Crates enforce module boundaries naturally, and ratatui is mature, with an inline viewport available too.

**Cons**:
- Much slower to build solo, and a smaller contributor pool.
- No official Anthropic Rust SDK (only community crates), so every adapter, retry policy and stream parser is pk's to write and maintain.

### Option 3: TypeScript on Node, Ink, shipped through npm

The same TypeScript design on Node 22 or later with Ink, installed with `npm install -g`.

**Pros**:
- The most mature runtime, the widest npm compatibility, and Ink is the most proven TypeScript TUI.

**Cons**:
- Users must have Node, which breaks the one binary priority. Node's single executable application feature is still marked active development.
- Slower startup than a compiled binary.

### Option 4: Rust core, TypeScript TUI over a local protocol

The core runs as a Rust process, and a TypeScript UI talks to it over a protocol.

**Pros**:
- Native performance in the core, and a familiar UI language.

**Cons**:
- Two languages, two toolchains, a protocol and a process lifecycle for one solo builder. It also contradicts the one process decision.

## Rationale

Option 1 is the only one that meets all four priorities at least acceptably. Option 2 wins clearly on startup and memory, but it loses on the two priorities a solo open source project lives or dies by: build speed and contributor reach. It also forces hand maintained adapters for two API styles from day one. Option 3 fails one command install outright. Option 4 pays a two language tax for performance the product has not shown it needs (basis: premature optimisation). Bun closes most of option 3's gap: it compiles to one binary, starts fast and runs TypeScript directly. The remaining cost is binary size and memory, which this spec accepts consciously.

The structural calls follow the same forces:
- **One process with the core as a library** is the simplest model that a solo builder can debug (basis: monolith first).
- **The typed event stream** gives the TUI, headless JSON (#26), session persistence (#24) and tests one ordered contract, which is what makes the Slice 1 tracer thread cheap to extend.
- **A package per module with a CI boundary check** turns the scope's requirement that nothing vendor specific leaks into the loop into a build failure instead of a review comment.
- **Keeping Bun APIs out of the core** keeps the core portable and its dependencies honest, at the price of not using Bun's faster APIs in most of the code. Enforcement is by per package types and the boundary check. Actually running the core on Node would need a bundle step, so that is a possibility, not a promise.
- **pk-bench drives the real binary**, so it measures exactly what users run (basis: grading agent output by running tests, as in SWE-bench).

**Two picks went against the initial recommendation, and both were accepted knowingly:**
- **Full screen rendering instead of inline.** Inline would have kept native scrollback, search and copy, and suited Ink. You chose full screen for the layout control. The cost: pk must own scrolling, search, selection and copy (the follow ups for #4, #14 and #15).
- **OpenTUI instead of Ink.** Given full screen, OpenTUI is the right fit: it has full screen layout, a culling ScrollBox and a list layout mode for long transcripts, all built for Bun, where Ink would need a hand built scroll view. The risk is maturity. That's why the scaffold must prove OpenTUI on all four targets first, with Ink kept as the recorded fallback.

The small internal calls were made in writing:
- **Package names `@pk/*`, private.** Users get the binary, so nothing needs npm publishing. The runner up was unscoped names.
- **Wiring by plain constructor arguments in `cli`.** That keeps tests building sessions from fakes without a framework. The runner up was a DI container.
- **`AsyncIterable` for the event stream.** It's ordered, has natural backpressure (the reader sets the pace), and is easy to test with `for await`. The runner up was an event emitter, which loses ordering guarantees under async handlers.
- **A dedicated `scripts/check-boundaries.ts`.** Workspace resolution alone may still let an undeclared sibling import resolve. The runner up was Biome's restricted imports rules, which can't express the full allowed direction table.
- **An `env` package for paths, settings and the logger.** Every core package needs them, and putting them in `schema` would give the leaf package side effects.

## Cross check (2026-11-21)

An independent read only review on a different model (Sonnet) found the design sound. It raised 18 points, and all of them were applied on the engineer's pick:
- **Three contradictions.** The "done when" line needed tooling that only #2 owned. Core tests import `bun:test`. `tui` could not reach stores without depending on core internals, which `AppServices` now solves.
- **Scaffold decisions left open.** The starting package set, workspace and compiler conventions, Solid JSX wiring, the TUI proof harness, runner labels and the glibc floor, compile flags, version and script names, process signals and terminal restore, boundary check semantics, file write helpers, data directory layout, and logger policy.
- **Cross cutting rules.** Subprocesses, threads, SDK retries off, where the `Tool` interface lives, the fake provider switch, and a single reader plus `turn_end` for the event stream.
- **One simplification.** Build each binary natively on its own runner instead of cross compiling.

Two of the critic's suggestions were changed:
- **Baseline x64 builds**, not modern ones. A crash on CPUs without AVX2 costs more than the tiny speed gain is worth for a CLI.
- **OpenTUI's own embedded worker is allowed.** The "no worker threads" rule covers only pk's own code, because the OpenTUI skill documents that Bun compile embeds its parser worker.

## Native library location (update, 2026-11-21)

**Context.** The first scaffold build (`/develop`, 2026-11-21) found that the original proof, "a read only `TMPDIR` proves nothing is extracted at run time", does not hold. The operating system can only load a native library from a real file, so a compiled Bun binary writes OpenTUI's embedded library (6.9 MB on macOS arm64) into its temp folder and loads it from there, keeping the file as a cache for later runs. The question was where that file may live. Two forces shape it: the scope's rule that pk must never be able to change things unasked (least privilege), and Linux, where `$TMPDIR` is usually unset so the file lands in the shared `/tmp`.

**Probe evidence** (local experiments on the compiled `pk` binary, macOS arm64, Bun 1.4.4):

| Probe | Result |
|---|---|
| Normal `TMPDIR` | Bun writes `$TMPDIR/.bun-<uid>-<hash>.dylib` (mode 0600) and keeps it after exit |
| Read only `TMPDIR` | Startup fails: "Failed to open library" |
| Junk file at the cached name | Bun rewrites it |
| Same size file with one byte changed | Bun **keeps and loads** the modified library (the check compares size only) |
| Symlink planted at the cached name | Bun replaces the link with a real file; the link's target is untouched |
| `TMPDIR` or `BUN_TMPDIR` changed inside the running process | Ignored; Bun reads them once at startup |
| `BUN_TMPDIR` set at startup | The library goes there; `TMPDIR` is left alone |
| Self `process.execve` with `BUN_TMPDIR` set | Works: same PID, arguments kept (after dropping the internal `/$bunfs/...` `argv[1]`), smoke passes with a read only `TMPDIR` |

The risk that matters: the file name is predictable (user id plus a fixed hash per build) and only its size is checked. On a shared `/tmp`, another local user could plant a same size library before your first run, and pk would load their code as you. On macOS `$TMPDIR` is already private per user, so the risk there is low. Linux was not probed (no container runtime was running), so the risk is treated as plausible, not proven.

**Options considered.**
1. **Private pk folder through a self exec (chosen).** Set `BUN_TMPDIR` to a pk owned folder checked for owner and mode 0700, by replacing the process with itself before the UI loads. Pros: closes the shared `/tmp` risk on every platform, works with a read only `TMPDIR`, keeps Bun's own loader, a few dozen lines in `cli`. Cons: one extra program load (about 25 ms) on the interactive path, relies on undocumented Bun behavior (`BUN_TMPDIR`), and a loose or read only cache folder stops pk.
2. **pk extracts and verifies the assets itself.** Embed OpenTUI's asset set, write it to `<cache>/opentui/<hash>/` with a SHA 256 check on every start, and point OpenTUI there with `OTUI_ASSET_ROOT` (OpenTUI's supported relocation). Pros: the strongest guarantee, content verified, no exec. Cons: once the root is set OpenTUI needs the complete asset set (native library, parser worker, grammars, WASM), so pk must track that list on every OpenTUI upgrade (and OpenTUI ships almost daily); the binary grows; hashing 7 MB on every start.
3. **Self exec on Linux only.** Keep Bun's default on macOS, where `$TMPDIR` is private. Pros: no change on macOS. Cons: two code paths and two proofs to keep green, for a saving of about 25 ms.
4. **Keep Bun's default.** Drop the read only proof and document the risk. Pros: no code. Cons: leaves a code loading risk on multi user Linux machines, the one place the scope's least privilege rule should not bend.

**Rationale.** Option 1 removes the attack surface (nobody else can write into a 0700 folder you own), not just the symptom, at a cost paid only by the interactive path. Option 2 is stronger on paper, but it trades a small, stable mechanism for a large one that breaks on any OpenTUI asset change, and the maintenance would fall on a solo builder. It stays the fallback if Bun's `BUN_TMPDIR` behavior changes. Option 3 saves too little for a second path. Option 4 accepts a known local code loading risk.

The small internal calls were made in writing:
- **A folder per native library build** (`<cache>/native/<opentui version>-<library hash>/`), with copies unused for 7 days removed after a successful start. Keying on the library, not the pk version, means a pk upgrade that keeps the same OpenTUI reuses the copy, and the name is always path safe. The 7 day rule keeps a different pk version starting at the same moment from losing its folder. The runner up was a folder per pk version, removed on every start, which breaks two versions running side by side and re-extracts 7 MB when you switch between them.
- **Fail closed** when the folder is unusable, chosen by you, so pk never quietly reopens the risk.
- **Restore your `BUN_TMPDIR`** right after the exec, so tools pk runs see your environment, not pk's. The runner up was leaving it set, which would leak pk's folder into Bun projects pk runs for you.
- **No exec from source** (`bun run dev`), because OpenTUI then loads straight from `node_modules` and nothing is extracted.

**Cross check (2026-11-21).** An independent read only review on a different model (Sonnet) agreed the design closes the shared `/tmp` risk and that the self exec is the right option. (It weighed "exec only when the temp folder is not already private" and rejected it as a second path to save 25 ms.) It raised 19 decision gaps and 3 wording points, and all were applied on your pick:
- **The order inside the one function.** The loop guard needs both markers and runs before the restore. The trusted path check runs again right before the UI import.
- **Where it runs.** In the UI action handlers, after argument parsing and the terminal refusal, before any side effect. It applies only in a compiled binary, detected through `Bun.main`, and fails closed if `execve` is missing.
- **The whole path is trusted, not just the last two folders.** `realpath`, then every ancestor must be owned by you or root and not writable by others (unless sticky), which blocks a parent folder swap. Owner access and `geteuid()` are now explicit.
- **The folder name, cleanup and races.** The folder is keyed on the native library build. Cleanup removes only copies unused for 7 days. `EEXIST` is tolerated.
- **The edge values.** A relative `PK_HOME`, an empty versus an unset `BUN_TMPDIR`, a string only `env`, and the program name.
- **One fail closed message per cause.** That includes a binary replaced mid upgrade and a `noexec` mount.
- **A proof that observes what it claims.** The PID, the restored variables, the library file, a stale marker, a loose or symlinked parent, concurrent starts, root skips, and Linux CI as the gate.

## References

**Project sources** (verifiable, in this repo):
- Local probes of the compiled `pk` binary on 2026-11-21, recorded under *Native library location* above.
- The pk scope: `docs/scope/index.md` (product decisions, build approach, workflow tier) and `docs/scope/foundations.md` (#1 intent and done when).
- The installed `opentui` skill (`.claude/skills/opentui/`), from the OpenTUI maintainers' repo: `docs/getting-started/runtime-support.mdx` (Bun 1.3.14 floor, native packages per target, upstream test matrix), `docs/reference/standalone-executables.mdx` (Bun compile embedding, `OPENTUI_LIBC`, multi target install), and `docs/releases/0.8.1.md` and `0.9.0.md` (ScrollBox culling, list layout mode, removed APIs).
- The landscape research cache: `docs/.agent-cache/research/stack-architecture.md` (checked 2026-11-21).
- The design conversation answers from this `/architect` run.

**Practices & standards**:
- Monolith first; extract services only when a measured need forces it.
- Avoid premature optimisation.
- Tracer bullet development and the walking skeleton.
- Grading agent output by running tests (SWE-bench style).
- The XDG Base Directory convention for Linux user files.
- The NO_COLOR convention.

**Links** (checked in the landscape and discovery runs, November 2026):
- [Bun single file executables](https://bun.sh/docs/bundler/executables): cross compile targets (the fetch returned 404; confirmed through search results only).
- [Node.js single executable applications (v26 docs)](https://nodejs.org/download/release/v26.13.0/docs/api/single-executable-applications.html): still "Stability 1.1, Active development".
- [Ink on npm](https://registry.npmjs.org/ink/latest): 8.0.0, Node 22 or later.
- [OpenTUI repository](https://github.com/anomalyco/opentui): Zig core, TypeScript packages, Solid and React bindings.
- [ratatui on crates.io](https://crates.io/api/v1/crates/ratatui) and [ratatui inline viewport example](https://ratatui.rs/examples/apps/inline/).
- [anthropic-sdk-rust](https://docs.rs/crate/anthropic-sdk-rust/latest): an unofficial community crate (there's no official Anthropic Rust SDK).
- [openai on npm](https://registry.npmjs.org/openai/latest) (7.62.0), [@anthropic-ai/sdk on npm](https://registry.npmjs.org/@anthropic-ai/sdk/latest) (1.12.0), [ai (Vercel AI SDK) on npm](https://registry.npmjs.org/ai/latest) (7.0.179).
- [OpenAI Codex repository](https://github.com/openai/codex): Rust core with npm packaging. [opencode repository](https://github.com/anomalyco/opencode): TypeScript on Bun.
- [GitHub MCP server](https://github.com/github/github-mcp-server): includes an Actions toolset.

## Landscape evidence

What the checks could not confirm, so the scaffold verifies it on real targets:
- Bun binary size and startup time.
- Whether Ink works inside a Bun compiled binary (only matters if the fallback is used).
- Current GitHub hosted native runners for Intel macOS and arm64 Linux.
- Vercel AI SDK streaming tool call behavior (not needed; it was not chosen).
