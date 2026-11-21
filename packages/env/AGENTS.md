# @pk/env

## Overview

The process environment every package shares: data directories (`paths()`), crash safe writes (`atomicWriteFile`, `appendJsonl`), the JSONL logger, `redact()`, and the `PkError` base class. Settings load and merge lands here with #3. Built by #1: `paths`, `files`, `logger`, `redact`, `errors`, each with tests.

## Stack

- Core package (runtime neutral, Node APIs only).
- May depend on: `@pk/schema` (spec 0001 module map, checked by `bun run boundaries`)

## Commands

```bash
bun --filter @pk/env typecheck   # type check this package
bun test packages/env            # this package's tests
```

## Conventions

Root `## Rules` apply here. In addition:

- `paths()` returns `{ config, state, cache }`: `~/.pk` on macOS, XDG folders on Linux, everything under `PK_HOME` when set. File and folder names are identical everywhere.
- The logger writes JSONL to `<state>/logs/`, rotates at 5 MB, never writes to stdout, and never logs prompts, model output or file contents at `info`.

## Related specs

- [spec 0001](../../docs/specs/0001-stack-architecture/index.md) (data directories, logging, secret redaction, errors)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
