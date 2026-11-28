# @pk/tui

## Overview

The full screen terminal UI on OpenTUI with Solid. Renders the event stream, answers requests, owns slash commands, and reaches stores and settings only through `AppServices`. Today it holds only the smoke screen (`smoke.tsx`, #1); the real UI starts with #4 Terminal UI foundation.

## Stack

- Frontend package: may use Bun types. `@opentui/core` 0.9.7, `@opentui/solid` 0.9.7, `solid-js` 1.9.20 (exact pins).
- May depend on: `@pk/schema`, `@pk/agent`, `@pk/env`, `@opentui/*`, `solid-js` (spec 0001 module map, checked by `bun run boundaries`)

## Commands

```bash
bun --filter @pk/tui typecheck   # type check this package
bun test packages/tui            # this package's tests
```

## Conventions

Root `## Rules` apply here. In addition:

- The only package with `.tsx` files and the only importer of `@opentui/*` and `solid-js`.
- Tests render in memory with `@opentui/core/testing`; the root test preload compiles Solid JSX.
- Write idiomatic Solid (signals, memos, `<For>`, `<Show>`), not React habits.
- The shell takes Shift+Tab before the input and steps modes from `session.mode` (the synchronous getter), never from HUD state. Permission panel key handling lives in `src/permission-keys.ts`; the panel's note field state is a local Solid signal in the shell, not HUD state (spec 0006 AC-6, AC-10).

## Gotchas

- `cli` loads this package with a dynamic `import()` so `pk --version` and `pk -p` never load OpenTUI's native library. Keep module level code free of side effects.
- OpenTUI is pre 1.0 and 0.9.0 removed APIs: read the release notes before any upgrade.

## Agent skills

- [opentui](../../.claude/skills/opentui/): `anomalyco/opentui`, OpenTUI components, layout, testing and deployment
- [solid-js-1x-best-practices-and-api](../../.claude/skills/solid-js-1x-best-practices-and-api/): `doeixd/solid-skill`, idiomatic Solid 1.x reactivity
- [terminal-ui](../../.claude/skills/terminal-ui/): `ratacat/claude-skills`, terminal UI design quality

## Related specs

- [spec 0001](../../docs/specs/0001-stack-architecture/index.md) (interactive UI); feature #4
- [spec 0006](../../docs/specs/0006-permission-prompts-modes/index.md) (permission panel keys and note field, Shift+Tab, mode display)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
