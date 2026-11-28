# Epic: Agent

The agent loop and everything that shapes what the model knows and how it behaves. Part of the [pk scope](index.md).

## Slice 1: First working conversation

### 6. Agent loop & read file tool · done
The loop: send the conversation, run the tool calls the model makes, feed results back, repeat until the task is done, the user interrupts, or the turn limit is reached. First tool: read a file with line numbers. A minimal placeholder system prompt until #17.
**Done when:** you run `pk`, ask about a file, the model reads it through a real tool call and the answer streams back; a failing tool call goes back to the model as an error and the session continues; the turn limit stops a runaway loop with a clear message. This is the walking skeleton. (basis: tracer bullet, the first slice touches every layer)
spec [0005](../specs/0005-agent-loop-read-file/index.md)
code in `packages/agent/src/`, `packages/tools/src/`, `packages/permissions/src/`, `packages/cli/src/session-setup.ts`
- [x] Design it (spec): `/architect agent loop & read file tool`
- [x] Build it: `/develop agent loop & read file tool`
  - [x] The thread runs end to end: tool interface, thin read_file, permission seam, session, `pk` wired to the screen, PTY e2e (AC-1, AC-2, AC-10, AC-15, AC-16)
  - [x] The loop handles every outcome: turn limit, usage and retries, error results, stop reasons, provider and internal errors (AC-3, AC-4, AC-7, AC-8, AC-9)
  - [x] Control: queue, interrupt and its races, close, the permission ask path (AC-5, AC-6, AC-10)
  - [x] read_file complete: path scope, windowing and caps, errors, ledger (AC-11, AC-12, AC-13, AC-14)
- [x] Verify it: `/check verify agent loop & read file tool`
- [x] Test it: `/test agent loop & read file tool`
- [x] Review it (fresh model): `/check review agent loop & read file tool`
- [x] Document it: `/document agent loop & read file tool`

## Slice 5: Project awareness and behavior

### 16. Project instructions & environment context · needs a decision
Load PK.md instruction files (user level and project level) into context, plus environment details (OS, shell, working directory, date) and git state (branch, status, recent commits). `/init` writes a starter PK.md from the real project.
**Done when:** instructions from both levels are applied with a clear precedence; git state appears only inside a repository; `/init` writes a useful PK.md and never overwrites an existing one without asking; `/context` can show what was loaded.
- [ ] Design it (spec): `/architect project instructions & environment context`

### 17. System prompt · needs a decision
pk's own clean room system prompt: explore before changing anything, make minimal changes in the project's existing style, check work by actually running it, report concisely, never claim success it hasn't verified, and never take destructive actions, commit, or touch secrets without being asked.
**Done when:** the prompt is versioned in the repo and works across providers; tests show the agent reads before editing and runs a check after changing code; pk-bench (#27) can compare prompt versions later.
- [ ] Design it (spec): `/architect system prompt`

## Slice 7: Long sessions

### 24. Session save, continue & resume · needs a decision
Every session is saved locally as it goes. `pk --continue` picks up the last one; `/resume` and `pk --resume` pick from a list.
**Done when:** a session interrupted or closed can be continued with full history, todos and model choice; the resume list shows when, where and what each session was; saved sessions contain no secrets.
- [ ] Design it (spec): `/architect session save, continue & resume`

### 25. Context compaction · needs a decision
When the context window fills, summarize older parts of the conversation (using the summarizing model role) so long sessions keep working. `/compact` does it on demand; `/context` shows usage.
**Done when:** a session that passes the model's context limit keeps going without losing the current task, open todos or files being edited; `/compact` accepts an optional focus note; `/context` shows what fills the window.
- [ ] Design it (spec): `/architect context compaction`

## Slice 11: Extensibility

### 35. Hooks · needs a decision
User scripts that run before or after tool calls and at session events, for custom checks, formatting or blocking.
**Done when:** a hook can block a tool call with a reason the model sees; hooks run with timeouts and their failures never crash the session; hooks are configured at user or project level and project hooks need explicit trust.
- [ ] Design it (spec): `/architect hooks`

### 38. Subagents · needs a decision
The agent hands a focused task (such as a wide code search) to a child agent with its own context and model role, and gets back a summary.
**Done when:** a subagent runs with its own context and permissions no wider than its parent's, its cost counts toward the session, it can be interrupted with the parent, and only its summary enters the main context.
- [ ] Design it (spec): `/architect subagents`
