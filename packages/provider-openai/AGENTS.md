# @pk/provider-openai

## Overview

The OpenAI compatible adapter: any OpenAI style endpoint reached by `baseURL` (OpenRouter, Groq, Ollama, LM Studio and others). Stub today; the adapter arrives with #5.

## Stack

- Core package (runtime neutral). Official `openai` SDK, created with `maxRetries: 0`.
- May depend on: `@pk/provider`, `@pk/schema`, `@pk/env`, `openai` (spec 0001 module map, checked by `bun run boundaries`)

## Commands

```bash
bun --filter @pk/provider-openai typecheck   # type check this package
bun test packages/provider-openai            # this package's tests
```

## Conventions

Root `## Rules` apply here. In addition:

- The only package that may import `openai`; translate vendor types to `@pk/schema` shapes here and nowhere else.

## Agent skills

- [openai-docs](../../.claude/skills/openai-docs/): `openai/skills`, current official OpenAI API and SDK docs

## Related specs

- [spec 0001](../../docs/specs/0001-stack-architecture/index.md) (provider access); feature #5

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
