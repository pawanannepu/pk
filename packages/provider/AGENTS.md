# @pk/provider

## Overview

The provider interface every adapter implements, provider errors, the one retry and backoff policy, and the scripted fake provider that all offline tests use. Built by #5 (spec 0004): `Provider`, `ProviderError`, `withRetry`, `withTimeouts`, `resolveApiKey` and `createFakeProvider`.

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
- Clocks, timers, sleep and randomness are passed in (`Sleep`, `SetTimer`, `now`, `random`), never read globally, so retry and timeout tests run with no real waiting.
- A stream that completes ends with exactly one `stop` and passes `checkStreamOrder`; an abort ends it with `stop { reason: "aborted" }`, never a throw.

## Related specs

- [spec 0001](../../docs/specs/0001-stack-architecture/index.md) (provider access); feature #5
- [spec 0004](../../docs/specs/0004-provider-layer-openai-adapter/index.md) (interface, error codes, retry and timeout policy, fake provider)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
