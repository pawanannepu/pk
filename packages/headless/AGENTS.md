# @pk/headless

## Overview

The `pk -p` runner and its text and JSON output contract. Answers permission requests from flags and rules and never waits on a person. Stub today; the runner arrives with #26.

## Stack

- Core package (runtime neutral).
- May depend on: `@pk/schema`, `@pk/agent`, `@pk/env` (spec 0001 module map, checked by `bun run boundaries`)

## Commands

```bash
bun --filter @pk/headless typecheck   # type check this package
bun test packages/headless            # this package's tests
```

## Conventions

Root `## Rules` apply here. In addition:

- stdout carries only the output contract; everything else goes to the logger or stderr, through `redact()`.

## Related specs

- [spec 0001](../../docs/specs/0001-stack-architecture/index.md) (core to frontend contract); feature #26

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
