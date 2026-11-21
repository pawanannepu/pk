# @pk/schema

## Overview

Zod schemas and the types derived from them, shared by every package: messages, content blocks, tool definitions, calls and results, usage, session records, settings, and the `AgentEvent` union. The bottom of the dependency graph. Stub today; the real shapes arrive with #3 Core data model.

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
- No vendor specific field may appear here; adapters translate at their edge.

## Agent skills

- [zod](../../.claude/skills/zod/): `pproenca/dot-skills`, Zod 4 schemas (listed at root, the main user)

## Related specs

- [spec 0001](../../docs/specs/0001-stack-architecture/index.md) (module map, core to frontend contract); shapes owned by #3

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
