# 0002. Core data model: pk owned conversation, event, file and settings shapes

**Date**: 2026-11-22
**Status**: Accepted

## Summary

This spec fixes the shapes every part of pk shares: messages and their content blocks, tool definitions, calls and results, token usage and cost, the event stream the UI reads, the files pk saves (sessions, costs, input history) and the settings files. They are pk's own shapes, written once as Zod schemas (Zod is a library where one definition gives both the TypeScript type and a runtime check), and each provider adapter translates to and from them at its edge, so no vendor field ever reaches the loop or the tools. Saved files carry a version number and are upgraded in memory when read, so old sessions keep working. Settings come from up to three files plus command flags, and a project's own files can never redirect your API key or loosen your permission checks.

## Requirements

**User stories**:
- As a pk contributor building an adapter, a tool or a frontend, I want one neutral set of shapes so that I never touch a vendor format outside an adapter.
- As a pk user, I want my sessions, cost history and settings to keep working across pk upgrades and provider switches so that nothing I saved is lost or misread.
- As a pk user who clones untrusted repos, I want a project's settings files to be unable to send my API key elsewhere or loosen permission checks.
- As a pk user on a shared machine, I want my transcripts and cost records readable only by me.

**Acceptance criteria**:
- **AC-1**: `@pk/schema` exports, each as a Zod schema plus its `z.infer` type with a doc comment and no hand written duplicate type: `Timestamp`, `JsonValue`, `SessionId`, `MessageId`, `CallId`, `RequestId`, `TurnId`, `AgentId`, `ProviderId`, `ApiStyle`, `ModelRole`, `ModelRef`, `ModelRefInput`, `TextBlock`, `ImageBlock`, `ReasoningBlock`, `ToolCallBlock`, `ToolResultBlock`, `UserMessage`, `AssistantMessage`, `Message`, `StopReason`, `ToolKind`, `ToolDefinition`, `ModelRequest`, `ProviderStreamEvent`, `Usage`, `Cost`, `AgentEvent`, `PermissionAnswer`, `TodoItem`, `StoredImageBlock`, `StoredMessage`, `SessionHeader`, `SessionRecord` (and each record variant), `CostRecord`, `HistoryEntry` and `Settings`. A fixture conversation that uses every block type (text, image, reasoning with a replay token, two parallel tool calls, one error result with `details`) parses without error.
- **AC-2**: No vendor field leaks. A test walks the JSON Schema of every exported schema and fails if any key matches the vendor field list (`tool_use_id`, `tool_calls`, `function_call`, `finish_reason`, `stop_reason`, `prompt_tokens`, `completion_tokens`, `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `choices`, `delta`, `signature`, `functionCall`, `functionResponse`).
- **AC-3**: `checkConversation(messages)` takes parsed messages and returns `ConversationIssue[]` (`{ code, messageIndex, callId?, message }`), one per problem, with codes `missing_result` (a `tool_call` whose result is not in the message directly after it), `orphan_result` (a result whose call is not in the message directly before it), `duplicate_result` and `duplicate_call_id` (the same `CallId` in two calls anywhere). A valid conversation returns an empty list. An assistant message with calls as the **last** message is valid (a turn in progress). Two messages with the same role in a row are valid pk data (adapters merge them where their API needs it). `repairConversation(messages, { newId, closePendingTail })` always returns a conversation that `checkConversation` accepts, and reports how many changes it made. For each call with no result it adds a synthetic error result with the text `REPAIRED_RESULT_TEXT` ("No result was recorded for this call."). The result goes into the next message if that is a user message, otherwise into a new user message inserted directly after, whose `at` is the assistant message's `at` and whose id comes from `newId("msg")`. It drops each orphan or duplicate result, removes a user message left with no blocks, and fills a pending last message's calls only when `closePendingTail` is true.
- **AC-4**: A model reference given as `"openrouter/anthropic/claude-x"` parses to `{ provider: "openrouter", model: "anthropic/claude-x" }` (split at the first `/`). An empty string, a string without `/`, or a provider part outside `^[a-z0-9][a-z0-9_-]{0,31}$` is rejected with a message naming the rule. `formatModelRef` turns the object back into the same string.
- **AC-5**: A `Cost` with `source: "unknown"` has no `microUsd`, and one with `provider` or `catalog` has a whole number `microUsd` of zero or more. The schema rejects any other combination. `sumUsage` adds field by field, returns all zeros for an empty list, and includes `reasoningTokens` only when at least one input has it. `sumCosts` adds `provider` and `catalog` amounts alike and returns `{ knownMicroUsd, unknownCalls }`, so an unknown cost is counted, never added as zero.
- **AC-6**: `AgentEvent` is a union discriminated on `type`, and every variant carries `seq` (a whole number), `at` and `agentId`. A type level test shows that a `switch` over `type` with a `never` default compiles when every variant is handled and fails to compile when one is missing. `PermissionAnswer` is `allow_once`, `allow_session`, or `deny` with an optional `note`.
- **AC-7**: `checkStreamOrder(events)` returns `StreamIssue[]` (`{ code, eventIndex, callId?, message }`). It reports: no `stop`, more than one `stop`, or any event after it; a `tool_call_delta` or `tool_call_end` for a call id with no earlier `tool_call_start`, or after that call's `tool_call_end`; a call id that starts twice; a started call with no `tool_call_end` before `stop` (allowed when that `stop` has reason `aborted`, amended by [spec 0004](../0004-provider-layer-openai-adapter/index.md) AC-5); and more than one `usage` event. Text and reasoning deltas may appear anywhere before `stop`. A `reasoning_replay` closes the current reasoning block, so the next `reasoning_delta` starts a new block. A well formed stream returns no issues.
- **AC-8**: Session files read safely.
  - `readJsonlRecords(text, schema)` in `env` splits the text on `\n` and returns the records that parse plus a count of skipped lines: blank lines are ignored, and lines that are not JSON, that fail the schema, or whose `type` this pk does not know are skipped.
  - `readSessionFile(text)` reads the first non blank line as raw JSON before any schema parsing. If it is not an object with `type: "header"` and a whole number `v`, it throws `SessionError` with code `session.no_header`. If `v` is newer than `SESSION_VERSION`, it throws `session.too_new`. If `v` is older, every raw record (header included) passes through the `SESSION_MIGRATIONS` chain (each entry is `(raw: unknown, header: unknown) => unknown`) before schema parsing. A second `header` line is skipped and counted. It returns `{ header, records, skipped, fileVersion }`.
  - `sessionRecordFromEvent(event, stored)` in `schema` maps a `message`, `usage`, `todo_update`, `model_change` or `turn_end` event to its record (with `stored` being the message after `toStoredMessage`), and returns `undefined` for every other event.
  - `foldSessionRecords(header, records, { newId })` returns `SessionState`, using only records whose `agentId` is `main`:
    - `models.main` starts from `header.model`, and `model_change` records override it.
    - A message whose id was already seen is skipped and counted.
    - The context is the latest valid compaction's summary message followed by every transcript message after `replacesThrough`. A compaction that names an unknown id is ignored and counted.
    - The context is repaired with `closePendingTail: true`, so it always passes `checkConversation`, and `repaired` is the number of results added plus results dropped.
  - A committed `v: 1` fixture file is parsed in a test, so a later change cannot silently break old sessions.
- **AC-9**: `toStoredMessage(message, { sha256 })` is pure and synchronous. It returns `{ message: StoredMessage, blobs: { sha256, bytes: Uint8Array }[] }`, replacing every image (including images inside `tool_result.content`) with a `StoredImageBlock` `{ type: "image", mediaType, blob: { sha256, bytes } }`, where `bytes` is the length. The caller writes the blobs. `fromStoredMessage(stored, blobs: ReadonlyMap<string, Uint8Array>)` returns `{ message: Message, missing: string[] }`, restoring base64 data. An image whose blob is missing becomes the text block `[image unavailable]`, and its hash is listed in `missing`. Base64 data is validated as base64 by the `ImageBlock` schema. A `Message` never holds a blob reference, so adapters only ever see base64.
- **AC-10**: `CostRecord` and `HistoryEntry` lines each carry `v: 1`, and `readJsonlRecords` reads them with the same skipping rules as AC-8.
- **AC-11**: `Settings` accepts `$schema`, `model`, `providers`, `permissions` and `limits` as defined in *Feature design*. A wrong type is an error. An unknown key is a warning, not an error. An `apiKey` given as a plain string is rejected with the message "API keys never go in settings files. Use { \"env\": \"VAR_NAME\" } or run pk login.", and the message never contains the value.
- **AC-12**: `loadSettings` in `env` reads the user file, then `.pk/settings.json`, then `.pk/settings.local.json`, then the flags object, and returns `{ settings, warnings }`.
  - **Reading**: `readFile(path)` returns `string | undefined`, where `undefined` means the file is missing. Any other read failure throws `SettingsError` with code `settings.unreadable`.
  - **Skipping the project layers**: both project files are skipped when `skipProject` is set (the `--no-project-settings` flag, with one `project_skipped` warning), when the project root is your home folder, or when a project file path equals the user file path. Without this rule, `~/.pk/settings.json` on macOS would be read twice.
  - **Per layer order**: parse the JSON (an empty file or JSON that is not an object is invalid), apply `SETTINGS_RENAMES` (when both keys are present the new key wins, with a `deprecated_key` warning), drop the user only keys from the project layers, then validate. User only keys are dropped **before** validation, so a hostile value is removed, never reported back.
  - **User only keys** in the project layers: `providers`, `permissions.mode` (any value) and `permissions.allow`. Each is dropped with a `user_only_key` warning naming the file and key. Project `deny` and `ask` rules still apply, because they can only tighten.
  - **Errors**: bad JSON or any wrong type throws `SettingsError` (code `settings.invalid`) carrying the file path and every issue with its dotted key path, not only the first. The flags layer is validated with the same schema, and its file label is `flags`.
  - **Merging**: `ModelRefInput` values are normalized to `ModelRef` per layer before the merge. Objects merge deeply, single values take the higher layer, `permissions.allow`, `deny` and `ask` concatenate in layer order with duplicates removed, and any other array is replaced by the higher layer.
- **AC-13**: `findProjectRoot(cwd, home, exists)` (with `exists(path): boolean` synchronous, and `cwd` already a realpath from the caller) returns the nearest folder, starting at `cwd`, that contains `.pk` or `.git`. Your home folder never counts (on macOS `~/.pk` is pk's own data folder). When `cwd` is inside home (checked on whole path segments, so `/Users/ab` is not inside `/Users/a`), the walk stops below home. Outside home it walks up to `/`. With no match it returns `cwd`. `projectKey(root)` returns `<slug>-<8 hex>`. The slug is built from the folder's basename: lowercase it, turn every run of characters outside `a-z0-9` into `-`, trim `-` from both ends, cut to 40 characters, trim again, and use `root` if empty. The hex is the first 8 characters of the SHA 256 of `root` exactly as given (no case folding). Two folders with the same name get different keys.
- **AC-14**: `createIdFactory({ now: () => number, randomBytes: (n: number) => Uint8Array })` in `env` returns `newId(prefix)`, typed per prefix so `newId("call")` returns the branded `CallId`. It yields `<prefix>_<26 characters>` in the uppercase Crockford base32 alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (ULID layout: 10 time characters, then 16 random from `randomBytes(10)`). One monotonic state is shared by every prefix of a factory. In the same millisecond the random part goes up by one, a clock that moves backward is treated as the last millisecond seen, and an overflow throws `PkError` `id.overflow`. IDs made later always sort after earlier ones. This state inside the factory is an allowed exception to the no mutation rule, like the clock it wraps. Each ID schema (`SessionId` `ses_`, `MessageId` `msg_`, `CallId` `call_`, `RequestId` `req_`, `TurnId` `turn_`, `AgentId` `main` or `agent_`) accepts its own prefix only, and each is a branded type, so a `CallId` cannot be passed where a `MessageId` is expected.
- **AC-15**: All JSON Schema comes from Zod 4's `z.toJSONSchema` with its default draft (2020-12) and `io: "input"`, so the `"provider/model"` string form is allowed, and strict objects come out as `additionalProperties: false`. `bun run schemas` writes `schemas/settings.schema.json` (tab indented, ending in a newline, top level `$schema` kept). `bun run schemas --check` regenerates it in memory and fails when it differs from the committed file, and `bun run check` runs that. `schemas/` is excluded from Biome so formatting never changes the file. `toolInputJsonSchema(zodSchema)` returns the same kind of object, without the top level `$schema`, for `ToolDefinition.inputSchema`.
- **AC-16**: `appendJsonl` and `atomicWriteFile` accept a file `mode` and a folder `dirMode` (applied when created). The exported `PRIVATE_FILE` options (`mode: 0o600`, `dirMode: 0o700`) create files that only you can read, inside folders only you can open. `ensurePrivateDir(path)` creates the folder `0700`, or tightens an existing folder you own to `0700`. Session, cost and history writers call it for their folder, since a file inside a `0700` folder is unreachable by others even if it is older and looser. Before writing, `appendJsonl` checks whether a non empty file ends in `\n`, and if not (a torn last line from a crash), starts its write with `\n`, so the new record never glues onto the torn one. A test checks the modes on disk and the torn line case.
- **AC-17**: `bun run check` passes. `@pk/schema` depends only on `zod` (exact version pin), `@pk/env` declares `@pk/schema`, and the boundary check accepts both.

## Decision

**Chosen option**: Option 1: a neutral, pk owned data model, with typed session records, versioned JSONL files and layered settings guarded by user only keys (see [rationale.md](rationale.md#options-considered)).

Every shape is a Zod 4 schema in `@pk/schema`, with pure, non throwing helpers beside it. File reading, settings loading, IDs and project detection live in `@pk/env`, which turns failures into `PkError` subclasses.

**Implementation skills**: `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`)

## Rationale

Reasoning, options weighed, and every smaller call with its runner up: see [rationale.md](rationale.md).

## Feature design

### Data model sketch

**Shared primitives**

| Schema | Shape | Rules |
|---|---|---|
| `Timestamp` | ISO 8601 UTC string with milliseconds (`2026-11-22T10:15:30.123Z`) | Comes from the injected clock |
| ID types | `SessionId` `ses_…`, `MessageId` `msg_…`, `CallId` `call_…`, `RequestId` `req_…`, `TurnId` `turn_…`, `AgentId` `main` or `agent_…` | `<prefix>_` + 26 Crockford base32 characters, branded (AC-14) |
| `ProviderId` | string `^[a-z0-9][a-z0-9_-]{0,31}$` | The key of a `providers` entry (or a preset name, #19) |
| `ApiStyle` | `openai_chat` · `anthropic_messages` | #31 adds `gemini`. It names an API format, not a vendor field |
| `ModelRef` | `{ provider: ProviderId, model: string (at least 1) }` | `ModelRefInput` also accepts `"provider/model"` and splits it at the first `/` (AC-4) |
| `ModelRole` | `main` · `summarize` · `subagent` | Roles from #21 |
| `JsonValue` | any JSON value | Recursive (`z.lazy`) |

**Conversation**

| Schema | Fields (required unless marked optional) | Rules |
|---|---|---|
| `TextBlock` | `type: "text"`, `text` | |
| `ImageBlock` | `type: "image"`, `mediaType` (`image/png`, `image/jpeg`, `image/gif`, `image/webp`), `data` (base64) | Always base64 in a `Message`. The saved form is `StoredImageBlock` (AC-9) |
| `ReasoningBlock` | `type: "reasoning"`, `text` (may be empty), optional `replay: { api: ApiStyle, model: ModelRef, data: string }` | An adapter sends `replay` back only when both `api` and `model` match the current request (signed reasoning is model specific). Otherwise it sends the text, or drops the block |
| `ToolCallBlock` | `type: "tool_call"`, `id: CallId`, `name` (tool name rule), `input` (JSON object), optional `inputError` (string, at most 2,000 characters) | If the model's arguments are not valid JSON, the adapter sets `input: {}` and `inputError` to a short description. The loop (#6) then returns an error result |
| `ToolResultBlock` | `type: "tool_result"`, `callId: CallId`, `content`: array of `TextBlock` or `ImageBlock`, `isError` (boolean), optional `details: JsonValue` | `details` is for the screen and saved files only and is never sent to a model. Each tool declares its own `details` schema in `tools` |
| `UserMessage` | `id: MessageId`, `role: "user"`, `at`, `content`: at least one of text, image, tool_result | |
| `AssistantMessage` | `id: MessageId`, `role: "assistant"`, `at`, `model: ModelRef`, `stopReason: StopReason`, `content`: text, reasoning, tool_call (may be empty only when `stopReason` is `aborted`) | On abort, a call that started but never ended is dropped. Finished calls are kept and get results from the loop, or from repair |
| `Message` | `UserMessage` or `AssistantMessage`, discriminated on `role` | |
| `StopReason` | `end_turn` · `tool_use` · `max_tokens` · `refusal` · `aborted` · `other` | Any provider reason pk does not map becomes `other`, and the raw value is not stored |

**Provider boundary**

| Schema | Fields | Rules |
|---|---|---|
| `ToolKind` | `read` · `write` · `execute` · `network` | Used by `permissions`, never sent to the model. MCP tools (#36) default to `execute` |
| `ToolDefinition` | `name` (`^[a-zA-Z0-9_-]{1,64}$`), `description`, `inputSchema` (JSON Schema object), `kind: ToolKind` | `name` is unique in one request |
| `ModelRequest` | `model: ModelRef`, `system: string`, `messages: Message[]`, `tools: ToolDefinition[]`, optional `maxOutputTokens` (positive whole number) | The system prompt is never a message. Adapters place it where their API wants it |
| `Usage` | `inputTokens` (uncached input), `cacheReadTokens`, `cacheWriteTokens`, `outputTokens` (includes reasoning), optional `reasoningTokens` (for information only) | Whole numbers, zero or more, default 0. The OpenAI adapter subtracts its cached count from its prompt count |
| `Cost` | `source: "provider" \| "catalog" \| "unknown"`, `microUsd` (whole number) present unless `source` is `unknown` | 1 `microUsd` = $0.000001. A provider figure in USD is converted with `Math.round(usd * 1e6)` in the adapter |
| `ProviderStreamEvent` | `text_delta { text }` · `reasoning_delta { text }` · `reasoning_replay { data }` (the loop adds `api` and `model` from the request when it builds the block) · `tool_call_start { callId, name }` · `tool_call_delta { callId, argsText }` · `tool_call_end { callId, input, inputError? }` · `usage { usage, providerCostMicroUsd? }` · `stop { reason: StopReason }` | The adapter mints `callId` with the injected `newId`. Exactly one `stop`, and it comes last (AC-7) |

**Event stream** (`AgentEvent`). Every variant carries the envelope `{ seq, at, agentId, type }`. `seq` starts at 0 for each session object and rises by one with each event, across turns.

| `type` | Fields | When |
|---|---|---|
| `turn_start` | `turnId` | A turn begins |
| `text_delta` | `messageId`, `text` | Streaming assistant text |
| `reasoning_delta` | `messageId`, `text` | Streaming reasoning |
| `tool_call_start` | `messageId`, `callId`, `name` | The model began a call (for an early "calling read_file" line) |
| `message` | `message: Message` | Any completed message: your input, the assistant reply, the tool results message. The session tap persists these |
| `permission_request` | `requestId`, `call: ToolCallBlock`, `kind: ToolKind` | The turn waits for `session.respond(requestId, PermissionAnswer)` |
| `tool_run_start` | `callId` | Execution began, after any permission |
| `tool_result` | `result: ToolResultBlock`, `durationMs` | Each result as it finishes, before the combined `message` |
| `usage` | `model: ModelRef`, `usage: Usage`, `cost: Cost` | Once per model call |
| `todo_update` | `todos: TodoItem[]` | The to do list changed (#12) |
| `model_change` | `role: ModelRole`, `model: ModelRef` | A model was switched (#21) |
| `notice` | `level: "info" \| "warning"`, `code` (stable string), `text` | Something worth showing that is not fatal (a retry, skipped records, settings warnings) |
| `turn_end` | `turnId`, `reason: "done" \| "interrupted" \| "turn_limit" \| "error"`, optional `error: { code, message }` | Exactly once, last in every turn |

| Schema | Shape |
|---|---|
| `PermissionAnswer` | `{ decision: "allow_once" }` · `{ decision: "allow_session" }` · `{ decision: "deny", note?: string }` |
| `TodoItem` | `{ content: string (at least 1), status: "pending" \| "in_progress" \| "done" }` |

#38 adds subagent start and end events. A subagent's events reuse this union with their own `agentId`.

**Saved files**. Every folder is created `0700` and every file `0600` (`PRIVATE_FILE`). Records may hold fields this pk does not know: they are stripped, not refused, so a newer pk's optional fields never break an older one.

| File | Records |
|---|---|
| `<state>/sessions/<projectKey>/<SessionId>.jsonl` | First line `header { type, v: 1, sessionId, createdAt, cwd, projectRoot, pkVersion, model: ModelRef, parentSessionId? }`. Then any of: `message { at, agentId, message: StoredMessage }` · `usage { at, agentId, model, usage, cost }` · `todo { at, todos }` · `model_change { at, role, model }` · `compaction { at, summaryMessageId, replacesThrough: MessageId }` (written after its summary `message` record) · `turn_end { at, agentId, turnId, reason, error? }` |
| `<state>/sessions/<projectKey>/blobs/<sha256>` | The raw image bytes. Shared by every session of that project |
| `<state>/costs/<YYYY-MM>.jsonl` | `CostRecord { v: 1, at, sessionId, agentId, model, usage, cost }`, one per model call. The month is the UTC month of `at` |
| `<state>/history.jsonl` | `HistoryEntry { v: 1, at, projectRoot, text }` (#15 input history) |

`StoredImageBlock` is `{ type: "image", mediaType, blob: { sha256 (64 hex), bytes (whole number) } }`, and `StoredMessage` is `Message` with `StoredImageBlock` in place of `ImageBlock` (in user content and in `tool_result.content`). `SESSION_VERSION` is `1`. `SESSION_MIGRATIONS` maps each older `v` to a pure `(raw, header) => raw` function that upgrades one raw record to the next version. It is empty at `v: 1`.

Only a pk whose `SESSION_VERSION` equals a file's header `v` appends to that file. Resuming an older file starts a new session file (new `SessionId`, `parentSessionId` set to the old one) seeded with the folded state, so one file never mixes versions. Each file has one writer at a time (two pk processes on one session is #24's call).

**Settings** (`Settings`, every key optional; no version key)

| Key | Shape | Layers |
|---|---|---|
| `$schema` | string | any |
| `model` | `{ main?, summarize?, subagent? }`, each a `ModelRefInput` | any |
| `providers` | record of `ProviderId` to `{ api: ApiStyle, baseURL?: http or https URL, apiKey?: { env: "^[A-Z_][A-Z0-9_]*$" } or { keychain: true } }` | **user only** |
| `permissions` | `{ mode?: "normal" \| "accept_edits" \| "plan" \| "skip_all", allow?: string[], deny?: string[], ask?: string[] }` | `mode` and `allow` are **user only** (until #10 designs project trust). `deny` and `ask` are allowed at any layer. The rule string grammar belongs to #10 (here: non empty strings) |
| `limits` | `{ maxTurns?: positive whole number }` | any. The default value belongs to #6 |

`USER_ONLY_SETTINGS` (in `schema`) lists the user only paths as data: `providers`, `permissions.mode`, `permissions.allow`. `SETTINGS_RENAMES` maps a deprecated key to its replacement and is empty today. Later features add their own sections (hooks #35, MCP servers #36, sandbox #32) as optional keys.

### State transitions

- **Turn**: `turn_start` → any number of deltas, `message`, `permission_request`, `tool_run_start`, `tool_result`, `usage`, `todo_update`, `notice` → exactly one `turn_end`. Nothing follows `turn_end` in that turn.
- **Tool call**: `tool_call_start` (streaming) → `message` (the assistant message that holds the call) → `permission_request` (only when permissions ask) → `tool_run_start` (when allowed) → `tool_result`. A denied or aborted call still ends with a `tool_result`, with `isError: true`.
- **Todo status**: `pending` → `in_progress` → `done`. Any status may also move back, because the model rewrites the whole list.
- **Saved file version**: a file is read at its own `v`, upgraded in memory, and never rewritten. It is appended to only by a pk of the same version. Otherwise resume forks to a new file.

### API surface

There are no HTTP endpoints. The surface is the exported functions. Schema helpers never throw (Zod parse errors aside, which callers catch). `env` turns failures into `PkError` subclasses.

| Function | Package | Key inputs | Key outputs | Trust | Key errors |
|---|---|---|---|---|---|
| every schema `.safeParse` | schema | `unknown` | typed value or issues | used at every boundary | none thrown |
| `formatModelRef` | schema | `ModelRef` | `"provider/model"` | | |
| `checkConversation` | schema | `readonly Message[]` | `ConversationIssue[]` | | |
| `repairConversation` | schema | `readonly Message[]`, `{ newId, closePendingTail }` | `{ messages, changes }` | | |
| `checkStreamOrder` | schema | `readonly ProviderStreamEvent[]` | `StreamIssue[]` | adapter and fake provider tests | |
| `sumUsage`, `sumCosts` | schema | arrays of `Usage` or `Cost` | `Usage`, `{ knownMicroUsd, unknownCalls }` | | |
| `toolInputJsonSchema` | schema | a Zod schema | JSON Schema object | | |
| `toStoredMessage` | schema | `Message`, `{ sha256(bytes): string }` | `{ message: StoredMessage, blobs }` | | |
| `fromStoredMessage` | schema | `StoredMessage`, `ReadonlyMap<sha256, Uint8Array>` | `{ message: Message, missing: string[] }` | | |
| `sessionRecordFromEvent` | schema | `AgentEvent`, the stored message for a `message` event | `SessionRecord` or `undefined` | | |
| `foldSessionRecords` | schema | `SessionHeader`, `readonly SessionRecord[]`, `{ newId }` | `SessionState` | | |
| `readJsonlRecords` | env | file text, a schema | `{ records, skipped }` | file content is untrusted | none thrown |
| `readSessionFile` | env | file text | `{ header, records, skipped, fileVersion }` | untrusted | `session.no_header`, `session.too_new` |
| `loadSettings` | env | `{ userFile, projectRoot, home, flags, skipProject, readFile(path): Promise<string \| undefined> }` | `{ settings, warnings: SettingsWarning[] }` | project files are untrusted | `settings.invalid`, `settings.unreadable` |
| `mergeSettings` | env | ordered, already validated layers | `Settings` | | |
| `findProjectRoot` | env | `cwd` (realpath), `home`, `exists(path): boolean` | absolute path | | |
| `projectKey` | env | root path | `<slug>-<8 hex>` | | |
| `createIdFactory` | env | `{ now, randomBytes }` | `newId(prefix)` | | `id.overflow` |
| `appendJsonl`, `atomicWriteFile` | env | path, data, `{ mode?, dirMode? }` | written file | | `env.not_serializable` |
| `ensurePrivateDir` | env | folder path | the folder, `0700` | | |
| `--no-project-settings` | cli | flag | `skipProject: true` for `loadSettings` | | |
| `bun run schemas [--check]` | scripts | the `Settings` schema | `schemas/settings.schema.json` | | `--check` exits 1 when stale |

Shapes used above:
- `ConversationIssue` is `{ code: "missing_result" | "orphan_result" | "duplicate_result" | "duplicate_call_id", messageIndex, callId?, message }`.
- `StreamIssue` is `{ code: "no_stop" | "multiple_stop" | "after_stop" | "unknown_call" | "after_call_end" | "duplicate_call_start" | "unfinished_call" | "multiple_usage", eventIndex, callId?, message }`.
- `SettingsWarning` is `{ file (an absolute path, or "flags"), path (dotted key path), code: "unknown_key" | "user_only_key" | "deprecated_key" | "project_skipped", message }`.
- `SessionState` is `{ header, transcript: Message[], context: Message[], todos: TodoItem[], models: Partial<Record<ModelRole, ModelRef>>, lastTurnEnd?: TurnEndRecord, repaired: number, skipped: number }`.
- Errors in `env`: `SessionError extends PkError` (code only), and `SettingsError extends PkError` with `{ file, issues: { path, message }[] }`.

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| any event | `seq` | A counter in the `agent` session object, starting at 0 (#6) |
| any event or record | `at` | The injected clock, as ISO 8601 UTC |
| any event or record | `agentId` | `main` for the root agent. #38 mints `agent_` IDs |
| message, call, request, turn, session | each ID | `newId` from `createIdFactory`, with `now` and `randomBytes` injected by `cli` (`Date.now`, `node:crypto`) |
| provider stream | `callId` | The adapter calls the injected `newId("call")` and keeps its own map to the provider's ID |
| reasoning block | `replay.api`, `replay.model` | The loop fills them from the current request: `api` from the provider's settings entry or preset, and `model` from `ModelRequest.model` |
| repair | synthetic message `at` and id | The assistant message's `at`, and `newId("msg")` |
| repair | synthetic result text | The constant `REPAIRED_RESULT_TEXT` in `schema` |
| assistant message | `stopReason` | The adapter's mapping of the provider's stop or finish reason (#5, #20) |
| `Usage.inputTokens` | uncached input | Anthropic: its input count. OpenAI compatible: prompt tokens minus cached tokens (#5) |
| `Cost.microUsd` and `source` | the amount | Built by the loop (#6) for each model call: the `usage` stream event's `providerCostMicroUsd` (source `provider`), else `unknown`. #19 and #22 add catalog pricing (source `catalog`, rounded per call with `Math.round`) |
| cost record | `sessionId`, `agentId` | The session object that made the call |
| session header | `cwd` | The process working directory, passed in by `cli` |
| session header | `projectRoot` | `findProjectRoot(cwd, home, exists)` |
| session folder | `projectKey` | `projectKey(projectRoot)` |
| session header | `pkVersion` | The version `scripts/build.ts` injects, passed in by `cli` |
| session header | `model` | The resolved `settings.model.main`, or a flag |
| cost file name | `YYYY-MM` | The UTC month of the record's `at` |
| blob file | `sha256`, `bytes` | Computed by the caller from the decoded image bytes, with the `sha256` function injected (`node:crypto` in `env`) |
| settings | the user file path | `join(paths().config, "settings.json")` |
| settings | the project file paths | `<projectRoot>/.pk/settings.json` and `<projectRoot>/.pk/settings.local.json` |
| settings | the flags layer | `cli` maps parsed flags to a `Settings` object. It is trusted like the user file |
| settings | user only list | `USER_ONLY_SETTINGS` in `schema` |
| settings warnings | where they show | `loadSettings` returns them. `cli` logs them, and the TUI shows them as a `notice` event |
| `foldSessionRecords` | the model context | The transcript, where a `compaction` record replaces every message up to `replacesThrough` with the message `summaryMessageId` |
| `fromStoredMessage` | missing image text | The constant `[image unavailable]` |

### Key invariants

- Every `tool_call` in an assistant message has exactly one `tool_result` with its `callId` in the message directly after it, which is a user message (except a pending last message). No result exists without its call, and a `CallId` is used by one call only.
- A user message holds only text, image and tool_result blocks. An assistant message holds only text, reasoning and tool_call blocks.
- `seq` rises by one with each event of a session object. Each turn has exactly one `turn_end`, and it is last.
- A provider stream has exactly one `stop`, and it is last.
- `Cost.source === "unknown"` exactly when `microUsd` is absent. Unknown is never summed as zero.
- No settings file ever holds a secret. An API key is only ever named by an env var or the keychain.
- No vendor field name appears in any `schema` export (AC-2).
- A saved file is never rewritten to migrate it. Old versions are upgraded in memory.
- Every `schema` type comes from `z.infer`, every object is `readonly`, and every helper is pure.

### Security model

- **Untrusted inputs**: session, cost and history lines, both project settings files, model output (tool call arguments and stream content) and the fake provider script. Each is parsed with Zod before use, never cast.
- **Project files cannot widen trust**: in `.pk/settings.json` and `.pk/settings.local.json`, these are dropped with a warning, before validation: `providers` (base URLs and key sources, which could send your key to another server), `permissions.mode` (any mode, since `accept_edits` and `skip_all` both loosen checks) and `permissions.allow` (an allow rule like `Bash(*)` would act like skip all). Project `deny` and `ask` rules apply, because they only tighten. The local file counts as untrusted too, because a hostile repo could commit one. #10 may later add explicit project trust that lifts this.
- **A broken project file**: it still stops pk (skipping it could drop a deny rule), and the error suggests `--no-project-settings`, which skips both project files with a warning.
- **Secrets**: the settings schema has no place for a literal key, and its error message never echoes the value. Zod issues are built without the input value, and error formatting goes through `redact()`. Saved sessions (including tool result `details`) are redacted by the persistence tap (#24, spec 0001). Every `HistoryEntry` and `CostRecord` passes through `redact()` before `appendJsonl` (the writers are #15 and #22, and the rule is set here).
- **Privacy**: session, blob, cost and history files are `0600` in `0700` folders. Settings files stay `0644`, since they hold no secrets.
- **Compliance**: none in scope. Everything stays on your machine, with no telemetry.

### Configuration required

No new environment variables. `providers.<id>.apiKey.env` names an env var you already have (for example `OPENAI_API_KEY`). pk reads its value at request time and never writes it anywhere.

### Critical test scenarios

- Happy path (tracer): mint IDs, then build a user message, an assistant message with a tool call, and its result message. Emit them as `message` events, map them to a header plus `message` records, append them with `PRIVATE_FILE`, read them back with `readSessionFile`, and fold them. The folded context equals the original messages, and the file mode is `0600`. Verifies **AC-1**, **AC-8**, **AC-14**, **AC-16**.
- Failure case: a session file with a torn last line, a middle line of invalid JSON, a record of an unknown `type` and an assistant tool call whose result line was lost resumes with `skipped: 3` and a repaired conversation that passes `checkConversation`. Verifies **AC-3**, **AC-8**.
- Trust: a `.pk/settings.json` that sets `providers.openai.baseURL` to another server, `permissions.mode: "accept_edits"` and `permissions.allow: ["Bash(*)"]` loads with all three dropped and three `user_only_key` warnings. The user file's provider stays in force, and the project's `deny` rules still apply. Verifies **AC-12**.
- Broken project file: a `.pk/settings.json` with invalid JSON throws `settings.invalid` naming that file, and with `skipProject: true` pk loads the user file alone and warns `project_skipped`. Verifies **AC-12**.
- Torn line: append to a file whose last line has no `\n`, and the new record reads back intact (the torn line is the only one skipped). Verifies **AC-16**, **AC-8**.
- Secret: a user settings file with `"apiKey": "sk-live-abc"` throws `settings.invalid`, and neither the message nor the logged error contains `sk-live-abc`. Verifies **AC-11**.
- Merge: user `deny: ["Bash(rm *)"]` plus project `deny: []` still denies `Bash(rm *)`. Verifies **AC-12**.
- Old data: the committed `v: 1` session fixture still parses and folds. Verifies **AC-8**.
- Vendor guard: adding a field named `finish_reason` to any schema fails the test. Verifies **AC-2**.
- Unknown cost: summing one catalog cost of 1500 and one unknown cost gives `{ knownMicroUsd: 1500, unknownCalls: 1 }`. Verifies **AC-5**.
- Exhaustiveness: removing one `case` from the event switch fixture fails the type check. Verifies **AC-6**.
- Project detection: running from `~/code/app/src/deep`, with `.git` in `~/code/app`, gives root `~/code/app`. Running from `~` itself gives `~`, even though `~/.pk` exists, and `loadSettings` then skips the project layers, so `~/.pk/settings.json` is read once as the user file. Verifies **AC-13**, **AC-12**.
- Newer file: a session file whose header has `v: 2` throws `session.too_new` (not `session.no_header`). Verifies **AC-8**.

## Build plan

The order follows the project's Tracer Bullet approach. First comes one thin thread through every layer this feature owns (IDs, a message, an event, a session record, a private JSONL write, a read back and fold, plus a one key settings load). Then each segment is thickened in turn. There is no database migration: the schemas themselves are the target, and they land segment by segment.

**Milestone 1: the tracer thread**
1. Add `zod` with an exact pin (the current Zod 4 release at install time, no `^`) to `@pk/schema`, add `"@pk/schema": "workspace:*"` to `@pk/env`, and confirm `bun run boundaries` accepts both. Satisfies **AC-17**.
2. In `env`: add `mode` and `dirMode` options, the `PRIVATE_FILE` constant and `ensurePrivateDir`, and the torn line guard in `appendJsonl`. Replace the bare `TypeError` in `appendJsonl` with a `PkError` (`env.not_serializable`), per the root rules. Add `createIdFactory`. Satisfies **AC-14**, **AC-16**.
3. In `schema`: the ID schemas, `Timestamp`, `ModelRef` with `ModelRefInput`, `TextBlock`, `ToolCallBlock`, `ToolResultBlock`, `UserMessage`, `AssistantMessage`, `StopReason`, the `AgentEvent` envelope with `message` and `turn_end`, and `SessionHeader` with the `message` record. Satisfies **AC-1** (in part), **AC-4**.
4. In `env`: `readJsonlRecords`, `readSessionFile` and `SessionError`. In `schema`: `sessionRecordFromEvent` for `message` and `turn_end`, and a minimal `foldSessionRecords` (no compaction yet). Then the tracer test from *Critical test scenarios*. Satisfies **AC-8** (in part).
5. In `schema`: `Settings` with `model.main` only. In `env`: `loadSettings` reading the user file only. A test resolves `"openrouter/anthropic/claude-x"` from a temp `PK_HOME`. Satisfies **AC-12** (in part).

**Milestone 2: conversation and provider boundary**
6. Add `ImageBlock`, `ReasoningBlock` (with `replay`), `inputError` and `details`. Then `checkConversation` and `repairConversation`, and the every block fixture. Satisfies **AC-1**, **AC-3**.
7. Add `ToolKind`, `ToolDefinition`, `toolInputJsonSchema`, `ModelRequest`, `Usage`, `Cost`, `sumUsage`, `sumCosts`, `ProviderStreamEvent` and `checkStreamOrder`. Satisfies **AC-5**, **AC-7**, **AC-15** (in part).
8. Add the vendor field guard test over every export's JSON Schema. Satisfies **AC-2**.

**Milestone 3: events and saved files**
9. Complete the `AgentEvent` union, `PermissionAnswer` and `TodoItem`, plus the type level exhaustiveness fixture. Satisfies **AC-6**.
10. Complete `SessionRecord` (`usage`, `todo`, `model_change`, `compaction`, `turn_end`), every `sessionRecordFromEvent` case, `SESSION_VERSION`, `SESSION_MIGRATIONS` and `session.too_new`. Then the full `foldSessionRecords` with compaction, the `agentId` filter, duplicate skipping and repair, the damaged file test, and the committed `v: 1` fixture. Satisfies **AC-8**.
11. Add `StoredImageBlock`, `StoredMessage`, `toStoredMessage` and `fromStoredMessage`. Satisfies **AC-9**.
12. Add `CostRecord` and `HistoryEntry`, read through `readJsonlRecords`. Satisfies **AC-10**.

**Milestone 4: settings and published schema**
13. Complete `Settings` (`providers`, `permissions`, `limits`, the literal key message), `USER_ONLY_SETTINGS` and `SETTINGS_RENAMES`. Parse with strict objects, and split `unrecognized_keys` issues out as warnings: strip those keys, then parse again. Satisfies **AC-11**.
14. Complete `loadSettings`: three files plus flags, the project skip rules, the per layer order, user only filtering, `mergeSettings` with the array rules, and `SettingsError` with every issue. Add `findProjectRoot` and `projectKey`. Register `--no-project-settings` in the `cli` program (passed to `loadSettings` once something calls it). Satisfies **AC-12**, **AC-13**.
15. Add `scripts/schemas.ts` (`bun run schemas`, plus `--check`), commit `schemas/settings.schema.json`, exclude `schemas/` in `biome.json`, and add `bun run schemas --check` to `bun run check`. Satisfies **AC-15**.
16. Run `bun run check` until it is green, and add doc comments on every `src/index.ts` export. Satisfies **AC-17**.

## Consequences

**Positive**:
- Adapters (#5, #20, #31) each translate one neutral shape, and the loop and tools never see a vendor format. Switching providers mid session is a data question, already answered.
- Sessions, costs and history survive upgrades: an old file is read through a migration table, a newer optional field is ignored, and a damaged line costs one record, not the session.
- A cloned repo cannot redirect your key or skip permission checks through settings.
- Exact cost sums and an explicit unknown count make #22's "never show unknown as zero" automatic.
- The tracer test proves the chain from IDs to saved file to resume before any loop exists.

**Negative / tradeoffs**:
- A larger up front surface: about 40 schemas before #5 and #6 use most of them, and a wrong guess costs a migration entry later.
- Two message translations per adapter, plus an ID map (pk ID to provider ID) inside each adapter.
- Integer micro USD needs a conversion step wherever a dollar figure is shown or received.
- Blob files split a session across a JSONL file and a shared `blobs/` folder, so copying one session by hand needs both. Deleting a session does not remove its blobs (blob cleanup is #24's).
- User only keys mean a team cannot share a custom provider endpoint, a permission mode or allow rules through the repo. Each person adds them to their own user file, until #10 adds explicit project trust.
- Session files assume one writer at a time. Two pk processes appending to the same session would interleave records until #24 decides how to handle that.
- Resuming a session written by an older pk version starts a new file, so a resumed history can span two files linked by `parentSessionId`.
- Strict settings values mean one typo in a type stops pk at start. That is the chosen safety trade, but it is more friction than a warning.

**Neutral**:
- `@pk/schema` gains its first dependency (`zod`), and `@pk/env` gains `@pk/schema`.
- New repo folder `schemas/`, holding a generated file committed to git.
- New error codes: `settings.invalid`, `settings.unreadable`, `session.no_header`, `session.too_new`, `env.not_serializable`, `id.overflow`.
- A new CLI flag, `--no-project-settings`.

## Follow-up

- [ ] #5 Provider layer: define the fake provider script file as an array of responses, each a list of `ProviderStreamEvent`, parsed with the `schema` union. Map each provider ID to a pk `CallId`, subtract cached from prompt tokens, and map finish reasons to `StopReason`.
- [ ] #6 Agent loop: choose the default `limits.maxTurns`, the message the model sees for `inputError`, and the text of a synthetic error result for denied and interrupted calls.
- [ ] #10 Permission rules: define the rule string grammar for `permissions.allow`, `deny` and `ask`. Decide whether to add explicit project trust that lets a trusted project set `allow` and `mode` (today both are user only), and if so, where the trust is stored.
- [ ] #19 Model catalog: presets fill in `providers` defaults (`api`, `baseURL`, key env var) so a preset needs only a key, and catalog prices produce `catalog` costs. Decide whether custom request headers are needed (for example OpenRouter's app headers) and how they avoid holding secrets.
- [ ] #20 Anthropic adapter: map thinking and redacted thinking to `ReasoningBlock` with `replay`, and map cache read and write tokens.
- [ ] #22 Cost tracking: how `{ knownMicroUsd, unknownCalls }` reads in `/cost` and the status line.
- [ ] #24 Sessions: the session store (writing the header, the redaction tap, file I/O for blobs, removing unused blobs), the fork on resume across versions (which records seed the new file), what happens when a session is already open in another pk (fork through `parentSessionId`, or refuse), and the resume list title.
- [ ] #25 Compaction: confirm the `compaction` record fields, and add any it needs as optional fields.
- [ ] #26 Headless mode: the versioned JSON contract, built from `Usage`, `sumCosts`, `TodoItem` and the `turn_end` reason.
- [ ] #29 Release: host `schemas/settings.schema.json` at a stable public URL for `$schema`.
- [ ] #36 MCP: map server tool names into the 64 character tool name rule (for example `mcp_<server>_<tool>`, shortened with a hash when too long).
- [ ] #38 Subagents: add the subagent start and end events.
- [ ] #39 Image input: size and count limits per image block.
- [ ] `/sync` after the build: `packages/schema/AGENTS.md` and `packages/env/AGENTS.md` (new exports, the no throw rule for schema helpers, the `PRIVATE_FILE` rule for state files).
