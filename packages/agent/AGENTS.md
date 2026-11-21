# @pk/agent

## Overview

The agent loop, context assembly, sessions (a persistence tap) and compaction. Emits the typed event stream, asks `permissions` before each tool run, and declares the `AppServices` interface the frontends use. Stub today; the loop arrives with #6.

## Stack

- Core package (runtime neutral).
- May depend on: `@pk/schema`, `@pk/env`, `@pk/provider`, `@pk/permissions`, `@pk/tools` (spec 0001 module map, checked by `bun run boundaries`)

## Commands

```bash
bun --filter @pk/agent typecheck   # type check this package
bun test packages/agent            # this package's tests
```

## Conventions

Root `## Rules` apply here. In addition:

- A turn returns `AsyncIterable<AgentEvent>` with exactly one reader; every event has an increasing `seq` and a `type`.
- Every turn ends with exactly one `turn_end` carrying a `reason`; an abort ends the stream with `turn_end`, never a throw.
- Questions for the user are events with a `requestId`, answered by `session.respond(requestId, answer)`.

## Related specs

- [spec 0001](../../docs/specs/0001-stack-architecture/index.md) (core to frontend contract); features #6, #24, #25

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
