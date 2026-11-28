# @pk/permissions

## Overview

Permission modes, allow and deny rules, the always ask list, and a pure decision function that `agent` calls before each tool run. #6 (spec 0005) ships `decide` in `src/decide.ts`: `read` kind tools and tools in `sessionAllows` run, everything else asks. Modes and rules arrive with #7 and #10.

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

## Related specs

- [spec 0001](../../docs/specs/0001-stack-architecture/index.md) (module map); features #7, #10
- [spec 0005](../../docs/specs/0005-agent-loop-read-file/index.md) (the `decide` seam, AC-10)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
