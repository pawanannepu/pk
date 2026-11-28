# @pk/cli

## Overview

The `pk` binary entry and composition root: commander, the provider registry (the only importer of adapter packages), the tool list for `agent`, the `AppServices` object for `tui`, signals, terminal restore, the exit code table, and the native library home. Built by #1: `--version`, `--help`, exit codes, platform check, process guard, `ensureNativeHome()`.

## Stack

- Composition root: may use Bun types and any `@pk/*` except `bench`. `commander` 15.1.0.
- May depend on: `@pk/env`, `@pk/tui`, `@pk/schema`, `@pk/provider`, `@pk/provider-openai`, `@pk/agent`, `@pk/tools`, `@pk/permissions` today; any `@pk/*` except `bench`, plus `commander` (spec 0001 module map, checked by `bun run boundaries`)

## Commands

```bash
bun --filter @pk/cli typecheck   # type check this package
bun test packages/cli            # this package's tests
```

## Conventions

Root `## Rules` apply here. In addition:

- Exit codes come only from the table in `src/exit-codes.ts` (0 success, 1 failure, 2 usage, 128 plus signal).
- `console` is allowed here (Biome `noConsole` is off for `packages/cli/**` and `scripts/**` only); every other package logs through the `env` logger.
- Wiring is plain constructor arguments assembled here; no other package wires packages together.
- `src/providers.ts` builds the provider registry: every real provider is wrapped as `withRetry(withTimeouts(adapter))`, and `PK_FAKE_SCRIPT` swaps in the fake provider (wrapped in `withRetry` only). `src/session-setup.ts` (`prepareSession`) calls it for bare `pk`, builds the `FileSystem` port and the agent session, and throws any setup `ProviderError` before the screen opens; `program.ts` prints it as `pk: <message>` and exits 1. Quitting closes the session through `closeWithin` (1 s bound).
- `--mode` and `--dangerously-skip-permissions` are options on the root command, read only by the bare `pk` action. Their clash check runs first (before the terminal check), and `resolveStartMode` runs after settings load; `skip_all` comes only from the flag, never from settings (spec 0006 AC-7).

## Gotchas

- Module level code must stay free of side effects: `ensureNativeHome()` must run first in any handler that loads `@pk/tui`, before the logger, the process guard, or any stdio.
- In the compiled binary, interactive paths self exec (`process.execve`) with a private `BUN_TMPDIR`; read spec 0001 _Process behavior_ before touching `native-home.ts` or `process-guard.ts`.

## Related specs

- [spec 0001](../../docs/specs/0001-stack-architecture/index.md) (process behavior, native library home)
- [spec 0004](../../docs/specs/0004-provider-layer-openai-adapter/index.md) (provider registry, key sources, `PK_FAKE_SCRIPT`)
- [spec 0006](../../docs/specs/0006-permission-prompts-modes/index.md) (startup mode flags)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
