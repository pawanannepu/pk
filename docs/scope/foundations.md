# Epic: Foundations

The ground every slice stands on. Part of the [pk scope](index.md).

## Foundation

### 1. Stack & architecture
Decide the language, runtime and module layout (provider layer, agent loop, tools, permissions, terminal UI, headless, bench as separate modules with clear boundaries), then scaffold a runnable project. Clean room: nothing is copied from other agents.
**Done when:** the stack and module boundaries are recorded in a spec, and an empty `pk` command builds, runs and prints its version on macOS and Linux. (basis: the stack is the one place tools are chosen; everything else depends on it)
spec [0001](../specs/0001-stack-architecture/index.md) · code in [packages/](../../packages/)
- [x] Decide the stack (spec): `/architect stack & architecture`
- [x] Scaffold from the decision: `/develop stack & architecture`
- [x] Verify it: `/check verify stack & architecture`
- [x] Test it: `/test stack & architecture`
- [x] Review it (fresh model): `/check review stack & architecture`
- [x] Document it: `/document stack & architecture`

### 2. Coding standards & tooling
Capture conventions and tooling choices from the real scaffolded project, then install lint, format, type strictness, pre commit checks and CI so all later code follows them.
**Done when:** root `AGENTS.md` reflects the real stack, and lint, format, tests and CI run clean on the empty project.
- [x] Capture conventions + tooling choices: `/audit`
- [x] Install the tooling: `/develop tooling`

### 3. Core data model
The provider neutral shapes everything shares: messages and content blocks, tool definitions, tool calls and results, usage and cost records, session files, and the config and settings schema (user and project level).
**Done when:** every later feature (adapters, tools, sessions, headless JSON, bench) can be expressed in these shapes with no vendor specific field leaking into the loop or tools. (basis: the data model is the costliest thing to redo)
spec [0002](../specs/0002-core-data-model/index.md) · code in [packages/schema/](../../packages/schema/), [packages/env/](../../packages/env/)
- [x] Design it (spec): `/architect core data model`
- [x] Build it: `/develop core data model`
  - [x] Tracer thread: IDs, private JSONL write, session read back and fold, one key settings load (AC-4, AC-8, AC-12, AC-14, AC-16, AC-17)
  - [x] Conversation and provider boundary: every block, repair, tool definitions, usage and cost, stream events, vendor field guard (AC-1, AC-2, AC-3, AC-5, AC-7)
  - [x] Events and saved files: the full event union, session records and fold, blobs, cost and history records (AC-6, AC-8, AC-9, AC-10)
  - [x] Settings and published schema: full settings, layered load with user only keys, project root and key, `schemas/settings.schema.json` (AC-11, AC-12, AC-13, AC-15, AC-17)
- [x] Verify it: `/check verify core data model`
- [x] Test it: `/test core data model`
- [x] Review it (fresh model): `/check review core data model`
- [x] Document it: `/document core data model`

### 4. Terminal UI foundation · needs a decision
pk's visual language in the terminal: color tokens, how tool calls, diffs, prompts and errors look, and the plain output rules for `NO_COLOR`, pipes and narrow windows.
**Done when:** a `design.md` covers colors, layout and component styles; diffs read correctly with color off (+ and - markers); output is plain text when not a terminal or `NO_COLOR` is set. (basis: NO_COLOR convention)
- [ ] Design it (spec): `/architect terminal UI foundation`
