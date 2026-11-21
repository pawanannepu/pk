# pk

An open source terminal AI coding agent for macOS and Linux, shipped as one standalone binary.

## Stack

- **Language / Runtime**: TypeScript 7, ESM only, on Bun 1.4.4 (pinned in `package.json` `packageManager` and in CI)
- **Framework**: one process modular monolith. Core packages emit one typed `AgentEvent` stream that `tui`, `headless` and tests read. UI is OpenTUI 0.9.7 with Solid 1.9 (exact pins, pre 1.0)
- **Key dependencies**: Zod 4 (schemas), commander (CLI), official provider SDKs inside adapters only, Biome 2.6 (lint and format)
- **Package manager**: Bun workspaces (`packages/*`, hoisted linker, committed `bun.lock`); `bun build --compile` makes `dist/pk-<os>-<arch>` for darwin arm64/x64 and linux x64/arm64 (glibc)
- Source of truth: [spec 0001](docs/specs/0001-stack-architecture/index.md)

## Build approach

**Tracer Bullet**: prove one real thread runs end to end through provider, loop, tools, permissions and terminal, then thicken one segment per slice.

## Commands

```bash
bun install --frozen-lockfile                # install
bun run dev                                  # run pk from source
bun run build [--target bun-linux-x64-baseline]   # compile the binary into dist/
bun run check                                # lint, typecheck, boundaries, test (the gate)
bun test [packages/<name>]                   # tests only
bun run test:e2e --binary dist/pk-darwin-arm64    # drive the compiled binary in a PTY
bun run format                               # Biome auto fix and format
```

## Specs

Stored in `docs/specs/NNNN-title/` (`index.md`, `rationale.md`, `verify.md`). Scope lives in `docs/scope/`.

## Rules

- **Boundaries** (spec 0001 module map, enforced by `scripts/check-boundaries.ts`): core packages never use `Bun.*` or `bun:*`; a vendor SDK only in its own adapter; `@opentui/*` and `solid-js` only in `tui`; `commander` only in `cli`. Import siblings as `@pk/<name>` only, never deep paths. Wiring is plain constructor arguments in `cli`: no DI framework, no module level singletons.
- **Functional**: pure functions over `readonly` plain data; I/O, clock and subprocesses stay at the edges and are passed in explicitly. Prefer functions to classes, never mutate in place, module level values are constants only.
- **Errors**: throw `PkError` subclasses with a stable `code` (like `provider.rate_limited`), caught at the loop boundary. Never throw bare strings or plain `Error` on purpose. This overrides the functional preset's `Result` types (spec 0001). Absence is `undefined` in a union, not `null`.
- **Types, strict plus**: no `any` (use `unknown` and narrow), no non null `!`, exhaustive `switch` over unions with a `never` check, and Zod parse at every trust boundary (files, network, model output, env) instead of `as` casts.
- **Files**: flat files by concern in `src/`; a concern that grows past a few files gets its own folder. `src/index.ts` is the only public entry, and every export from it has a doc comment.
- **Output and data**: stdout belongs to program output, so log through the `env` logger, never `console`. Everything leaving the process passes `redact()`. Write files only with `atomicWriteFile` or `appendJsonl`. One `AbortSignal` goes through every provider call, tool run and permission wait.
- **Testing**: unit tests for pure logic, integration tests that drive a session through the scripted fake provider and read the event stream, `test:e2e` when process behavior changes. Tests sit beside the source (`*.test.ts`), run offline and never touch the real home folder. A feature is done only when `bun run check` passes.
- **Versions**: exact pins, no `^`. Read OpenTUI release notes before upgrading; a Bun upgrade must rerun `test:e2e` first.

## Tooling

Configured in `biome.json` and `lefthook.yml`. Biome raises to error: `noExplicitAny`, `noNonNullAssertion`, `noDefaultExport`, `useImportType`, `noConsole` (except `packages/cli` and `scripts/`), plus the nursery rules `noFloatingPromises`, `noMisusedPromises` and `useExhaustiveSwitchCases` (nursery rules can change between Biome versions). Pre commit hook (lefthook, installed by the `prepare` script on `bun install`): Biome check with write on staged files (fixes are staged), then typecheck and the boundary check; skip once with `git commit --no-verify`. CI stays as is (`ci.yml`, `build.yml`).

## Git

- integration: off

## Agent skills

- [zod](.claude/skills/zod/): `pproenca/dot-skills`, Zod 4 schemas, parsing and `z.infer`
- [github-actions-hardening](.claude/skills/github-actions-hardening/): `github/awesome-copilot`, security review of `.github/workflows/`
- [github-actions-efficiency](.claude/skills/github-actions-efficiency/): `github/awesome-copilot`, CI minutes and caching

Declined: github-actions (`callstackincubator/agent-skills`, React Native CI only), biomejs/biome skills (Biome contributors only), lefthook skills (small config, not needed) · MCP servers: GitHub (`github/github-mcp-server`) (recommended)

## Context files

- [packages/schema/AGENTS.md](packages/schema/AGENTS.md) (shared Zod schemas and the AgentEvent union)
- [packages/env/AGENTS.md](packages/env/AGENTS.md) (paths, safe writes, logger, redact, PkError)
- [packages/provider/AGENTS.md](packages/provider/AGENTS.md) (provider interface, retry policy, fake provider)
- [packages/provider-openai/AGENTS.md](packages/provider-openai/AGENTS.md) (OpenAI compatible adapter)
- [packages/permissions/AGENTS.md](packages/permissions/AGENTS.md) (modes, rules, pure decision function)
- [packages/tools/AGENTS.md](packages/tools/AGENTS.md) (Tool interface and built in tools)
- [packages/agent/AGENTS.md](packages/agent/AGENTS.md) (the loop, sessions, event stream)
- [packages/tui/AGENTS.md](packages/tui/AGENTS.md) (OpenTUI and Solid full screen UI)
- [packages/headless/AGENTS.md](packages/headless/AGENTS.md) (`pk -p` runner and output contract)
- [packages/cli/AGENTS.md](packages/cli/AGENTS.md) (binary entry and composition root)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
