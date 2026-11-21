# @pk/tools

## Overview

The `Tool` interface (definition plus executor) and the built in tools: read, write and edit, shell, search and listing, to do. Stub today; the interface and first tool arrive with #6.

## Stack

- Core package (runtime neutral). Subprocesses use `node:child_process`, never `Bun.spawn`.
- May depend on: `@pk/schema`, `@pk/env` (spec 0001 module map, checked by `bun run boundaries`)

## Commands

```bash
bun --filter @pk/tools typecheck   # type check this package
bun test packages/tools            # this package's tests
```

## Conventions

Root `## Rules` apply here. In addition:

- Tools never ask for permission themselves; `agent` asks `permissions` before running one.
- Every tool run takes the turn's `AbortSignal`.

## Related specs

- [spec 0001](../../docs/specs/0001-stack-architecture/index.md) (module map, subprocesses); features #6, #8, #9, #11, #12

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
