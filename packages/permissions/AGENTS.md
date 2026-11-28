# @pk/permissions

## Overview

Permission modes, allow and deny rules, the always ask list, and a pure decision function that `agent` calls before each tool run. #6 (spec 0005) ships the `decide` seam in `src/decide.ts`. #7 (spec 0006) makes it the full mode table (`allow`, `ask` or `block` from kind, mode and `sessionAllows`) and adds `resolveStartMode` in `src/start-mode.ts` for the startup mode. Rules and the always ask list arrive with #10.

## Stack

- Core package (runtime neutral).
- May depend on: `@pk/schema`, `@pk/env` (spec 0001 module map, checked by `bun run boundaries`)

## Commands

```bash
bun --filter @pk/permissions typecheck   # type check this package
bun test packages/permissions            # this package's tests
```

## Conventions

Root `## Rules` apply here. In addition:

- The decision function stays pure: rules and request in, decision out, no I/O.
- Every mode rule lives in the one table in `decide`, with exhaustive switches over `ToolKind` and `PermissionMode`; an unhandled case falls through to `ask`. A plan mode block wins over a session allow.

## Related specs

- [spec 0001](../../docs/specs/0001-stack-architecture/index.md) (module map); features #7, #10
- [spec 0005](../../docs/specs/0005-agent-loop-read-file/index.md) (the `decide` seam, AC-10)
- [spec 0006](../../docs/specs/0006-permission-prompts-modes/index.md) (the mode table, session allow keys, `resolveStartMode`)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
