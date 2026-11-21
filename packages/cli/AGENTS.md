# @pk/cli

## Overview

The `pk` binary entry and composition root: commander, the provider registry (the only importer of adapter packages), the tool list for `agent`, the `AppServices` object for `tui`, signals, terminal restore, the exit code table, and the native library home. Built by #1: `--version`, `--help`, exit codes, platform check, process guard, `ensureNativeHome()`.

## Stack

- Composition root: may use Bun types and any `@pk/*` except `bench`. `commander` 15.1.0.
- May depend on: `@pk/env`, `@pk/tui` today; any `@pk/*` except `bench`, plus `commander` (spec 0001 module map, checked by `bun run boundaries`)

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

## Gotchas

- Module level code must stay free of side effects: `ensureNativeHome()` must run first in any handler that loads `@pk/tui`, before the logger, the process guard, or any stdio.
- In the compiled binary, interactive paths self exec (`process.execve`) with a private `BUN_TMPDIR`; read spec 0001 _Process behavior_ before touching `native-home.ts` or `process-guard.ts`.

## Related specs

- [spec 0001](../../docs/specs/0001-stack-architecture/index.md) (process behavior, native library home)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
