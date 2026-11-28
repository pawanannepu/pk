# @pk/agent

## Overview

The agent loop, context assembly, sessions (a persistence tap) and compaction. Emits the typed event stream, asks `permissions` before each tool run, and declares the `AppServices` interface the frontends use. The loop ships with #6 (spec 0005): `createAgentSession` in `src/session.ts` is the imperative shell, around pure step functions in `src/reply.ts` (the reply fold) and `src/results.ts` (result texts and clipping).

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
- `agent` never imports `zod`: tool input is checked by `Tool.validate` from `@pk/tools`, always before `decide`, so bad input never prompts.
- Tests drive a session with `startSession` from `src/test-support.ts` (the fake provider plus an in memory `FileSystem`); it is not exported from `index.ts`. Its `sleep` does nothing, so a fake step's `eventDelayMs` does not delay; use a stub `Provider` that waits on the signal when a test needs a stream to stay open.

## Related specs

- [spec 0001](../../docs/specs/0001-stack-architecture/index.md) (core to frontend contract); features #6, #24, #25
- [spec 0005](../../docs/specs/0005-agent-loop-read-file/index.md) (the loop, event order, queue, interrupt, turn limit)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
