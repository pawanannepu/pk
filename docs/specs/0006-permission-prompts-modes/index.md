# 0006. Permission prompts and modes: one decision table, four modes, Shift+Tab to switch

**Date**: 2026-11-28
**Status**: In Progress

## Summary

pk gets its four permission modes (normal, accept edits, plan, skip all) and full answers to a permission prompt. One pure function in `@pk/permissions` decides, for every tool call, whether it runs, asks you, or is blocked, by looking only at the tool's kind, the current mode and what you allowed this session. You switch modes live with Shift+Tab (`/mode` comes with #13). Skip all only turns on with a long, explicit command flag and shows a red warning. A plain deny stops the turn so you can redirect, and a deny with a note sends the note back to the model as guidance.

## Requirements

**User stories**:
- As a pk user, I want every write and command to ask me first in normal mode, so pk never changes or runs anything I did not allow.
- As a pk user, I want to say no with a short note, so the model gets told what to do instead and keeps going.
- As a pk user, I want a plain no to stop the turn, so I can redirect pk with my next prompt instead of watching it try another way.
- As a pk user, I want a read only plan mode, so pk can explore and propose a plan without touching anything.
- As a pk user, I want to switch modes in one keystroke while I work, so accepting a run of edits or stepping into plan mode does not need a restart.
- As someone running pk inside a throwaway sandbox, I want to skip every prompt with one explicit flag, and see clearly that I did.
- As the builder of #8, #9, #10, #13, #24 and #26, I want modes, session allows and the deny paths settled once in the seam spec 0005 made, so later features add rules and tools without rewiring the loop.

**Acceptance criteria** (the contract):

*The decision*

- **AC-1**: `decide(request, state)` in `@pk/permissions` stays pure (no I/O, no clock) and returns `allow`, `ask` or `block`. It checks in this order and the first match wins:
  1. `kind` is `read` → `allow` (every mode).
  2. `mode` is `skip_all` → `allow`.
  3. `mode` is `plan` and `kind` is `write` or `execute` → `block` with `reason: "plan_mode"`.
  4. `mode` is `accept_edits` and `kind` is `write` → `allow`.
  5. `state.sessionAllows` has `request.key` → `allow`.
  6. Anything else → `ask`.

  So the table is:

  | kind | normal | accept_edits | plan | skip_all |
  |---|---|---|---|---|
  | `read` | allow | allow | allow | allow |
  | `write` | ask¹ | allow | block | allow |
  | `execute` | ask¹ | ask¹ | block | allow |
  | `network` | ask¹ | ask¹ | ask¹ | allow |

  ¹ `allow` when the call's key is in `sessionAllows`. A plan mode block wins over a session allow. Unit tests cover all 16 cells, each with and without a matching session allow. The kind and mode checks use exhaustive `switch`es with a `never` check, so a new `ToolKind` or `PermissionMode` is a compile error, and an unhandled case falls through to `ask` (fail safe).
