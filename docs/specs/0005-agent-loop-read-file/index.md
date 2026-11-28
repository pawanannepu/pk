# 0005. Agent loop and read file tool: one session object, one signal per turn

**Date**: 2026-11-27
**Status**: Accepted

## Summary

This spec builds pk's walking skeleton (the first thin path that runs through every layer). You type in `pk`. A session object in `@pk/agent` sends the conversation to the model, runs the tool calls it makes one at a time, feeds the results back, and repeats until the model is done, you interrupt, or 50 model calls have been made. The first tool, `read_file`, reads text files inside the project with line numbers, records what it read for the edit tools (#8), and turns every problem into an error result the model can act on, so a failing tool call never ends the session. Every tool already passes through a small permission check (read tools run freely), so #7 only has to add rules, not rewire the loop.

## Requirements

**User stories**:
- As a developer, I want to ask pk about a file in my project and see the answer stream back, so I can understand code without leaving the terminal.
- As a developer, I want a broken tool call or a flaky provider to show up as a clear message, not a crash, so one bad step never costs me the session.
- As a developer, I want a runaway loop to stop by itself, and Esc or quit to stop it at once, so pk never spends tokens I did not ask for.
- As the builder of #7, #8, #24 and #26, I want the loop, the tool interface, the permission seam and the read ledger designed once, so later features thicken them instead of rewiring them.

**Acceptance criteria**:

*The loop*

