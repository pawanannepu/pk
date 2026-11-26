# @pk/env

## Overview

The process environment every package shares: data directories (`paths()`), crash safe writes (`atomicWriteFile`, `appendJsonl`), the JSONL logger, `redact()`, and the `PkError` base class. Built by #1: `paths`, `files`, `logger`, `redact`, `errors`. Built by #3 (spec 0002): `ids`, `jsonl`, `session-file`, `settings` (layered load and merge), `project`. Each has tests.

## Stack

- Core package (runtime neutral, Node APIs only).
- May depend on: `@pk/schema` (spec 0001 module map, checked by `bun run boundaries`). No direct `zod` import: shapes come from `@pk/schema`, and readers take a `SafeParser`.

## Commands

```bash
bun --filter @pk/env typecheck   # type check this package
bun test packages/env            # this package's tests
```

## Conventions

Root `## Rules` apply here. In addition:

- `paths()` returns `{ config, state, cache }`: `~/.pk` on macOS, XDG folders on Linux, everything under `PK_HOME` when set. File and folder names are identical everywhere.
- The logger writes JSONL to `<state>/logs/`, rotates at 5 MB, never writes to stdout, and never logs prompts, model output or file contents at `info`.
- Sessions, blobs, costs and history are written with `PRIVATE_FILE` (`0600` files in `0700` folders), and their writers call `ensurePrivateDir` for the folder. Settings files stay `0644`.
- JSONL readers never throw on damaged lines: go through `readJsonlRecords`, which skips and counts them.
- IDs come only from `createIdFactory`, with `now` and `randomBytes` passed in.
- Project settings files are untrusted: `providers`, `permissions.mode` and `permissions.allow` are dropped from them before validation, with a `user_only_key` warning. Keep it that way when adding settings.

## Related specs

- [spec 0001](../../docs/specs/0001-stack-architecture/index.md) (data directories, logging, secret redaction, errors)
- [spec 0002](../../docs/specs/0002-core-data-model/index.md) (IDs, session files, settings load, project root and key, private files)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