- **AC-2**: Session allow keys. `Tool` gains `permissionKey(input)`, which returns the key `decide` checks and `allow_session` stores.
  - A tool with no `sessionKey` in its `ToolSpec` gets its name as the key, so `[a]` allows the whole tool for the session (write tools, network tools).
  - An `execute` kind tool must declare `sessionKey(input): string` (the exact command string for the shell tool in #9). Its key is `<name>:<sessionKey(input)>`, so `[a]` allows only that exact command. This is enforced by the type: `ToolSpec` with `kind: "execute"` and no `sessionKey` does not compile. `:` cannot appear in a tool name (`TOOL_NAME_PATTERN`), so keys never collide.
  - A non `execute` spec cannot declare `sessionKey` (typed `never`), so write and network tools always key by name. A `defineTool` call with a wide `kind: ToolKind` variable does not compile, by design: the kind must be a literal.
  - The key is exact: `sessionKey`'s output is used as is, with no trimming or normalizing.
  - `permissionKey` parses the input like `execute` does. If that parse fails, it returns `<name>:\u0000invalid`, a key `allow_session` never stores, so a parse failure can never widen into a whole tool allow. (The loop only calls it after `validate` succeeded, so this is a guard, not a path.)
  - `Tool.permissionKey` is required, so every hand written `Tool` stub in tests gains one (most tests switch to `defineTool`).
  - `sessionAllows` survives mode changes and lasts until the session closes. #10 replaces exact keys with rule patterns.
- **AC-3**: Plan mode block. A blocked call never prompts and never runs (no `permission_request`, no `tool_run_start`). It gets one `tool_result` with `durationMs: 0` and the error text `PLAN_BLOCKED_TEXT` followed by `: pk is read only right now, so this call did not run. Keep exploring with read tools and describe your plan; the user will switch modes when ready.`, where `PLAN_BLOCKED_TEXT` is `"blocked by plan mode"`, exported from `@pk/schema`. The turn continues with the next model call.

*Answering a prompt*

- **AC-4**: Deny with a note continues. `deny` with a note that is not empty after trimming gives the result `denied by user (note: <trimmed note>)`, as today, and the turn continues with the next call in the reply, then the next model call.
- **AC-5**: A plain deny stops the turn. `deny` with no note, or a note that is empty after trimming, gives the call the result `denied by user`. Every later call in the same reply gets the error result `NOT_RUN_TEXT` (`"not run: the user denied an earlier call in this reply"`, exported from `@pk/schema`), each with its own `tool_result` event and no `permission_request` or `tool_run_start`. The results message is appended, no further model call is made, and the turn ends `turn_end { reason: "denied" }`. A queued prompt then starts as after `done` (`finishTurn` and the queue handling are unchanged). The conversation passes `checkConversation` at that `turn_end`. Your next prompt continues with full history, so the model sees what you denied.
  - "Every later call" means every one, whatever its kind or state: `read` calls, unknown tools and calls with bad input all get `NOT_RUN_TEXT`, and none is validated or decided.
  - `runCall` returns `{ result, durationMs, stop: boolean }`; `stop` is true only for a plain deny.
  - End reason order after the calls: `signal.aborted` → `interrupted` (an interrupt always wins, AC-14); else a plain deny → `denied`; else the spec 0005 `turn_limit` check. So a deny on the last allowed model call ends `denied`, not `turn_limit`.
- **AC-6**: The panel gains a fourth key. The keys row reads `[y] allow once  [a] this session  [n] deny  [e] deny and explain`; for an `execute` kind call `[a]` reads `[a] this command`. The 300 ms guard applies to all four.
  - `e` (either case) swaps the keys row for a one line note field (`note › `). Enter sends `deny` with the trimmed note; an empty note sends a plain `deny` (AC-5). Esc closes the field and brings the keys row back, sending nothing. The guard is not restarted.
  - Panel state (`keys` or `note`, and the draft) is a local Solid signal in the shell, not HUD state, so typing dispatches no reducer actions. The field is an OpenTUI `input` renderable inside the panel. Opening it focuses it; Esc, Enter or the panel closing blurs it. The main textarea stays unfocused throughout (spec 0003 AC-13).
  - Key names: Enter is `key.name === "return"`, Esc is `key.name === "escape"`. While the field is open the shell stops taking every key (as it does for the keys row) and lets the `input` have them, except Enter, Esc, Ctrl+C, Ctrl+Z and the scroll keys, which the shell still takes first. `y`, `a`, `n`, `e` are typed as text.
  - The draft is capped at 500 code points (further typing and the tail of a paste are dropped). Pasted newlines and tabs become single spaces. Before sending, C0 control characters and DEL are removed (the `sanitizeForScreen` rules, minus newline handling), then the note is trimmed. It is drawn through `sanitizeForScreen`.
  - A `turn_end` (interrupt, error) closes the field and the panel together, and the typed note is dropped.
  - Layout: the keys row wraps onto a second row when the panel's inner width is too narrow for it (ASCII mode included). `PERMISSION_FIXED_ROWS` grows by 1 to reserve that row. The note state uses the same rows (the field on the first, a dim `enter send · esc back` on the second), so switching states never moves the panel.

*Modes*

- **AC-7**: Startup mode. `cli` resolves it with the pure `resolveStartMode({ flagMode, skipFlag, settingsMode })` from `@pk/permissions`, which returns `{ mode, skipAllAvailable, notices }`:
  - `--dangerously-skip-permissions` → `skip_all`, `skipAllAvailable: true`.
  - else `--mode <normal|accept_edits|plan>` → that mode.
  - else `settings.permissions.mode` (user settings only, already enforced by `USER_ONLY_SETTINGS`) when it is `normal`, `accept_edits` or `plan`.
  - `settings.permissions.mode: "skip_all"` is ignored: the mode falls to `normal` and `notices` holds one `notice { level: "warning", code: "permissions.skip_all_setting_ignored", text: "permissions.mode \"skip_all\" in your settings is ignored. Start pk with --dangerously-skip-permissions to skip all prompts." }`.
  - else `normal`. `skipAllAvailable` is `false` unless the skip flag was given.
  - When `--mode` is given, the settings value is never read, so a `skip_all` setting gives no notice in that case (intended).
  - Both flags are options on the main `pk` command (not program wide), so `__tui-demo` and `__tui-smoke` neither accept nor read them; the demo keeps its scripted `info.mode: "normal"`.
  - `--mode` with any other value is a commander usage error; `main` already maps a non zero `CommanderError` to exit 2, and a test covers it. `--mode` together with `--dangerously-skip-permissions` prints `pk: --mode and --dangerously-skip-permissions cannot be used together.` to stderr and exits 2 (`EXIT.usage`). This clash check is the first thing the action does, before `refuseWithoutTerminal`, so it reports the same way with or without a terminal. `resolveStartMode` itself runs inside the `runScreen` callback, after settings load.
- **AC-8**: The session owns the mode. `AgentDeps` gains `mode: PermissionMode`, `skipAllAvailable: boolean` and `notices: readonly StartNotice[]`. The session emits each start notice, in order, inside `createAgentSession`, so they are its first events (from `seq` 0, before any `turn_start`). The channel buffers them until the screen starts reading, so a late reader still gets them. Every `decide` call reads the mode at that moment, so a change mid turn applies to the next call. `createAgentSession` throws `AgentError` `agent.invalid_mode` (a wiring bug, like `agent.duplicate_tool`) when `deps.mode` is `skip_all` and `deps.skipAllAvailable` is false, so the "skip all only with the flag" invariant does not rest on `cli` alone.
- **AC-9**: `session.setMode(mode)` and a synchronous `readonly mode: PermissionMode` getter (both on `AgentSession` and the `TuiSession` port).
  - Same as the current mode, or called after `close()` → nothing happens.
  - `skip_all` while `skipAllAvailable` is false → ignored, logged at `debug`.
  - Otherwise the mode changes at once (the getter returns it before any event is read), `mode_change { mode }` is emitted, and `mode change` is logged at `info` with `from` and `to`. This works the same while idle; no turn is needed.
  - If a permission request is pending, it is decided again with `decide(pending.request, { mode: newMode, sessionAllows })`, reading the session's current `sessionAllows`. `pending` is `{ requestId, request: PermissionRequest, resolve }`, and the wait resolves with `Waited = { kind: "answer", answer: PermissionAnswer } | { kind: "mode_allow", mode: PermissionMode } | { kind: "mode_block" }`, or `undefined` on abort. `setMode` clears `pending` before calling `resolve` (as `respond` does), so a late `respond` or a second `setMode` finds nothing to resolve. `runCall` keeps its first check, `waited === undefined || signal.aborted` → interrupted, so an abort beats both `respond` and `setMode`.
  - `mode_allow` runs the call as if `allow_once` (no session allow is stored). It leaves a trace: an `info` notice `allowed by <mode words> mode` (code `permissions.allowed_by_mode`, `<mode words>` being `accept edits` or `skip all`) before `tool_run_start`, and an `info` log with the tool name, call id and mode. `mode_block` gives the AC-3 result. `ask` keeps the same request waiting (no new event).
  - The screen's reducer drops a pending permission whose `call.id` matches a `tool_run_start` or `tool_result` callId, which closes the panel (and its note field) when a mode switch settles it.
- **AC-10**: Shift+Tab switches modes. The shell takes Shift+Tab (`key.name === "tab" && key.shift`, the `\x1b[Z` sequence) before the input and calls `session.setMode(nextMode(session.mode, info.skipAllAvailable))`. It reads the session's synchronous getter, never HUD state, so two fast presses step two modes. The cycle is `normal → accept_edits → plan → normal`; with `skipAllAvailable` it is `normal → accept_edits → plan → skip_all → normal`. Shift+Tab is ignored during the 300 ms panel guard, while the note field is open, and in `too_small`. The footer's mode marker and the SESSION rail's mode follow `mode_change` events (seeded from `info.mode`), with the marker colors spec 0003 already set. The footer hints gain `shift+tab mode`.
- **AC-11**: Skip all is loud. The transcript gets a red line `skip all: every tool runs without asking` (`red` token, the warn glyph) once each time the HUD mode enters `skip_all`: at mount when `info.mode` is `skip_all` (`initialHudState` takes `info.mode` and adds it), and on each `mode_change` into `skip_all`, one line per entry on every lap of the cycle. The line stays in the transcript after the mode leaves `skip_all`. It is a screen only transcript item (a `danger` level on the HUD notice item), not an `AgentEvent`, and it counts toward the header's warnings like a `warning` notice. The footer marker stays red while in `skip_all`.
  - Start items and the hero: notices and the red line that exist before your first prompt do not end the hero. The hero's condition becomes "no message yet" (no `ui_submit` and no `message` event) instead of "transcript empty", and the start items show above the input under the hero until then.

*Screen and contracts*

- **AC-12**: The screen shows the new outcomes. `turn_end` with `denied` adds the info line `stopped: you denied a tool call`. The HUD tool view's `denied: boolean` becomes `outcome?: "denied" | "blocked" | "not_run"`, set from `classifyResultText` on an error result. Each shows dim with its state word (`denied`, `blocked`, `not run`) and none is counted in the header's error count.
- **AC-13**: Schema changes, all additive. `TurnEndReason` gains `"denied"`. `AgentEvent` gains `mode_change { mode: PermissionMode }`. `sessionRecordFromEvent` returns `undefined` for `mode_change` (persisting it is #24's call). `PLAN_BLOCKED_TEXT` and `NOT_RUN_TEXT` are exported with doc comments, plus `classifyResultText(text): "denied" | "blocked" | "not_run" | undefined` (prefix match for `DENIED_TEXT` and `PLAN_BLOCKED_TEXT`, equality for `NOT_RUN_TEXT`), so the screen and later headless share one matcher. Every exhaustive switch over these unions (`tui` reducer, `schema` session records, anything `bun run check` finds) handles the new members.
- **AC-14**: Interrupt still wins. An interrupt while a prompt or the note field is open ends the turn `interrupted` exactly as spec 0005 AC-6 says; a `setMode` racing the abort never runs the call.
- **AC-15**: The compiled binary proves the process behavior in a PTY (`bun run test:e2e`): `pk --mode plan` shows `plan` in the footer; Shift+Tab then shows `normal`; `pk --dangerously-skip-permissions` shows the red skip all line and a red `skip_all` marker; `--mode plan --dangerously-skip-permissions` exits 2 with the AC-7 message; with `permissions.mode: "skip_all"` in a temp user settings file, pk starts in `normal` with the AC-7 warning notice.

## Decision

**Chosen option**: Option 1: one pure decision table in `@pk/permissions`, with the mode held by the session and changed through `setMode`.

The loop asks `decide` before every call, `decide` reads kind, mode and session allows and nothing else, and every mode rule lives in that one table.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch** (in memory only, no files written):

| Shape | Package | Fields | Notes |
|---|---|---|---|
| `PermissionRequest` | `permissions` | `tool: ToolName` · `kind: ToolKind` · `key: string` | `key` from `Tool.permissionKey(input)` |
| `PermissionState` | `permissions` | `mode: PermissionMode` · `sessionAllows: ReadonlySet<string>` | keys, not tool names (was `ReadonlySet<ToolName>`) |
| `PermissionDecision` | `permissions` | `{ decision: "allow" }` · `{ decision: "ask" }` · `{ decision: "block", reason: "plan_mode" }` | `reason` is a one member union today, so #10 can add `deny_rule` |
| `StartMode` | `permissions` | `mode: PermissionMode` · `skipAllAvailable: boolean` · `notices: readonly StartNotice[]` | from `resolveStartMode` |
| `StartNotice` | `permissions` | `level: "info" \| "warning"` · `code: string` · `text: string` | emitted as `notice` events |
| session state | `agent` | adds `mode: PermissionMode`; `pending` becomes `{ requestId, request: PermissionRequest, resolve(waited: Waited) }` so `setMode` can decide it again | replaced, never changed in place |
| `Waited` | `agent` (internal) | `{ kind: "answer", answer }` · `{ kind: "mode_allow", mode }` · `{ kind: "mode_block" }` | what a permission wait resolves with; `undefined` on abort |
| `ToolSpec<I>` | `tools` | adds `sessionKey?: (input: I) => string`, required when `kind` is `"execute"` | type level union |
| `Tool` | `tools` | adds `permissionKey(input: unknown): string` | parses like `execute` does |
| `TuiInfo` | `tui` | adds `skipAllAvailable: boolean` | |
| HUD state | `tui` | adds `mode: PermissionMode` (from `info.mode` via `initialHudState`, then `mode_change`); tool views swap `denied: boolean` for `outcome?: "denied" \| "blocked" \| "not_run"`; notice items gain `level: "danger"` | the note draft is a shell signal, not HUD state |
| `TuiSession` | `tui` | adds `setMode(mode)` and `readonly mode` | `createScriptedSession` implements both and emits `mode_change` |
| `AgentEvent` | `schema` | adds `{ type: "mode_change", mode: PermissionMode }` | |
| `TurnEndReason` | `schema` | adds `"denied"` | |

**State transitions**:

Mode: set at start by `resolveStartMode`; then `setMode` moves it along the Shift+Tab cycle (any mode to any other through `setMode`, but `skip_all` only when `skipAllAvailable`). Each real change emits one `mode_change`.

A call: `validated` → `decide`:
- `allow` → `tool_run_start` → `tool_result`.
- `block` → `tool_result` (AC-3), next call.
- `ask` → `permission_request` → waiting → one of: `allow_once` / `allow_session` (store key) → run; `deny` with note → `tool_result` denied, next call; plain `deny` → `tool_result` denied, every later call `not run`, `turn_end denied`; `setMode` → decide again (`allow` run, `block` blocked, `ask` keep waiting); abort → spec 0005 interrupted path.

Panel (screen): `keys` (guard 300 ms, then listening) → `e` → `note` → Enter (send) or Esc (back to `keys`). Any `turn_end`, `tool_run_start` or `tool_result` for the call closes it.

**API surface**:

| Function / member | Package | Key inputs | Key outputs | Errors |
|---|---|---|---|---|
| `decide(request, state)` | `permissions` | `PermissionRequest`, `PermissionState` | `PermissionDecision` | none, pure |
| `resolveStartMode(input)` | `permissions` | `flagMode?: "normal" \| "accept_edits" \| "plan"`, `skipFlag: boolean`, `settingsMode?: PermissionMode` | `StartMode` | none, pure; `cli` rejects the flag clash before calling it |
| `Tool.permissionKey(input)` | `tools` | the value `validate` produced | `string` key | none |
| `defineTool(spec)` | `tools` | `ToolSpec<I>`, with `sessionKey` required for `execute` | `Tool` | compile time only |
| `createAgentSession(deps)` | `agent` | spec 0005 deps plus `mode`, `skipAllAvailable`, `notices` | `AgentSession` | as spec 0005 |
| `session.setMode(mode)` | `agent`, `TuiSession` port | `PermissionMode` | void, emits `mode_change` | none (ignored when not allowed) |
| `session.respond(requestId, answer)` | `agent` | as spec 0005 | void | none |
| `nextMode(mode, skipAllAvailable)` | `tui` | `PermissionMode`, `boolean` | `PermissionMode` | none, pure |
| `pk [--mode <m>] [--dangerously-skip-permissions]` | `cli` | flags | the screen | exit 2 on a bad or clashing flag |

**Value sourcing**:

| Action | Value | Source |
|---|---|---|
| `decide` | `kind` | `tool.definition.kind` |
| `decide` | `key` | `tool.permissionKey(validated.input)`: the tool name, or `<name>:<sessionKey(input)>` for `execute` |
| `decide` | `mode` | session state: `deps.mode`, then each accepted `setMode` |
| `decide` | `sessionAllows` | session state, adds `request.key` on `allow_session` |
| start | `deps.mode`, `deps.skipAllAvailable`, `deps.notices` | `resolveStartMode` from the `--mode` flag, the `--dangerously-skip-permissions` flag, `settings.permissions.mode` (user file only) |
| start | `info.mode`, `info.skipAllAvailable` | the same `StartMode` |
| `mode_change` | `mode` | the argument to `setMode` |
| Shift+Tab | the next mode | `nextMode(session.mode, info.skipAllAvailable)` (the synchronous getter, not HUD state) |
| mode allow trace | notice text and log | `permissions.allowed_by_mode`, the mode from `Waited.mode` |
| pending re-decision | `sessionAllows` | the session's current state at the `setMode` call |
| tool line outcome | `denied` / `blocked` / `not run` | `classifyResultText(result text)` |
| footer, SESSION rail | mode | HUD `mode`: `info.mode`, then `mode_change` |
| plan block result | text | `PLAN_BLOCKED_TEXT` + the AC-3 sentence (a constant in `agent/src/results.ts`) |
| plain deny | denied text | `DENIED_TEXT` |
| plain deny | later calls' text | `NOT_RUN_TEXT` |
| note deny | note | the panel's note field, trimmed, at most 500 characters |
| deny stops or continues | which path | whether the trimmed note is empty |
| panel `[a]` label | `this session` or `this command` | `permission_request.kind` |
| red skip all line | when it shows | `info.mode` at mount, then each `mode_change` into `skip_all` |
| settings warning | text and code | the AC-7 constants in `permissions` |

**Key invariants**:
- No `write` or `execute` call runs in `normal` mode without a `permission_request` answered `allow_once` or `allow_session`, or a matching session allow.
- No `write` or `execute` call runs in `plan` mode, whatever is in `sessionAllows`.
- `skip_all` is reachable only when `--dangerously-skip-permissions` was given at start. No settings file can turn it on.
- `decide` is the only place a mode rule lives. The loop, the tools and the screen never test the mode to allow or block a call.
- Each real mode change gives exactly one `mode_change`. At most one permission request is pending per session (calls run one at a time).
- A turn still ends with exactly one `turn_end`, and the conversation is valid at every `turn_end`.

**Security model**:
- Least privilege by default: `normal` asks for everything that is not `read`. Session allows for commands are exact strings, so `[a]` on `rm -rf dist` never allows `rm -rf /`.
- `skip_all` needs a flag typed on every launch, with a name that says what it does, and it cannot come from any settings file. `permissions.mode` itself stays user only, so a cloned repo's `.pk/settings.json` can never change the mode.
- Mode changes come only from you (Shift+Tab, later `/mode`). The model has no tool that changes the mode.
- The 300 ms guard also covers Shift+Tab, so a keystroke meant for the input can never approve a pending call by switching into `accept_edits`.
- The deny note goes to the model as tool result text through the same `errorOutcome` path (redacted and clipped). Logs record tool names, ids, decisions and modes, never the call input, the command or the note at `info`.

**Configuration required**:
- No new environment variables or credentials.
- New flags on `pk`: `--mode <normal|accept_edits|plan>` and `--dangerously-skip-permissions` (help: `skip every permission prompt; only for sandboxes`).
- Settings: `permissions.mode` (already in spec 0002) is now read; `skip_all` there is ignored with a warning. `schemas/settings.schema.json` does not change.

**Critical test scenarios**:
- Happy path: in `normal`, a test write tool asks; `y` runs it; the next call asks again; `a` stores the key and the third call runs with no prompt. Verifies **AC-1**, **AC-2**.
- Mode table: all 16 cells of `decide`, with and without a session allow; `plan` plus a session allow still blocks. Verifies **AC-1**.
- Exact command key: a test execute tool with `sessionKey: (i) => i.command`; `[a]` on `ls` lets `ls` run again with no prompt but `ls -la` asks. A spec with `kind: "execute"` and no `sessionKey` fails typecheck (a `@ts-expect-error` test). Verifies **AC-2**.
- Plan mode: a reply with a write call then a read call gives the AC-3 block result, then the read runs, then the next model call. No `permission_request` is emitted. Verifies **AC-3**.
- Plain deny: a reply with three write calls; deny the first with no note. Results are `denied by user`, `not run…`, `not run…`; no second model call; `turn_end denied`; `checkConversation` is `[]`; a queued prompt starts. Verifies **AC-5**, **AC-13**.
- Note deny: deny with `"  use the edit tool  "` gives `denied by user (note: use the edit tool)` and the turn continues; a note of only spaces acts as a plain deny. Verifies **AC-4**, **AC-5**.
- Live switch: a write prompt is pending; `setMode("accept_edits")` emits `mode_change`, the call runs with no answer, and the panel closes; `setMode("plan")` instead gives the block result; `setMode("normal")` on a pending `execute` call keeps it waiting. `setMode("skip_all")` without the flag does nothing. Verifies **AC-9**.
- Startup: each `resolveStartMode` branch, including the ignored `skip_all` setting with its notice emitted before the first `turn_start`. Verifies **AC-7**, **AC-8**.
- Screen: Shift+Tab cycles three modes (four with the flag), is ignored during the guard and while the note is open; the footer follows `mode_change`; `e`, typing, Esc, Enter in the panel; the red skip all line on entry; denied, blocked and not run lines are not counted as errors. Verifies **AC-6**, **AC-10**, **AC-11**, **AC-12**.
- Interrupt: abort while the note field is open ends `interrupted` and drops the note; a `setMode` after the abort runs nothing; a `respond` after a `setMode` settled the request is ignored. Verifies **AC-9**, **AC-14**.
- Race and wiring: two Shift+Tab presses before any event is read land two modes on; `createAgentSession` with `mode: "skip_all"` and `skipAllAvailable: false` throws `agent.invalid_mode`; a deny on the last allowed model call ends `denied`, not `turn_limit`. Verifies **AC-5**, **AC-8**, **AC-10**.
- Binary: the AC-15 PTY cases. Verifies **AC-7**, **AC-10**, **AC-11**, **AC-15**.

## Build plan

Tracer Bullet: milestone 1 makes one mode real through every layer (flag, settings, session, `decide`, screen, a blocked call reaching the model). Each later milestone thickens one segment.

**Milestone 1: plan mode end to end (the thin thread)**
1. `@pk/schema`: add `mode_change` to `AgentEvent`, `"denied"` to `TurnEndReason`, `PLAN_BLOCKED_TEXT` and `NOT_RUN_TEXT`; handle `mode_change` in `sessionRecordFromEvent`; fix every exhaustive switch `bun run check` flags, satisfies **AC-13**.
2. `@pk/permissions`: `PermissionState.mode`, the `block` decision and the AC-1 check order with all 16 cells tested, satisfies **AC-1**.
3. `@pk/agent`: `AgentDeps.mode`; `runCall` passes the mode to `decide` and turns `block` into the AC-3 result with no prompt and no run, satisfies **AC-1**, **AC-3**.
4. `@pk/permissions`: `resolveStartMode` (flag, settings, ignored `skip_all` with its notice); `@pk/agent`: `AgentDeps.notices` emitted first, satisfies **AC-7**, **AC-8**.
5. `cli`: the `--mode` option with commander choices, `resolveStartMode` wired into `prepareSession` and `startTui` (`info.mode` is real now; drop the `"normal"` pin and its comment), satisfies **AC-7**, **AC-8**.
6. `tui`: HUD `mode` seeded from `info.mode` and updated by `mode_change`; footer and SESSION read it; `PLAN_BLOCKED_TEXT` results shown dim as `blocked`, not counted as errors, satisfies **AC-10**, **AC-12**.

**Milestone 2: the deny paths**
7. `@pk/agent`: split `deny` on the trimmed note; `runCall` returns `stop`; plain deny gives `not run` results to every later call in the reply and ends `turn_end denied` in the AC-5 order (aborted, denied, turn limit); the queue continues, satisfies **AC-4**, **AC-5**.
8. `@pk/schema` and `tui`: `classifyResultText`; the tool view's `outcome` field replacing `denied`; the `denied` turn end line; `not run` results dim and not counted, satisfies **AC-12**, **AC-13**.
9. `tui`: the `[e] deny and explain` key and the note field as a shell signal plus an OpenTUI `input` (focus, Enter, Esc, 500 code points, paste and control character cleanup), the wrapping keys row and the extra fixed row, closed by `turn_end`; update `docs/design.md`'s permission panel section and the demo script's second turn to show it, satisfies **AC-6**, **AC-14**.

**Milestone 3: session allow keys**
10. `@pk/tools`: `ToolSpec.sessionKey` (required for `execute` by type), `Tool.permissionKey`; `read_file` unchanged, satisfies **AC-2**.
11. `@pk/permissions` and `@pk/agent`: `PermissionRequest.key`, `sessionAllows` as a set of keys, `allow_session` stores the key; the panel's `[a] this command` label for `execute`, satisfies **AC-2**, **AC-6**.

**Milestone 4: live switching**
12. `@pk/agent`: `setMode` and the `mode` getter with `mode_change` (idle too, ignored after `close()`), the `skip_all` gate, the `Waited` wait type, deciding the pending request again with `pending` cleared first, the `allowed by … mode` notice and log, satisfies **AC-9**, **AC-14**.
13. `tui`: `setMode` and `mode` on `TuiSession` (the scripted demo session implements both and emits `mode_change`), `nextMode` from the getter, Shift+Tab with the guard, note and `too_small` exclusions, the reducer dropping a pending permission on `tool_run_start` / `tool_result` for its call, the `shift+tab mode` hint; add Shift+Tab to spec 0003 AC-7's list of shell keys in `docs/design.md`, satisfies **AC-9**, **AC-10**.

**Milestone 5: skip all**
14. `cli`: `--dangerously-skip-permissions`, the clash with `--mode` checked first (exit 2), `skipAllAvailable` into `AgentDeps` and `TuiInfo`; `@pk/agent`: the `agent.invalid_mode` check, satisfies **AC-7**, **AC-8**.
15. `tui`: `skip_all` in the cycle only when available; `initialHudState` takes `info.mode`; the red `danger` line at mount and on each entry, counted as a warning; the hero shows until the first message, not until the transcript is empty, satisfies **AC-10**, **AC-11**.
16. `test:e2e`: the AC-15 PTY cases against the compiled binary, satisfies **AC-15**.

## Consequences

**Positive**:
- Every mode rule is one table in one pure function, so the whole safety surface is tested by 16 cells plus a handful of loop tests, and #10 adds rules in the same place.
- #8 and #9 only declare `kind` (and `sessionKey` for the shell); they get prompts, modes and plan mode for free.
- A plain no actually stops, which is what people mean by it, and a note steers without stopping.
- `skip_all` cannot be turned on by accident or by a settings file.

**Negative / tradeoffs**:
- Exact command session allows are narrow: `bun test a` and `bun test b` each ask once, until #10 brings prefix rules.
- Plan mode tells the model about itself only through block results. A model that does not try a write never learns it is in plan mode until #17 teaches the system prompt.
- `turn_end denied` and `mode_change` are new contract members, so every reader of the event stream (the screen now, headless #26 and session files #24 later) must handle them.
- In `accept_edits`, every write tool runs with no prompt, including any that #8 adds later, until #10's always ask list catches writes outside the project.
- Shift+Tab is now taken by the shell, so the input can never use it.

**Neutral**:
- Reading outside the project stays a hard refusal in `read_file`; it moves from spec 0005's #7 follow up to #10.
- No session file record for mode changes yet; #24 decides whether resume restores the mode.
- The panel gains a fourth key and a note state, and `docs/design.md` changes with it.

## Follow-up

- [ ] Spec 0005's follow up list says #7 turns the outside path refusal into an ask. That moved to #10 (decided in this spec); update the 0005 line and #10's scope text when #10 is designed.
- [ ] #10 Permission rules: replace exact keys with rule patterns, add `block` reasons for deny rules, and make the always ask list beat `accept_edits` and session allows (but not `skip_all`).
- [ ] #13 Slash commands: `/mode` calls the same `session.setMode`; no new session surface.
- [ ] #17 System prompt: tell the model the current mode and what plan mode means. Revisit a "propose plan for approval" tool then.
- [ ] #24 Sessions: decide whether `mode_change` is saved and whether resume restores the mode (recommend: never restore `skip_all`).
- [ ] #26 Headless: `ask` must resolve without a person (deny unless flags allow); the same `--mode` and skip flag apply; `turn_end denied` needs an exit code.
- [ ] #8, #9, #10, #36: declare `kind` truthfully, and when unsure (an MCP tool, for example) default to `execute`. The shell tool's `sessionKey` is the exact command string; it carries no working folder or environment, so once #9 defines how the working folder works, #9 and #10 decide whether the key must include it.
- [ ] #15 Esc interrupt: Esc already means "back" inside the note field. Decide whether Esc on the keys row interrupts the turn, and keep the note field's Esc local.
- [ ] Scope #7 says "`/mode` switches". This spec ships Shift+Tab and moves `/mode` to #13; the scope text is updated when this spec is linked.