- **AC-1**: Running `pk` in a terminal opens the full screen UI on a real `AgentSession`. If you ask about a file, the model calls `read_file` through a real tool call, the result goes back to it, and its answer streams onto the screen. The compiled binary proves this in a PTY (a pseudo terminal, a fake terminal a test can type into) with `PK_FAKE_SCRIPT` (`bun run test:e2e`).
- **AC-2**: Event contract. `seq` starts at 0 for the session and rises by one with every event, across turns. Every event carries `at` (from the injected clock) and `agentId: "main"`. Each turn emits, in this order:
  1. `turn_start`;
  2. a `message` holding your prompt;
  3. for each model call: the streamed `text_delta`, `reasoning_delta` and `tool_call_start` events (all with the reply's `messageId`), then `usage`, then a `message` holding the finished assistant reply;
  4. for each call in that reply, in order: `permission_request` only when one is needed, then `tool_run_start`, then `tool_result`;
  5. one `message` holding all the results of that reply;
  6. exactly one `turn_end`, last.

  The assistant `message` always comes before the `tool_run_start` of any of its calls. At every `turn_end` the conversation passes `checkConversation` with no issues. Every message's `at` comes from `now()` when the message is created.

  Unusual paths follow the same order:
  - `tool_run_start` fires only when a tool's `run` is really called. Unknown tool, invalid input, denied and not started calls skip it.
  - Every call still gets a `tool_result` event, synthetic ones included, with `durationMs: 0` when there was no run start.
  - The results `message` is emitted on the interrupt and error paths too, before `turn_end`, so events and history agree.
  - A kept aborted reply is emitted as a `message`. A dropped one is not.
  - When a reply is dropped on error (AC-7), each `callId` whose `tool_call_start` was already emitted gets a `tool_result` event (not saved in history) with `isError: true` and the text `the reply failed before this call finished`. The screen then never shows it as `interrupted`.
- **AC-3**: Turn limit. Each request to the model counts as one toward the limit for that prompt. The limit is `limits.maxTurns`, or 50 when unset. A retry inside `withRetry` is not a new call, so it does not count. When the model asks for more tools after the last allowed call, those tools still run and their results are recorded. Then `turn_end { reason: "turn_limit" }` ends the turn. The screen already adds its own `▲ turn limit reached` line, so the loop emits no notice. It logs `turn limit <N> reached` at `info`. Your next prompt continues with the full history.
- **AC-4**: Tool failures go back to the model as error results (`isError: true`), and the turn continues with the next model call. The loop checks unknown tool, `inputError` and `Tool.validate` before calling `decide`, so bad input never prompts you. Each case has fixed text (the adapter adds its own `Error: ` prefix):
  - an unknown tool: `Unknown tool "<name>". Available tools: <comma separated names>.`
  - a call with `inputError`: `The arguments could not be used: <inputError>. Call the tool again with a JSON object that matches its input schema.`
  - input that fails the tool's schema: `Invalid input for <name>: <issues, one per line as "path: message">`
  - a tool that throws a `PkError`: its `message`
  - a tool that throws anything else: `<name> failed unexpectedly: <message>`, logged at `error` with the stack

  Every error text passes `redact()` first, then is cut to 2,000 characters with `…` added when it was cut. Successful tool content is never cut by the loop. `read_file` applies its own caps (AC-11).
- **AC-5**: Queue. `submit` while a turn runs queues the prompt. Queued prompts run in order, each as its own turn, as soon as the turn before ends. A prompt that is empty or only whitespace is ignored. `submit` after `close()` is ignored.
- **AC-6**: Interrupt. `interrupt()` aborts the running turn's one `AbortSignal`, which reaches the provider stream, the permission wait and the tool run.
  - The turn ends with `turn_end { reason: "interrupted" }` within the time it takes the current await to see the abort, with no throw.
  - A reply cut short is kept in history with `stopReason: "aborted"` when it has any content, and dropped when it has none.
  - Every call in it that has no result gets an error result: `The user interrupted before this tool call ran.` for calls not started, and `The user interrupted this tool call.` for the one running.
  - Queued prompts are dropped, with `notice { level: "info", code: "agent.queue_cleared", text: "Dropped <n> queued message(s)." }` when there were any.
  - `interrupt()` while idle does nothing.
  - Races:
    - A reply is `aborted` when the provider stops with `aborted`, or when the signal aborted before the reply completed.
    - An abort that lands after a complete reply but before its tools gives every call the "not started" text.
    - A tool run is raced against the abort. An outcome that arrives after the abort is thrown away, stamps included, and one that arrived first is kept.
    - A pending permission wait is cleared on abort, so a late `respond` is ignored and logged at `debug`.
    - `submit()` then `interrupt()` in the same tick still emits `turn_start`, the prompt `message` and `turn_end interrupted`, with no model call.
- **AC-7**: Provider failure. Each retry `withRetry` makes emits `notice { level: "warning", code: "provider.retrying", text: retryNoticeText(info) }`. A `ProviderError` that is finally thrown ends the turn with `turn_end { reason: "error", error: { code, message } }`. The reply that was streaming is dropped from history (the screen already showed its text). Messages from earlier model calls in the turn are kept. Anything else thrown inside the loop ends the turn with `error: { code: "agent.internal", message: "pk hit an internal error. See the log for details." }`. The raw error never reaches the screen, and it is logged with its stack. The conversation is then made valid with `repairConversation(messages, { newId, closePendingTail: true })`. `turn_end.error.message` always passes `redact()`. The session keeps taking prompts after any of these.
- **AC-8**: The next step depends on whether the reply holds calls, not on its stop reason.
  - A finished, non aborted reply with any calls runs them, whatever its stop reason. A `max_tokens` reply's calls already carry `inputError` (spec 0004).
  - A reply with no calls ends the turn `done`. When its stop reason is `max_tokens`, it first emits `notice { level: "warning", code: "agent.output_cut", text: "The reply hit the output limit. Ask pk to continue." }`.
  - A non aborted reply with no blocks at all (an empty `end_turn`, a bare `refusal`) would break `AssistantMessage`. It is dropped from history, with `notice { level: "warning", code: "agent.empty_reply", text: "The model sent an empty reply." }`, and the turn ends `done`.
  - Fold rules for building a reply:
    - text deltas in a row merge into one text block, and reasoning deltas in a row into one reasoning block;
    - blocks keep arrival order;
    - `reasoning_replay` sets `replay` on the open reasoning block (or a new empty one) and closes it;
    - a call block is created at `tool_call_end`, at the position of its `tool_call_start`, with `input` and `inputError` from the end event;
    - a call that started but never ended is dropped.
- **AC-9**: Each model call's `usage` stream event becomes one `usage` agent event with the request's `model`. Its `cost` is `{ source: "provider", microUsd: providerCostMicroUsd }` when the provider sent one, else `{ source: "unknown" }`.

*The permission seam*

- **AC-10**: Before each tool run the loop calls `decide()` from `@pk/permissions`:
  - kind `read`, or a tool name already in `sessionAllows`, returns `allow`, and the tool runs with no event;
  - anything else returns `ask`: the loop emits `permission_request { requestId, call, kind }` and waits on `respond(requestId, answer)` or the abort.
  - `allow_once` runs the call. `allow_session` runs it and adds the tool name to `sessionAllows` until the session closes.
  - `deny` gives the result `DENIED_TEXT` (`denied by user`), plus ` (note: <note>)` when there is one, and the turn continues. `DENIED_TEXT` moves from `tui/src/hud-constants.ts` to `@pk/schema`, and the reducer matches denials with `startsWith(DENIED_TEXT)`, so a denial with a note still shows as denied and is not counted in `errors`.
  - `respond` with an unknown or already answered `requestId` is ignored and logged at `debug`.

  Proven with a write kind tool that exists only in tests (#6 ships no such tool).

*The read_file tool*

- **AC-11**: `read_file` takes `{ path: string (at least 1 character), offset?: integer ≥ 1 (default 1), limit?: integer 1 to 2000 (default 2000) }`. It returns the lines from `offset` to `offset + limit - 1`, each as the line number right aligned to width 6, a tab, then the line (`cat -n` style).
  - A line longer than 2,000 characters is cut there, with ` [line cut: 2000 of <n> characters shown]` appended. Characters are counted in Unicode code points, so a character is never split.
  - The formatted output also stops before it passes 100 KB (102,400 bytes of UTF-8), and always ends on a whole line. At least one line is always returned.
  - When lines remain after the window (by `limit` or by the 100 KB cap), a final line is added: `[Lines <from> to <to> of <total>. Call read_file with offset=<to + 1> to read more.]`
  - Decoding comes first: invalid UTF-8 becomes U+FFFD, then a leading BOM is removed. Lines split on `\n`, a trailing `\r` is removed from each line, and a final newline does not make an extra empty line. `total` is counted after all of this.
  - An empty file returns `(the file is empty)` with `isError: false`, whatever the `offset`.
  - A successful read sets `details` to `{ files: [{ path: <path relative to the project root>, action: "read" }] }`, so the FILES rail shows `r`, and returns one `FileStamp`.
- **AC-12**: Path scope.
  - A relative `path` resolves against the project root. An absolute path is taken as is. `~` is not expanded.
  - A relative path whose lexical resolve leaves the root through `..` is refused before the disk is touched.
  - Every other path is checked on its real path: `fs.realpath` of the target, or of its nearest existing parent when it does not exist, compared against the real path of the root (both real, so `/tmp` and `/private/tmp` on macOS agree). If it is not the root or inside it, the result is an error: `<path> is outside the project (<root>). read_file can only read files inside the project for now.`
  - `readFile` and `stat` always get the real path.
  - `<path>` in result texts is the path relative to the root when the file is inside it, and the input exactly as given otherwise.
- **AC-13**: read_file errors, each an error result with this text:
  - not found: `<path> does not exist.`
  - a directory: `<path> is a directory, not a file.`
  - anything else that is not a regular file (a FIFO, a device, a socket), found by `stat` before any read: `<path> is not a regular file.`
  - no permission: `pk is not allowed to read <path>.`
  - larger than 10 MB (10,485,760 bytes, from `stat` before reading): `<path> is <size> MB, larger than the 10 MB read_file can read.`
  - a NUL byte in the first 8,192 bytes: `<path> looks like a binary file. read_file reads text files only.`
  - `offset` past the last line: `offset <n> is past the end of <path> (<total> lines).`
- **AC-14**: Read ledger. After each successful read, the session's `ledger` maps the file's real path to its latest `FileStamp { path, mtimeMs, size, lines: { from, to, total } }`, and the last read wins. An empty file's stamp has `lines: { from: 0, to: 0, total: 0 }`. A failed read changes nothing, and neither does an outcome thrown away after an abort. Tools get the ledger read only through `ToolContext.ledger`.

*Wiring*

- **AC-15**: Every model request uses `PLACEHOLDER_SYSTEM_PROMPT` version 1, built from the project root, today's local date (`YYYY-MM-DD`) and the tool names (joined with `", "`, in `deps.tools` order). It sets no `maxOutputTokens`.
- **AC-16**: `pk` checks its setup before the screen opens, in this order:
  1. the terminal refusal (spec 0003 AC-20);
  2. load settings;
  3. `loadFakeScript`;
  4. build the registry;
  5. `mainModel()`;
  6. `providerFor(main)`.

  Any `ProviderError` from steps 3 to 6 (`provider.fake_script_invalid`, `provider.no_model`, `provider.unknown_provider`, `provider.unsupported_api`) prints `pk: <message>` on stderr and exits 1. A missing or rejected API key is not checked then: the first turn ends with the `provider.missing_key` or `provider.auth` error block and its `try:` hint. `ERROR_HINTS` gains `"provider.missing_key": "set the env var named above, then restart pk"`.

  The screen's `info.mode` is pinned to `"normal"` in #6, because `decide` ignores modes until #7.

  Ctrl+C runs `session.close()` (waiting at most 1 s for it), then the existing `guard.shutdown(EXIT.sigint)`, so it still exits 130 with the terminal restored. A screen that closes on its own (`session_ended`) closes the session and exits 0.

## Decision

**Chosen option**: Option 1: one session object with an imperative shell around pure step functions.

`@pk/agent` exports `createAgentSession(deps)`. It returns an `AgentSession` that satisfies `TuiSession` (plus `close()`). It drives each turn as an async loop over `Provider.stream`. Building replies, choosing the next step and wrapping results are pure functions over readonly data. `@pk/tools` exports `defineTool` and `readFileTool`, and `@pk/permissions` exports a pure `decide`.

**Implementation skills**: `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`), for the tool input schemas and their parse errors.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Data model sketch

Nothing is persisted in #6 (the session tap is #24). Everything lives in memory for one `pk` run.

| Entity | Package | Fields | Rules |
|---|---|---|---|
| `AgentSession` | `agent` | `seq: number` · `conversation: readonly Message[]` · `queue: readonly string[]` · `running?: RunningTurn` · `ledger: ReadonlyMap<string, FileStamp>` · `sessionAllows: ReadonlySet<ToolName>` · `closed: boolean` | 1 session : N turns, one at a time. Each field is replaced, never changed in place |
| `RunningTurn` | `agent` | `turnId: TurnId` · `controller: AbortController` · `modelCalls: number` · `pending?: { requestId: RequestId, resolve(answer) }` | At most one. Ends with exactly one `turn_end` |
| `FileStamp` | `tools` | `path: string` (real absolute path) · `mtimeMs: number` · `size: number` · `lines: { from, to, total }` (whole numbers) | Returned in `ToolOutcome.stamps`, folded into `ledger` by the loop |
| `ToolSpec<I>` | `tools` | `name` · `description` · `kind: ToolKind` · `input: z.ZodType<I>` · `run(input: I, ctx): Promise<ToolOutcome>` | What a tool author writes |
| `Tool` | `tools` | `definition: ToolDefinition` · `validate(raw: JsonObject): { ok: true, input: unknown } \| { ok: false, outcome: ToolOutcome }` · `execute(input: unknown, ctx): Promise<ToolOutcome>` | Made by `defineTool(spec)`: `inputSchema` comes from `toolInputJsonSchema(spec.input)`, `validate` parses with the Zod schema and returns the AC-4 invalid input outcome on failure, and `execute` takes only a value `validate` produced. The loop calls `validate` before `decide`. `agent` never imports `zod` |
| `ToolContext` | `tools` | `signal: AbortSignal` · `projectRoot: string` (real path) · `fs: FileSystem` · `ledger: ReadonlyMap<string, FileStamp>` | Built by the loop for each call |
| `ToolOutcome` | `tools` | `content: readonly ToolResultContentBlock[]` · `isError: boolean` · `details?: ToolDisplayDetails` · `stamps?: readonly FileStamp[]` | The loop wraps it into a `ToolResultBlock` with the call's `callId` |
| `FileSystem` | `tools` | `realpath(p): Promise<string>` · `stat(p): Promise<{ kind: "file" \| "directory" \| "other", size, mtimeMs }>` · `readFile(p): Promise<Uint8Array>` | Port built by `cli` from `node:fs/promises`. Failures throw errors with a Node `code` (`ENOENT`, `EACCES`, `EPERM`, `ENOTDIR`, `ELOOP`), which the tool narrows from `unknown` |
| `PermissionDecision` | `permissions` | `{ decision: "allow" } \| { decision: "ask" }` | #7 adds `deny` and modes |

### State transitions

Session: `idle` → `running` (on `submit`, or a queued prompt) → `awaiting_permission` (on `ask`) → `running` (on `respond`) → `idle` (on `turn_end`). Emitting `turn_end`, clearing `running` and taking the next queued prompt happen in one synchronous step, so an `interrupt()` or `submit()` can never see a half ended turn. Any state → `closed` on `close()`: the running turn is aborted and ends `interrupted`, any pending permission wait is aborted, the queue is dropped silently (no `agent.queue_cleared` notice), then the end marker is queued and `events` ends.

Inside a turn: `model_call` → (no calls: `done`) or (calls: `run_tools` → `model_call` while `modelCalls < maxTurns`, else `turn_limit`). An abort at any point goes to `interrupted`, and a thrown error goes to `error`.

### Interface surface

| Function | Package | Inputs | Output | Key errors |
|---|---|---|---|---|
| `createAgentSession(deps: AgentDeps)` | `agent` | `provider: Provider`, `model: ModelRef`, `tools: readonly Tool[]`, `fs: FileSystem`, `projectRoot`, `today: string` (`YYYY-MM-DD`), `maxTurns: number`, `newId: NewId`, `now: () => number`, `logger: Logger` | `AgentSession` | `AgentError agent.duplicate_tool` (thrown at creation, a wiring bug) |
| `session.events` | `agent` | | `AsyncIterable<AgentEvent>` over an unbounded buffer, one reader, ends after `close()`. A reader that stops early (`return()`) ends nothing: the session keeps running and buffering | a second reader gets `AgentError agent.events_taken` |
| `session.submit(text)` | `agent` | `text: string` | void, starts or queues a turn | none (AC-5 ignores) |
| `session.respond(requestId, answer)` | `agent` | `RequestId`, `PermissionAnswer` | void | none (AC-10 ignores stale) |
| `session.interrupt()` | `agent` | | void | none |
| `session.close()` | `agent` | | `Promise<void>`, resolves once the final `turn_end` and the end marker are queued (not when they are read), so it never hangs on a reader that is not draining | none, safe to call twice |
| `localDate(nowMs, timeZone)` | `agent` | epoch ms, an IANA zone name | `YYYY-MM-DD`, pure | none |
| `decide(request, state)` | `permissions` | `{ tool: ToolName, kind: ToolKind }`, `{ sessionAllows: ReadonlySet<ToolName> }` | `PermissionDecision` | none, pure |
| `defineTool<I>(spec)` | `tools` | `ToolSpec<I>` | `Tool` | none |
| `readFileTool` | `tools` | constant `Tool` named `read_file`, kind `read` | | the AC-13 texts, thrown as `ToolError` (a `PkError`) with codes `tool.outside_project`, `tool.not_found`, `tool.is_directory`, `tool.not_regular_file`, `tool.access_denied`, `tool.too_large`, `tool.binary_file`, `tool.offset_past_end` |
| `placeholderSystemPrompt({ projectRoot, today, toolNames })` | `agent` | | `string`, with `PLACEHOLDER_SYSTEM_PROMPT_VERSION = 1` | none, pure |
| `DEFAULT_MAX_TURNS` | `agent` | | `50` | |

The loop calls `provider.stream(request, { signal, onRetry })` (spec 0004). `AppServices` is not declared yet: nothing in #6 needs it, and #13 declares it with its first real member.

Placeholder system prompt, version 1 (exact text, placeholders filled):

```
You are pk, a coding agent working in a terminal. The project is at <projectRoot>. Today is <today>.
Use the tools (<toolNames>) to look at files before you answer questions about them. Paths are relative to the project root.
Answer concisely.
```

### Value sourcing

| Action | Value | Source |
|---|---|---|
| every event | `seq` | session counter, from 0 |
| every event | `at` | `new Date(deps.now()).toISOString()` |
| every event | `agentId` | `MAIN_AGENT_ID` |
| turn | `turnId`, user and result message ids, `requestId` | `deps.newId("turn" / "msg" / "req")`. `cli` builds `newId` with `createIdFactory` from `Date.now` and `crypto.getRandomValues` |
| every message | `at` | `now()` when the message is created |
| retries | `sleep`, `setTimer`, `random` (registry deps) | `createSleep(setTimeout, clearTimeout)`, `createSetTimer(setTimeout, clearTimeout)`, `Math.random`, all built in `cli` |
| model call | reply `messageId` (deltas and the assistant `message`) | `deps.newId("msg")` once per call, before streaming |
| model call | `callId` | from the provider's `tool_call_start` (the adapter mints it) |
| model call | `model` | `deps.model`, from `registry.mainModel()` in `cli` |
| model call | `system` | `placeholderSystemPrompt` with `deps.projectRoot`, `deps.today`, the tool names joined with `", "` in `deps.tools` order |
| model call | reasoning `replay.api` / `replay.model` | `provider.api` / `deps.model` |
| turn limit | `maxTurns` | `settings.limits?.maxTurns ?? DEFAULT_MAX_TURNS`, read in `cli` |
| system prompt | `today` | `localDate(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone)` in `cli`, once at session start. It stays fixed for the session |
| system prompt, read_file | `projectRoot` | `realpathSync(findProjectRoot(process.cwd(), homedir(), existsSync))` in `cli` |
| `usage` event | `cost` | `providerCostMicroUsd` from the stream's `usage` event, else `unknown` (spec 0002) |
| `retrying` notice | text | `retryNoticeText(info)` (spec 0004) |
| `permission_request` | `kind` | `tool.definition.kind` |
| `tool_result` | `durationMs` | `now()` at `tool_run_start` and at the result, rounded down |
| read_file | display path (`FileTouch.path`, error texts) | the real path relative to the real `projectRoot` when inside it, the input as given otherwise |
| read_file | `mtimeMs`, `size` | `fs.stat` of the real path |
| read_file | line count `total` | count of lines after decoding, BOM and `\r` removal |
| denied result | text | `DENIED_TEXT` from `@pk/schema`, plus ` (note: <note>)` from `PermissionAnswer.note` |
| TUI | `info.model`, `info.mode`, `info.projectRoot` | `mainModel()`, the constant `"normal"` (until #7), the project root above |

### Key invariants

- Exactly one turn runs at a time. Each turn ends with exactly one `turn_end`, and the loop never throws out of `events`. The end of a turn and the start of the next queued one happen in one synchronous step.
- The loop checks the signal after every `await` (stream event, permission wait, tool run) before acting on the result.
- One `AbortController` per turn, whose signal goes to every provider call, permission wait and tool run in it.
- Between turns the conversation passes `checkConversation`. Every tool call gets exactly one result, in the user message directly after its reply.
- Calls run one at a time, in reply order. Permission prompts never overlap.
- Tools never change session state. They return `stamps`, which the loop folds into the ledger.
- `read_file` never opens a path outside the project root, symlinks included.
- No file contents, prompts or model output are logged at `info`. Logs record turn and tool names, ids, durations, reasons and error codes.

### Security model

- `read_file` is limited to the project root (AC-12) until #7 can ask about outside paths, so a file such as `~/.ssh/id_ed25519` is never one tool call away.
- Only `read` kind tools skip the prompt. Any other kind asks, by default, through the same seam #7 extends.
- File contents go to the configured model unredacted (that is the tool's job). Error texts, notices and logs pass `redact()`.
- Tool inputs from the model are untrusted. Each is parsed by its tool's Zod schema before `run`.

### Configuration required

None. `limits.maxTurns` already exists in Settings (spec 0002), and `PK_FAKE_SCRIPT` already exists (spec 0004). The boundary rule for `tools` gains `zod` as an allowed external (`scripts/check-boundaries.ts`).

### Critical test scenarios

- Happy path: a fake script whose step 1 calls `read_file` on a fixture and whose step 2 answers. The events match AC-2's order, the result shows `cat -n` lines, and the conversation is valid. Verifies **AC-1**, **AC-2**, **AC-11**.
- Runaway: a script that always calls a tool, with `maxTurns: 3`. Exactly 3 stream calls, then `turn_end turn_limit` with no notice. A follow up prompt then gives two user messages in a row, which the OpenAI adapter merges. Verifies **AC-3**.
- Bad calls: an unknown tool, an `inputError`, a schema failure, a `ToolError` and a plain `Error` in one reply. Five error results with the AC-4 texts, then the next model call. Verifies **AC-4**.
- Interrupt mid stream, mid permission wait and mid tool run. Each ends `interrupted` with the synthetic results, and the queue is cleared. Verifies **AC-5**, **AC-6**.
- Provider failure: `rate_limited` twice, then `server` with no retries left. Two `provider.retrying` notices, `turn_end error provider.server`, the partial reply dropped, and the next prompt works. Verifies **AC-7**.
- Permission: a test write tool. `ask` → `allow_session` → the second call runs with no prompt. A `deny` with a note gives `denied by user (note: …)`, which the reducer shows as denied. A write tool with invalid input never prompts. Verifies **AC-4**, **AC-10**.
- Path escape: `../outside.txt`, an absolute `/etc/hosts`, and a symlink inside the root pointing out are all refused. A root under `/tmp` on macOS, addressed by its `/tmp/...` or `/private/tmp/...` form, is accepted either way. Verifies **AC-12**.
- Abort race: a tool whose `execute` resolves after `interrupt()` has its outcome and stamps thrown away. Verifies **AC-6**, **AC-14**.

## Build plan

Tracer Bullet: milestone 1 makes the whole thread real (screen, session, provider, permissions, tool, file system) in its thinnest form. Each later milestone thickens one segment.

**Milestone 1: the thread runs end to end**
1. Allow `zod` for `tools` in `scripts/check-boundaries.ts`, and add the `@pk/schema`, `@pk/env`, `zod` (tools), `@pk/permissions`, `@pk/tools` and `@pk/provider` (agent) dependencies to the package manifests, satisfies **AC-1**.
2. `@pk/tools`: `ToolSpec`, `Tool` (`validate` and `execute`), `ToolContext`, `ToolOutcome`, `FileStamp`, `FileSystem`, `ToolError` and `defineTool`, with the invalid input outcome, satisfies **AC-4**, **AC-11**.
3. `readFileTool`, happy path only: resolve inside the root, read, `cat -n` format, `details` with the `read` touch, one stamp, satisfies **AC-11**.
4. `@pk/permissions`: `decide` with `read` → allow, else ask, satisfies **AC-10**.
5. `@pk/agent`: `placeholderSystemPrompt`, `DEFAULT_MAX_TURNS`, `AgentError`, the event channel (one reader) and `createAgentSession`, with one loop that streams, builds the reply (pure fold), runs calls in order, and ends `done`, emitting AC-2's order, satisfies **AC-2**, **AC-15**.
6. `cli`: the `FileSystem` port from `node:fs/promises`, setup in the AC-16 order, the AC-16 sources for `today`, `projectRoot`, `maxTurns`, `newId` and timers, and interactive `pk` calls `startTui` (with `mode: "normal"`) with the session through `runScreen`. `onQuit` runs `session.close()` with a 1 s bound before `guard.shutdown`. Remove the "not built yet" message, satisfies **AC-1**, **AC-16**.
7. `test:e2e`: a temp project with a fixture file, a `PK_FAKE_SCRIPT` that reads it then answers, type a prompt in the PTY, see the `read_file` line and the answer, Ctrl+C exits 130 with the terminal restored, satisfies **AC-1**, **AC-16**.
8. `tui`: move `DENIED_TEXT` to `@pk/schema`, match denials with `startsWith`, and add the `provider.missing_key` hint to `ERROR_HINTS`, satisfies **AC-10**, **AC-16**.

**Milestone 2: the loop handles every outcome**
9. Turn limit, counted per `provider.stream` call (retries excluded), with no notice, satisfies **AC-3**.
10. `usage` events with `cost`, `onRetry` notices, satisfies **AC-7**, **AC-9**.
11. Validation before `decide` (unknown tool, `inputError`, `Tool.validate`), error results for `ToolError` and unexpected throws, redact then cut with `…`, satisfies **AC-4**.
12. The full fold rules, next step keyed on calls, the `agent.output_cut` and `agent.empty_reply` notices, satisfies **AC-8**.
13. Provider errors and internal errors end the turn `error` (fixed `agent.internal` text), drop the partial reply, emit orphan `tool_result` events, emit the results `message`, and repair the conversation, satisfies **AC-2**, **AC-7**.

**Milestone 3: control (queue, interrupt, close, permission ask)**
14. The FIFO queue, ignored submits, and the synchronous turn boundary, satisfies **AC-5**.
15. One `AbortController` per turn, plumbed through stream, wait and tool run, checked after every `await`. The AC-6 race rules, kept or dropped aborted replies, synthetic interrupted results, the queue clear notice, and `close()` with its silent queue drop and end marker, satisfies **AC-2**, **AC-6**, **AC-16**.
16. The `ask` path: `permission_request`, `respond`, `allow_once`, `allow_session` into `sessionAllows`, `deny` with `DENIED_TEXT` and the note, stale and late ids ignored, tested with a test only write tool, satisfies **AC-10**.

**Milestone 4: read_file complete**
17. Path scope: the `..` lexical refusal, the realpath check against the real root (nearest existing parent for missing files), absolute paths, symlink escape, display paths, satisfies **AC-12**.
18. Windowing: `offset` and `limit`, the code point line cut, the 100 KB cap, the footer, the empty file, decode order, `total`, satisfies **AC-11**.
19. Errors: not found, directory, not a regular file, access denied, too large via `stat`, binary sniff, offset past end, satisfies **AC-13**.
20. Ledger folding in the session, last read wins, empty file stamps, failed and discarded outcomes change nothing, satisfies **AC-14**.

**Closing**: `bun run check` passes, and `bun run test:e2e` passes on the host binary. Satisfies all ACs.

## Consequences

**Positive**:
- `pk` is a usable agent for the first time, and every later feature adds to a running thread instead of a stub.
- The permission seam, the ledger and the tool interface are shaped now, so #7, #8 and #11 only add rules and tools.
- Pure step functions mean most of the loop is unit tested with no provider, and the integration tests run offline on the fake.

**Negative / tradeoffs**:
- Tools run one at a time, so a model that reads 6 files in one reply waits for 6 reads in a row. Parallel read kind calls can come later behind the same interface.
- Limiting reads to the project root will refuse legitimate reads (a sibling repo, `/etc/hosts`) until #7 can ask.
- Reading whole files up to 10 MB costs memory on huge files, and bigger ones are refused outright until search (#11) gives another way in. The 100 KB output cap means a wide file needs several calls to read in full.
- Dropping a failed partial reply means the model never sees what it was saying when the stream broke. The screen does.
- `limits.maxTurns` counts model calls, so one reply with many calls is cheap against the cap. The cap bounds cost, not tool volume.
- The screen blocks typing while a turn runs (spec 0003), so the session's queue is used only by tests until #15 (type ahead) or #26.

**Neutral**:
- `tools` becomes the second core package allowed to import `zod`.
- `@pk/agent` gains `close()` beyond `TuiSession`. `cli` owns calling it.
- `tui` changes in two small places: `DENIED_TEXT` moves to `@pk/schema` (matched with `startsWith`), and `ERROR_HINTS` gains `provider.missing_key`.

## Follow-up

- [ ] #7 Permission prompts: extend `decide` with modes and `deny`, turn the AC-12 outside path refusal into an `ask`, and show the real `permissions.mode` in the header again.
- [ ] #8 File write and edit: consume `ToolContext.ledger` for read before edit and changed since read (compare `mtimeMs` and `size`). "Last read wins" loses coverage (a short tail read replaces a full read), so #8 should decide whether the ledger keeps the union of lines read, or a full read flag.
- [ ] #8: throwing away a late outcome after an abort is safe for reads only. A write that finished has still happened, so write tools need their own abort rule (check the signal before the write starts, and keep a finished write's outcome).
- [ ] #10 Permission rules: replace tool name `sessionAllows` with rule patterns.
- [ ] #13 Slash commands: declare `AppServices` with its first real member.
- [ ] #15 Input editing: wire Esc to `session.interrupt()`, and decide whether the screen allows typing ahead into the queue.
- [ ] #17 System prompt: replace `PLACEHOLDER_SYSTEM_PROMPT` (version 1) with the real, versioned prompt.
- [ ] #19 Model catalog: set `maxOutputTokens` per model.
- [ ] #24 Sessions: add the persistence tap that records each event before it is yielded.
- [ ] Later: run read kind calls in parallel when measured to matter (pk-bench, #27).
