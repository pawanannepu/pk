# @pk/tools

## Overview

The `Tool` interface (definition plus executor) and the built in tools: read, write and edit, shell, search and listing, to do. #6 (spec 0005) ships the interface (`src/tool.ts`, `defineTool`), the project root check (`src/path-scope.ts`) and the first tool, `read_file` (`src/read-file.ts`).

## Stack

- Core package (runtime neutral). Subprocesses use `node:child_process`, never `Bun.spawn`.
- May depend on: `@pk/schema`, `@pk/env`, plus `zod` for tool input schemas (spec 0001 module map, amended by spec 0005, checked by `bun run boundaries`)

## Commands

```bash
bun --filter @pk/tools typecheck   # type check this package
bun test packages/tools            # this package's tests
```

## Conventions

Root `## Rules` apply here. In addition:

- Tools never ask for permission themselves; `agent` asks `permissions` before running one.
- Every tool run takes the turn's `AbortSignal`.
- Tools read the disk only through the `FileSystem` port in `ToolContext` (built by `cli`), never `node:fs` directly, and report what they read as `stamps`; the loop owns the read ledger.
- A failure the model should act on is thrown as `ToolError` with a stable `tool.*` code; its `message` is the text the model sees, so write it for the model.
- Every file tool resolves its `path` with `resolveInProject`: project root only, checked on real paths, `~` not expanded.
- Declare `kind` truthfully (when unsure, use `execute`): it alone decides how modes treat the tool. An `execute` tool must declare `sessionKey(input)` (the type refuses one without it), so `Tool.permissionKey` gives `<name>:<sessionKey>`; every other kind keys by name (spec 0006 AC-2).

## Related specs

- [spec 0001](../../docs/specs/0001-stack-architecture/index.md) (module map, subprocesses); features #6, #8, #9, #11, #12
- [spec 0005](../../docs/specs/0005-agent-loop-read-file/index.md) (the `Tool` interface, `read_file`, path scope, error texts)
- [spec 0006](../../docs/specs/0006-permission-prompts-modes/index.md) (`permissionKey`, `sessionKey`)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
