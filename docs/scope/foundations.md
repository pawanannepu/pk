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
- [ ] Capture conventions + tooling choices: `/audit`
- [ ] Install the tooling: `/develop tooling`

### 3. Core data model · needs a decision
The provider neutral shapes everything shares: messages and content blocks, tool definitions, tool calls and results, usage and cost records, session files, and the config and settings schema (user and project level).
**Done when:** every later feature (adapters, tools, sessions, headless JSON, bench) can be expressed in these shapes with no vendor specific field leaking into the loop or tools. (basis: the data model is the costliest thing to redo)
- [ ] Design it (spec): `/architect core data model`

### 4. Terminal UI foundation · needs a decision
pk's visual language in the terminal: color tokens, how tool calls, diffs, prompts and errors look, and the plain output rules for `NO_COLOR`, pipes and narrow windows.
**Done when:** a `design.md` covers colors, layout and component styles; diffs read correctly with color off (+ and - markers); output is plain text when not a terminal or `NO_COLOR` is set. (basis: NO_COLOR convention)
- [ ] Design it (spec): `/architect terminal UI foundation`
