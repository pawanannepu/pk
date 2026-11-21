# @pk/provider

## Overview

The provider interface every adapter implements, provider errors, the one retry and backoff policy, and the scripted fake provider that all offline tests use. Stub today; the interface and fake provider arrive with #5 and #6.

## Stack

- Core package (runtime neutral).
- May depend on: `@pk/schema`, `@pk/env` (spec 0001 module map, checked by `bun run boundaries`)

## Commands

```bash
bun --filter @pk/provider typecheck   # type check this package
bun test packages/provider            # this package's tests
```

## Conventions

Root `## Rules` apply here. In addition:

- This package owns the only retry policy; adapters create SDK clients with `maxRetries: 0` so retries never stack.
- Vendor types never cross this interface.

## Related specs

- [spec 0001](../../docs/specs/0001-stack-architecture/index.md) (provider access); feature #5

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
