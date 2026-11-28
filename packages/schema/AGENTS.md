# @pk/schema

## Overview

Zod schemas and the types derived from them, shared by every package: messages, content blocks, tool definitions, calls and results, usage, session records, settings, and the `AgentEvent` union. The bottom of the dependency graph. Built by #3 Core data model (spec 0002).

## Stack

- Core package (runtime neutral, Node types only). Zod 4.
- May depend on: `zod` only, no `@pk/*` packages (spec 0001 module map, checked by `bun run boundaries`)

## Commands

```bash
bun --filter @pk/schema typecheck   # type check this package
bun test packages/schema            # this package's tests
```

## Conventions

Root `## Rules` apply here. In addition:

- One schema gives the type (`z.infer`), the runtime check and the JSON Schema; never hand write a type that duplicates a schema.
- No vendor specific field may appear here; adapters translate at their edge. `src/exports.test.ts` enforces it (and a doc comment on every export) over every exported schema.
- Helpers beside the schemas are pure and never throw: checks return issue lists (`checkConversation`, `checkStreamOrder`), and repair returns a new value.
- JSON Schema comes only from `jsonSchemaOf` / `toolInputJsonSchema` (draft 2020-12, `io: "input"`). After changing `Settings`, run `bun run schemas` and commit `schemas/settings.schema.json`; `bun run check` fails while it is stale.
- Saved records carry `v`. A breaking change to session records bumps `SESSION_VERSION` and adds a `SESSION_MIGRATIONS` entry; the committed `packages/env/src/fixtures/session-v1.jsonl` must keep parsing.

## Agent skills

- [zod](../../.claude/skills/zod/): `pproenca/dot-skills`, Zod 4 schemas (listed at root, the main user)

## Related specs

- [spec 0001](../../docs/specs/0001-stack-architecture/index.md) (module map, core to frontend contract); shapes owned by #3
- [spec 0002](../../docs/specs/0002-core-data-model/index.md) (every shape here, settings layering, session file versioning)
- [spec 0004](../../docs/specs/0004-provider-layer-openai-adapter/index.md) (`FakeScript` and `ProviderErrorCode` in `src/fake-script.ts`, the aborted stream rule in `checkStreamOrder`)
- [spec 0006](../../docs/specs/0006-permission-prompts-modes/index.md) (`mode_change`, `turn_end denied`, `PLAN_BLOCKED_TEXT`, `NOT_RUN_TEXT`, `classifyResultText`)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
