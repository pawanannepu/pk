# @pk/provider-openai

## Overview

The OpenAI compatible adapter: any OpenAI style endpoint reached by `baseURL` (OpenRouter, Groq, Ollama, LM Studio and others). Built by #5 (spec 0004).

## Stack

- Core package (runtime neutral). Official `openai` SDK, created with `maxRetries: 0`.
- May depend on: `@pk/provider`, `@pk/schema`, `@pk/env`, `openai` (pinned 7.56.0), `zod` (chunk schemas) (spec 0001 module map, checked by `bun run boundaries`)

## Commands

```bash
bun --filter @pk/provider-openai typecheck   # type check this package
bun test packages/provider-openai            # this package's tests (offline, fixture SSE replies)
PK_LIVE_TEST=1 PK_LIVE_BASE_URL=<url> PK_LIVE_MODEL=<model> PK_LIVE_API_KEY=<key> bun test packages/provider-openai/src/live.test.ts   # opt in live smoke, never in check
```

## Conventions

Root `## Rules` apply here. In addition:

- The only package that may import `openai`; translate vendor types to `@pk/schema` shapes here and nowhere else.
- The SDK client is created per call with `maxRetries: 0`, `organization: null` and `project: null`, so the environment can never redirect requests or add headers. Every chunk is parsed with `ChatChunk` (Zod), never cast.
- The adapter logs nothing; `withRetry` in `@pk/provider` owns provider logging.
- A new server quirk gets a recorded reply in `src/fixtures/*.sse` and a test that replays it.

## Agent skills

- [openai-docs](../../.claude/skills/openai-docs/): `openai/skills`, current official OpenAI API and SDK docs

## Related specs

- [spec 0001](../../docs/specs/0001-stack-architecture/index.md) (provider access); feature #5
- [spec 0004](../../docs/specs/0004-provider-layer-openai-adapter/index.md) (request mapping, stream mapping, error mapping)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
