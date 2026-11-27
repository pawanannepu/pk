# 0004. Provider layer and OpenAI compatible adapter: one streaming interface, one retry policy

**Date**: 2026-11-27
**Status**: Accepted

## Summary

This spec defines how pk talks to a model. A provider is a small object with one `stream()` method that turns a pk `ModelRequest` into pk stream events, and the first real one speaks the OpenAI chat format, so OpenAI, OpenRouter, Groq, Ollama and LM Studio all work by changing only a base URL, a key source and a model name. Failures come back as `ProviderError`s with stable codes and plain messages. One retry wrapper and one timeout wrapper sit in `@pk/provider`, and a scripted fake provider lets every test run offline.

## Requirements

**User stories**:
- As a pk user, I want to point pk at OpenAI, OpenRouter, Groq or my local Ollama by editing one settings entry, so that I can use whichever model I have access to.
- As a pk user, I want rate limits, outages and wrong keys to show as clear messages that say what to do, so that pk never crashes or hangs on a provider problem.
- As a pk contributor, I want one provider interface and a scripted fake provider, so that the loop and tools are tested offline and a new adapter has one contract to meet.

**Acceptance criteria**:

- **AC-1**: `@pk/provider` exports `Provider` (`{ id: ProviderId, api: ApiStyle, stream(request: ModelRequest, options: StreamOptions): AsyncIterable<ProviderStreamEvent> }`), `StreamOptions` (`{ signal: AbortSignal, onRetry?: (info: RetryInfo) => void }`), `RetryInfo`, `ProviderError`, `withRetry`, `withTimeouts`, `retryNoticeText`, `resolveApiKey`, `NO_KEY_PLACEHOLDER` and `createFakeProvider`, each with a doc comment. Every stream any of them produces (adapter, fake, both wrappers) that completes (ends with `stop` rather than a throw) passes `checkStreamOrder` with no issues, including streams that end in an abort. A stream that throws partway has no `stop` and is exempt.
- **AC-2**: The same adapter code serves OpenAI, OpenRouter, Groq and Ollama: fixture tests for each, replaying that server's recorded style of reply (text, one tool call, usage), produce the same pk event sequence apart from usage numbers and cost. The only per provider inputs are the settings entry (`baseURL`, `apiKey`) and the model name.
- **AC-3**: `toChatRequest(request, { baseURL })` (pure) builds the chat request. It assumes a conversation that already passes `checkConversation` (the loop repairs it first, spec 0002) and does not validate it again. It works in this order: split each user message's tool results into `tool` messages, skip messages left empty, then merge.
  - the system prompt is the first message with role `system`, left out when it is empty;
  - consecutive messages of the same role (never `tool`) are merged into one: text content is joined with `\n\n`, part arrays are concatenated, and assistant `tool_calls` lists are concatenated. The extra user message that carries tool images (below) merges with the user content that follows it;
  - a text block whose text is empty counts as no text;
  - a user message's text and images become `content` (a plain string when it holds only text, otherwise an array of `text` and `image_url` parts, with images as `data:<mediaType>;base64,<data>` URLs);
  - each `tool_result` becomes its own `role: "tool"` message, placed before that user message's other content, with `tool_call_id` set to the pk `CallId`. Its `content` is the result's text blocks joined with `\n`, starts with `Error: ` when `isError` is true, and is `[image output follows]` when there is no text;
  - images inside tool results go in one extra user message placed right after that message's tool messages, each image after a text part `Image output of tool call <CallId>:`;
  - assistant text blocks are joined into `content` (`null` when there is none), and tool calls become `tool_calls` with `id` set to the pk `CallId`, `type: "function"` and `arguments` set to `JSON.stringify(input)` (or `"{}"` when the block has `inputError`);
  - reasoning blocks are never sent, and an assistant message left with no content and no calls is skipped;
  - `tools` maps each definition to `{ type: "function", function: { name, description, parameters: inputSchema } }`, has no `strict` flag, and the key is left out when there are no tools;
  - `stream: true` and `stream_options: { include_usage: true }` are always set;
  - `maxOutputTokens`, when set, goes in `max_completion_tokens` if the `baseURL` host is `api.openai.com`, otherwise in `max_tokens`, and is left out when unset;
  - nothing else is sent in the body (no temperature, no `parallel_tool_calls`). The only headers are `Authorization`, `Content-Type` and the SDK's own fixed client headers (`User-Agent`, `x-stainless-*`), which are allowed. No `OpenAI-Organization` or `OpenAI-Project` header is ever sent (AC-13).
- **AC-4**: The stream mapper turns chunks into pk events:
  - every field of `ChatChunk` accepts `null` as absent (`content`, `role`, `reasoning_content`, `reasoning`, `tool_calls`, `finish_reason`, `usage`, every usage subfield), because real servers send `null` freely;
  - `delta.content` becomes `text_delta`, and the first non empty string of `delta.reasoning_content` and `delta.reasoning` becomes `reasoning_delta`. Empty strings make no event;
  - tool call fragments are grouped by `index` (by `id` when the index is missing, by `0` when both are missing). A fragment starts a new group, even under the same key, when it carries a non empty `id` different from the open group's `id`, or a non empty `function.name` while the open group already has a name. Each new group mints a `CallId` with the injected `newId("call")`. Its `tool_call_start` is emitted when the first non empty name arrives. Argument text that arrived before the name is held and emitted as one `tool_call_delta` right after the start, and later fragments each emit their own `tool_call_delta`. A name that breaks `TOOL_NAME_PATTERN` has each invalid character replaced with `_` and is cut to 64 characters, and a name left empty becomes `_`;
  - `finish(state)` runs only when the SSE stream ends (`[DONE]` or end of body), never on `finish_reason`, because usage often comes in a later chunk. If the body ends with no `[DONE]` and no `finish_reason` was ever seen, the stream throws `provider.stream_broken` (retryable only before the first event, AC-7) instead of finishing;
  - at finish, every started call gets `tool_call_end` in start order. Empty or whitespace only arguments give `{}`. Arguments that are not valid JSON give `input: {}` with `inputError` set to `arguments are not valid JSON: <parser message>`. Valid JSON that is not an object gives `input: {}` with `inputError` set to `arguments must be a JSON object`. When the finish reason is `length`, every call gets `input: {}` and `inputError: "reply was cut off at the output limit"`, even when its arguments parse, so the loop never runs a truncated call. A group that never received a name gets `tool_call_start` with name `unknown_tool` at finish, then `tool_call_end` with `input: {}` and `inputError: "the server sent a tool call with no name"`. All messages are cut to 2,000 characters;
  - then one `usage` event, only when the server sent usage, using the last usage seen (servers that repeat usage on every chunk are fine): `inputTokens = max(0, prompt_tokens − cached_tokens)`, `cacheReadTokens = cached_tokens` (from `prompt_tokens_details.cached_tokens`, 0 when missing), `cacheWriteTokens = 0`, `outputTokens = completion_tokens`, and `reasoningTokens` from `completion_tokens_details.reasoning_tokens` when present. A finite, non negative `usage.cost` (USD, as OpenRouter sends it) sets `providerCostMicroUsd = Math.round(cost * 1e6)`;
  - then one `stop`: `tool_use` when any call started (unless the finish reason is `length`, which gives `max_tokens`); otherwise `stop` → `end_turn`, `length` → `max_tokens`, `content_filter` → `refusal`, `tool_calls` or `function_call` → `tool_use`, `[DONE]` with no finish reason → `end_turn`, and any other value → `other`. `finish_reason: "error"` is not a stop: it throws `provider.stream_broken`.
- **AC-5**: When `options.signal` aborts, at any point, the stream yields `stop { reason: "aborted" }` and returns without throwing. If the signal is already aborted when `stream()` starts, that stop comes first, before the key is read or anything is sent. Calls that started but did not end get no `tool_call_end` (in the chat format calls end only at finish, so after an abort every call is dropped, even one whose arguments look complete), no `usage` is emitted, and the HTTP request is cancelled (the injected `fetch` sees its signal abort). A consumer that stops reading early (`break`, or `return()` on the iterator) also cancels the request, from a `finally` block. `checkStreamOrder` accepts an unfinished call when the stop reason is `aborted` (spec 0002 AC-7, amended) and still reports it for every other reason.
- **AC-6**: Every failure is thrown as a `ProviderError` (a `PkError` with `code`, `retryable`, `providerId`, and optional `status` and `retryAfterMs`), mapped as in *Error mapping*. Its message names the provider, says what to do, and, when the server sent error text, adds `Server said: <text>` (passed through `redact()` with the resolved key as a known secret, then cut to 500 characters). This applies to every row, `context_length` included. A body that looks like HTML (it starts with `<` after trimming whitespace) is never echoed. `ProviderError.cause` holds only a sanitized `{ name, status? }` of the SDK error, never the SDK error object, which can carry URLs and request details. No error message, log line or notice ever contains the key value.
- **AC-7**: `withRetry(provider, deps)` retries a call only when the error has `retryable: true` **and** no event has yet been yielded for that call. Default policy: at most 4 retries (5 attempts). "Yielded" means any event passed on to the consumer. Before retry `n` it waits the server's requested time when there is one: the adapter puts `retry-after-ms` (milliseconds) or a numeric `retry-after` (seconds) in `retryAfterMs`, and puts an HTTP date `retry-after` raw in `retryAfterDate`, which `retryDelay` resolves against the injected `now`. Values that cannot be parsed count as absent, and negative waits become 0. Otherwise it waits a full jitter delay, `max(250, random() × min(30_000, 1_000 × 2^(n−1)))` ms. A requested wait over 60,000 ms (exactly 60,000 is allowed) stops retrying at once and throws the error with ` Retry after <ceil(ms/1000)>s.` added. `onRetry` is called once before each wait with `{ retry: n, maxRetries: 4, delayMs, error }`, inside a `try`, and anything it throws is ignored. An abort during a wait yields `stop { reason: "aborted" }` and returns. An adapter's own `stop: aborted` passes straight through and is never retried. When every retry is used up, the last error is thrown with ` (gave up after 5 attempts)` added. That suffix never appears on an error that was not retryable, or on a stop caused by the 60s rule. Adding text always makes a new `ProviderError` with the same code and fields (errors are never mutated). An error after the first event is rethrown unchanged.
- **AC-8**: `withTimeouts(provider, deps)` fails a call that yields no event within 300,000 ms of starting, or that goes 300,000 ms without an event after that. The idle limit matches the first event limit because keepalive chunks make no pk event, and reasoning models can think silently for minutes. A timer runs only while the wrapper is waiting on the inner iterator's `next()`, never while the consumer holds an event, so a slow reader cannot cause a timeout. On timeout the wrapper sets a `timedOut` flag, aborts a child `AbortController` linked to `options.signal` (the inner stream gets the child's signal), calls `return()` on the inner iterator, and throws `ProviderError` `provider.timeout` (retryable). A timeout before the first event is therefore retried by `withRetry`, and one after it surfaces. The inner stream's own `stop { reason: "aborted" }` caused by the timeout is swallowed, never passed on. If `options.signal.aborted` is true when the timer fires, even in the same tick, the user abort wins: the stream ends with `stop { reason: "aborted" }`, never a timeout error. On every exit (done, throw, user abort, or the consumer stopping early) a `finally` cancels the pending timer and removes the listener on `options.signal`, and a test asserts that no timer or listener is left. There is no limit on total call time.
- **AC-9**: Provider setup in `cli`:
  - `BUILTIN_PROVIDERS` holds one entry, `openai: { api: "openai_chat", apiKey: { env: "OPENAI_API_KEY" } }`, and a user `providers.openai` entry replaces it whole;
  - a missing `baseURL` means `https://api.openai.com/v1`;
  - `resolveApiKey(source, getEnv, providerId)` runs at the start of every call (so a changed environment variable takes effect on the next call). It returns the variable's value for `{ env }` and throws `provider.missing_key` when that is unset or empty. It throws `provider.keychain_unavailable` for `{ keychain: true }` until #18. It returns `NO_KEY_PLACEHOLDER` (`"pk-no-key"`) when there is no source;
  - a model ref whose provider is in neither the user settings nor the built ins throws `provider.unknown_provider`, an entry with `api: "anthropic_messages"` throws `provider.unsupported_api` (until #20), and no `model.main` throws `provider.no_model` with the message `No model set. Add "model": { "main": "openai/<model>" } to <user settings path>.`;
  - every real provider is wrapped as `withRetry(withTimeouts(adapter))`;
  - inside a call the order is: abort check (AC-5), key resolution, then the request.
- **AC-10**: `createFakeProvider({ script, sleep })` plays a `FakeScript` (parsed with its `@pk/schema` Zod schema), one step per `stream()` call, in order. The step is claimed synchronously when `stream()` is called, not when reading starts, so concurrent calls take steps in call order:
  - an `events` step yields its events, waiting `eventDelayMs` (default 0) before each one, and then throws its `thenError` when one is given;
  - an `error` step throws its `ProviderError` before any event;
  - a scripted error's `retryable`, when omitted, comes from the code's default in `@pk/provider`. Its `message` defaults to `Scripted <code>.`, and its `providerId` is the fake's `id`;
  - once every step is used, the next call throws `provider.fake_exhausted` (not retryable);
  - `requests()` returns a `structuredClone` of every `ModelRequest` received, in order;
  - an abort is honored before and between events, as in AC-5, including during an `eventDelayMs` wait;
  - a script that fails its schema, or whose event steps fail `checkStreamOrder`, throws `provider.fake_script_invalid` naming the step and event index. A step with `thenError` is checked with `no_stop` and `unfinished_call` ignored, since it ends in a throw.
  `sleep(ms, signal): Promise<void>` is one shared type (exported as `Sleep` from `@pk/provider`) used by the fake and by `withRetry`. It resolves early when the signal aborts and removes its listener either way. When `PK_FAKE_SCRIPT` names a script file, `cli` reads and parses it and serves every model ref from that one fake provider, wrapped in `withRetry` (no timeouts, no settings providers needed), and `mainModel()` returns `fake/fake` when `model.main` is unset.
- **AC-11**: Adapter tests run offline through an injected `fetch` that serves hand written SSE fixture files (`src/fixtures/*.sse`), with a deterministic injected `newId`. Each of OpenAI, OpenRouter, Ollama and Groq has a `same-reply` fixture encoding one shared reply (text, then one tool call, then usage) in that server's style, for AC-2. Further fixtures cover each server's quirks: OpenAI (parallel tool calls, cached tokens), OpenRouter (`usage.cost`, `reasoning`, a mid stream `error` chunk, `finish_reason: "error"`), Ollama (`reasoning` field, two whole tool calls in single chunks with no `index` and no `id`, `null` fields, usage on every chunk) and Groq (usage in the last chunk), plus a body that ends with no `[DONE]` and no finish reason. A live smoke test (`src/live.test.ts`) runs only when `PK_LIVE_TEST=1`, is skipped otherwise, and is never part of `bun run check`.
- **AC-12**: `withRetry` (the only layer that knows the attempt number, and which holds `now`) logs one `debug` line per attempt through the injected logger with `provider`, `model`, `attempt`, `firstEventMs` and `totalMs`. It logs one `warn` line per retry with `provider`, `code`, `status` (when known), `retry` and `delayMs`, and one `error` line on final failure with `provider`, `code` and `status` (when known). `ProviderError.status` is how status reaches the logs. The adapter logs nothing itself. Prompts, messages, tool input and model output are never logged at any level.
- **AC-13**: Boundaries hold: `openai` (pinned exactly at `7.56.0`) is imported only in `provider-openai`, and `zod` (`4.6.7`, the version already used) is allowed in `provider-openai` for its chunk schemas. The SDK client is created per call as `new OpenAI({ apiKey, baseURL, fetch, maxRetries: 0, timeout: 86_400_000, organization: null, project: null })`, so it never reads `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID` or `OPENAI_BASE_URL` from the environment (the wrappers own retries and timeouts). The call is `client.chat.completions.create(body, { signal })` with `stream: true`, and the adapter iterates the returned stream, parsing each chunk object with `ChatChunk`. The SDK's thrown errors are mapped by class: `APIUserAbortError` → the abort path (AC-5); `APIConnectionTimeoutError` → `provider.timeout`; `APIConnectionError` → `provider.network`; `APIError` with a `status` → the status rows; `APIError` with no `status` (the SDK's own throw for an `error` payload inside the stream) → its `error.code` by the *Error mapping* rows, else `provider.stream_broken`; a JSON `SyntaxError` from a chunk → `provider.stream_broken`. No vendor type crosses `@pk/provider`'s interface. `bun run check` passes.

## Decision

**Chosen option**: Option 1: a `Provider` object with one streaming method, an OpenAI chat adapter that maps stateless both ways, and retry and timeouts as separate wrappers in `@pk/provider` (see [rationale.md](rationale.md#options-considered)).

Build `@pk/provider` (interface, `ProviderError`, `withRetry`, `withTimeouts`, key resolution, fake provider) and `@pk/provider-openai` (`createOpenAIProvider`, `toChatRequest`, the stream mapper, error mapping), wired in `cli` as `withRetry(withTimeouts(adapter))`.

**Implementation skills**: `openai-docs` (`openai/skills`, `.claude/skills/openai-docs/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Data model sketch

No persisted data. New shapes, all readonly:

| Shape | Package | Fields | Notes |
|---|---|---|---|
| `ProviderErrorCode` | schema (Zod enum) | the codes in *Error mapping* | Shared by `ProviderError` and `FakeScript`. Stable strings, not vendor fields |
| `FakeScript` | schema (Zod) | `{ v: 1, steps: FakeStep[] }` (at least one step) | Untrusted input (spec 0002), parsed, never cast |
| `FakeStep` | schema | `{ events: ProviderStreamEvent[], eventDelayMs?: int ≥ 0, thenError?: FakeError }` or `{ error: FakeError }` | `callId`s in a script are literal `call_<ULID>` values |
| `FakeError` | schema | `{ code: ProviderErrorCode, message?: string, status?: int, retryAfterMs?: int ≥ 0, retryable?: boolean }` | `retryable` defaults from the code's row in *Error mapping* |
| `ProviderError` | provider (class, extends `PkError`) | `code: ProviderErrorCode`, `retryable`, `providerId`, `status?`, `retryAfterMs?`, `retryAfterDate?` (raw HTTP date header) | Immutable. `cause` is a sanitized `{ name, status? }`, never the SDK error. `DEFAULT_RETRYABLE` (a record from code to boolean, the *Error mapping* column) lives beside it, the only copy of that table |
| `Sleep` | provider (type) | `(ms, signal) => Promise<void>` | Resolves early on abort and removes its listener. Shared by `withRetry` and the fake |
| `RetryInfo` | provider | `retry` (1 to 4), `maxRetries`, `delayMs`, `error: ProviderError` | Given to `onRetry` |
| `RetryPolicy` | provider | `maxRetries: 4`, `baseDelayMs: 1_000`, `minDelayMs: 250`, `maxDelayMs: 30_000`, `maxRetryAfterMs: 60_000` | `DEFAULT_RETRY_POLICY` constant |
| `TimeoutPolicy` | provider | `firstEventMs: 300_000`, `idleMs: 300_000` | `DEFAULT_TIMEOUT_POLICY` constant |
| `OpenAIProviderConfig` | provider-openai | `id`, `baseURL`, `apiKey: () => string`, `keyHint: string`, `newId`, `fetch?` | Built by `cli` from a settings entry. No logger: the adapter logs nothing (AC-12) |
| `ChatChunk` | provider-openai (Zod, lenient, not exported) | `choices[0].delta.{role, content, reasoning_content, reasoning, tool_calls[{index?, id?, function{name?, arguments?}}]}`, `choices[0].finish_reason`, `usage.{prompt_tokens, completion_tokens, prompt_tokens_details.cached_tokens, completion_tokens_details.reasoning_tokens, cost}`, `error.{message, code: string or number}` | Every field is optional and nullable (`null` reads as absent). Unknown keys are allowed. A known key with any other wrong type is `provider.stream_broken` |

### State transitions

One model call, inside `withRetry`:

`attempting` → (first event) `streaming` → (`stop`) `done`
`attempting` → (retryable error, retries left, wait ≤ 60s) `waiting` → `attempting`
`attempting` → (error not retryable, no retries left, or wait > 60s) `failed` (throws)
`streaming` → (any error) `failed` (throws, never retried)
any state → (abort) `aborted` (yields `stop: aborted`, returns)

The stream mapper's per call state: `calls` (a list of `{ key, callId, name?, args }` in start order), `finishReason?` and `usage?`. It changes only through `mapChunk(state, chunk) → { state, events }` and `finish(state) → events`, both pure.

### Interface surface

| Function | Package | Inputs | Output | Key errors |
|---|---|---|---|---|
| `Provider.stream` | provider (interface) | `ModelRequest`, `{ signal, onRetry? }` | `AsyncIterable<ProviderStreamEvent>` | any `ProviderError` |
| `createOpenAIProvider` | provider-openai | `OpenAIProviderConfig` | `Provider` with `api: "openai_chat"` | none at creation |
| `toChatRequest` | provider-openai (pure) | `ModelRequest`, `{ baseURL }` | chat request body | none |
| `mapChunk`, `finish` | provider-openai (pure) | mapper state, a parsed `ChatChunk` | `{ state, events }` / events | `provider.stream_broken` on an `error` chunk |
| `toProviderError` | provider-openai (pure) | SDK error or chunk error, `{ providerId, baseURL, model, keyHint, apiKey }` | `ProviderError` | none |
| `withRetry` | provider | `Provider`, `{ sleep: Sleep, random(), now(), logger, policy? }` | `Provider` | rethrows |
| `retryDelay` | provider (pure) | `ProviderError`, retry number, policy, `random`, `now` | `{ kind: "wait", delayMs } \| { kind: "give_up", reason }` | none |
| `withTimeouts` | provider | `Provider`, `{ setTimer(ms, fire) → cancel, policy? }` | `Provider` | `provider.timeout` |
| `createSleep` | cli | `setTimeout`, `clearTimeout` | `Sleep` | none |
| `retryNoticeText` | provider (pure) | `RetryInfo` | text such as `Rate limited by groq, retrying in 4s (2 of 4)` | none |
| `resolveApiKey` | provider | `ApiKeySource \| undefined`, `getEnv(name)`, `providerId` | key string | `provider.missing_key`, `provider.keychain_unavailable` |
| `createFakeProvider` | provider | `{ script: FakeScript, sleep: Sleep, id? }` (`id` defaults to `fake`) | `Provider & { requests() }` | `provider.fake_exhausted`, any scripted error |
| `parseFakeScript` | provider | raw JSON value | `FakeScript` | `provider.fake_script_invalid` |
| `createProviderRegistry` | cli | merged settings, `{ getEnv, newId, logger, fetch, sleep, random, now, setTimer }` | `{ providerFor(ref: ModelRef): Provider, mainModel(): ModelRef }` | `provider.unknown_provider`, `provider.unsupported_api`, `provider.no_model` |

The loop (#6) calls `registry.providerFor(model).stream(request, { signal, onRetry })` and turns each `onRetry` into a `notice` event (`level: "warning"`, `code: "provider.retrying"`, `text: retryNoticeText(info)`). That wiring is #6's to build. This spec provides the pieces.

### Error mapping

`<id>` is the provider id, `<hint>` is `keyHint`, and `Server said: …` is added whenever the server sent error text (AC-6).

| Trigger | Code | Retryable | Message |
|---|---|---|---|
| HTTP 401 or 403 | `provider.auth` | no | `<id> rejected the API key (<status>). Check that <hint>.` |
| `{ env }` var unset or empty | `provider.missing_key` | no | `<VAR> is not set. Export it, or change providers.<id>.apiKey in your user settings.` |
| `{ keychain: true }` (before #18) | `provider.keychain_unavailable` | no | `Keychain keys arrive with pk login. Use { "env": "VAR_NAME" } for providers.<id>.apiKey for now.` |
| HTTP 402, or HTTP 429 whose body `error.code` (the SDK's `APIError.code`) is `insufficient_quota` | `provider.quota_exceeded` | no | `<id> says this account is out of credit or quota.` |
| HTTP 429, or error code string `rate_limit_exceeded` | `provider.rate_limited` | yes | `Rate limited by <id>. Wait a moment, or switch model.` |
| HTTP 503 or 529 | `provider.overloaded` | yes | `<id> is overloaded (<status>). Try again shortly.` |
| HTTP 409, 500, 502, 520 to 523, and other 5xx not listed | `provider.server` | yes | `<id> had a server error (<status>). Try again shortly.` |
| HTTP 408, 504, 524, SDK connection timeout, or `withTimeouts` | `provider.timeout` | yes | `<id> sent nothing for <N>s.` (an HTTP status: `<id> timed out (<status>).`) |
| connection refused, DNS failure, reset (SDK connection error) | `provider.network` | yes | `Could not reach <id> at <baseURL>. Check the URL and your connection.` plus ` Is the local server running?` when the host is `localhost`, `127.0.0.1` or `::1` |
| HTTP 413, or HTTP 400 or 422 whose error code is `context_length_exceeded`, or whose text matches `/context length\|context window\|maximum context\|too many tokens/i` | `provider.context_length` | no | `The conversation is too long for <model> at <id>.` |
| other HTTP 400 or 422 | `provider.bad_request` | no | `<id> rejected the request (<status>).` |
| HTTP 404 | `provider.not_found` | no | `<id> has no model "<model>", or the base URL is wrong (<baseURL>).` |
| other 4xx | `provider.bad_request` | no | as above |
| an `error` payload inside the stream (thrown by the SDK as `APIError` with no `status`, or seen in a chunk), `finish_reason: "error"`, a chunk that fails `ChatChunk`, a JSON `SyntaxError`, or a body that ends with no `[DONE]` and no finish reason | `provider.stream_broken`, unless `error.code` is a number (mapped as a status by the rows above) or `rate_limit_exceeded` / `insufficient_quota` / `context_length_exceeded` (mapped by those rows) | as that row; `stream_broken` is no | `The reply from <id> broke off partway.` |
| model ref provider not configured | `provider.unknown_provider` | no | `No provider "<id>". Add providers.<id> to <user settings path>.` |
| `api: "anthropic_messages"` (before #20) | `provider.unsupported_api` | no | `Provider "<id>" uses anthropic_messages, which arrives with the Anthropic adapter. Use an openai_chat provider for now.` |
| no `model.main` | `provider.no_model` | no | see AC-9 |
| fake script used up / invalid | `provider.fake_exhausted` / `provider.fake_script_invalid` | no | `The fake script has <n> steps and all were used.` / `Fake script step <s>, event <e>: <issue>.` |

### Value sourcing

| Action | Value | Source |
|---|---|---|
| chat request | `model` | `ModelRequest.model.model` |
| chat request | `baseURL` | user `providers.<id>.baseURL`, else the built in entry, else `https://api.openai.com/v1` (AC-9) |
| chat request | API key | `resolveApiKey(providers.<id>.apiKey, getEnv)` at call start; `getEnv` reads the process environment `cli` already passes in (`program.ts` `env`) |
| chat request | max tokens field | `ModelRequest.maxOutputTokens`, with the field name from the `baseURL` host (AC-3) |
| chat request | `tool_call_id` and `tool_calls[].id` | the pk `CallId` on the block, so no map is kept between calls (rationale) |
| stream events | `callId` | the injected `newId("call")` (spec 0002), from `createIdFactory` in `cli` |
| `usage` event | token counts | the server's `usage` chunk, computed as in AC-4; no event when absent |
| `usage` event | `providerCostMicroUsd` | `usage.cost` (USD) × 1e6, rounded; absent when not sent |
| error message | `<hint>` (`keyHint`) | built by `cli` from the key source: `<VAR> is set and valid` for `{ env }`, or `providers.<id> in your user settings has an apiKey (it has none; add { "env": "VAR_NAME" })` when there is no source |
| key resolution | `providerId` | the `ModelRef.provider` being served |
| error message | `<user settings path>` | `paths().config` + `/settings.json` |
| error message | `Server said:` text | the SDK error's message or the chunk's `error.message`, redacted with the key, cut to 500 characters |
| retry wait | `delayMs` | `ProviderError.retryAfterMs` (the adapter reads `retry-after-ms`, or a numeric `retry-after`, from the SDK error's `headers`), else `retryAfterDate` resolved against `withRetry`'s `now()`, else full jitter from the injected `random()` with a 250ms floor (AC-7) |
| debug log | `firstEventMs`, `totalMs` | `withRetry`'s injected `now()`, read at attempt start, first event and end |
| retry notice | text | `retryNoticeText(info)`: the error's short reason (`Rate limited by <id>`, `<id> is overloaded`, `<id> had a server error`, `<id> timed out`, `Could not reach <id>`), then `, retrying in <ceil(delayMs/1000)>s (<retry> of <maxRetries>)` |
| timeouts | 300s / 300s | `DEFAULT_TIMEOUT_POLICY` constants; no setting |
| fake provider | script | the JSON file named by `PK_FAKE_SCRIPT`, read by `cli` |
| registry | main model | `settings.model.main`; none means `provider.no_model` (no default model, no flag), except under `PK_FAKE_SCRIPT`, where it is `fake/fake` |

### Key invariants

- A stream has exactly one `stop` and it comes last. `tool_call_end` comes for every started call unless the stop is `aborted`.
- A call is retried only before its first event. pk never resends a request after showing any of its reply.
- Retries never stack: SDK clients have `maxRetries: 0`, and `withRetry` is applied once, in `cli`.
- Outgoing requests carry no reasoning blocks and no vendor fields beyond AC-3's list.
- The adapter keeps no state between calls. Every id it sends is a pk `CallId` already in the conversation.
- `inputTokens` never goes below zero, and a missing usage is never reported as zeros.
- The key value appears only in the HTTP `Authorization` header.
- No timer, signal listener or open request outlives a call, however it ends.
- A tool call cut off by the output limit, or with no name, always carries `inputError`, so the loop never runs it.

### Security model

- **Key handling**: keys come only from an environment variable named in user settings (project files cannot set `providers`, spec 0002), read at call time, held in no module level value, and passed to `redact()` as a known secret for every error message the adapter builds. The placeholder `pk-no-key` is not a secret and is not redacted.
- **Where the key goes**: only to the `baseURL` of the provider entry it belongs to. A project cannot redirect it, because `providers` is user only.
- **Untrusted input**: every SSE chunk is parsed with `ChatChunk`, tool arguments with `JSON.parse` inside a try, and server error text is redacted and cut to length before it reaches a message. The fake script is parsed with `FakeScript`.
- **Logs**: metadata only (AC-12), and the logger redacts as well (spec 0001).
- No compliance scope applies. pk sends your conversation to the provider you configured, and nowhere else.

### Configuration required

- `OPENAI_API_KEY`: the built in `openai` provider's key. Any other provider uses the env var you name in `providers.<id>.apiKey.env`.
- `PK_FAKE_SCRIPT` (exists, spec 0001): path to a fake script. Tests and e2e only.
- `PK_LIVE_TEST=1`, with `PK_LIVE_BASE_URL`, `PK_LIVE_MODEL` and `PK_LIVE_API_KEY`: turns on the live smoke test. Optional, never in CI.
- No settings changes, so `schemas/settings.schema.json` stays as is.

Example user `settings.json` entries:

```json
{
	"model": { "main": "openrouter/<vendor>/<model>" },
	"providers": {
		"openrouter": { "api": "openai_chat", "baseURL": "https://openrouter.ai/api/v1", "apiKey": { "env": "OPENROUTER_API_KEY" } },
		"groq": { "api": "openai_chat", "baseURL": "https://api.groq.com/openai/v1", "apiKey": { "env": "GROQ_API_KEY" } },
		"ollama": { "api": "openai_chat", "baseURL": "http://localhost:11434/v1" }
	}
}
```

### Critical test scenarios

- Happy path: an OpenAI fixture with text, then two parallel tool calls and usage with 1,000 prompt and 400 cached tokens → `text_delta`s, two `tool_call_start`/`delta`/`end` groups with minted ids, `usage { inputTokens: 600, cacheReadTokens: 400 }`, `stop: tool_use`, and no `checkStreamOrder` issues. Verifies **AC-1**, **AC-4**.
- Same path, four servers: the OpenRouter, Ollama and Groq fixtures for the same reply give the same event types and order as OpenAI. Verifies **AC-2**.
- Request translation: a conversation with a system prompt, two user messages in a row, a reasoning block, an error result and a tool result with an image → one system message, one merged user message, no reasoning, `Error: ` content, a `tool` message, then a user message holding the labelled image. Verifies **AC-3**.
- Retry: the fake script `[error rate_limited retryAfterMs 2000, events…]` → one `onRetry { retry: 1, delayMs: 2000 }`, `sleep(2000)`, then the events. Four 503s and a success → four retries. Five 503s → `provider.overloaded … (gave up after 5 attempts)`. `retry-after: 120` → no wait, `Retry after 120s.` Verifies **AC-7**.
- No retry mid stream: `events [text_delta] thenError server` → the text is yielded, then `provider.server` is thrown and the step is not replayed. Verifies **AC-7**.
- Abort: abort after the first tool call fragment → `stop: aborted` with no `tool_call_end`, no throw, fetch signal aborted, and `checkStreamOrder` returns no issues. Abort during a retry wait → `stop: aborted`. Verifies **AC-5**, **AC-7**.
- Timeout: a fake fetch that never sends a byte, with a manual timer → `provider.timeout` after 300s, retried; an idle gap of 300s after the first event → `provider.timeout` thrown, not retried; a consumer that holds an event for 400s → no timeout; timer and user abort in the same tick → `stop: aborted`; a consumer that breaks early → no pending timer or signal listener left. Verifies **AC-8**.
- Truncation: a body that ends with no `[DONE]` and no finish reason → `provider.stream_broken`; `finish_reason: "length"` with an open call whose arguments happen to parse → `inputError: "reply was cut off at the output limit"`. Verifies **AC-4**.
- Ollama grouping: two whole tool calls in single chunks with no `index` and no `id` → two separate calls, not one merged call; `null` fields everywhere → no `stream_broken`. Verifies **AC-4**, **AC-11**.
- Failure messages: 401 with the server text containing the key → `provider.auth`, the message names `OPENROUTER_API_KEY`, and the key shows as `[REDACTED]`. A refused connection to localhost → `provider.network` with `Is the local server running?`. Verifies **AC-6**.
- Bad arguments: a tool call with `{"path": ` → `input: {}`, `inputError: "arguments are not valid JSON: …"`. Verifies **AC-4**.
- Setup: unset `OPENAI_API_KEY` → `provider.missing_key`; `{ keychain: true }` → `provider.keychain_unavailable`; Ollama with no key sends `Bearer pk-no-key`; `model.main` unset → `provider.no_model`. Verifies **AC-9**.
- Who is denied: a project `.pk/settings.json` that sets `providers.openai.baseURL` cannot redirect the key, because the request still goes to the user entry's URL. Verifies **AC-9** (spec 0002 trust rule).

## Build plan

Tracer Bullet: milestone 1 runs one real thread (fake provider and real adapter, both through `cli` wiring) before any segment is thickened. The full user visible thread (`pk`, a question, a streamed answer) closes when #6 adds the loop on top of this.

**Milestone 1: the tracer thread**

1. Add `ProviderErrorCode`, `FakeScript`, `FakeStep` and `FakeError` to `@pk/schema` with doc comments. Amend `checkStreamOrder`: skip the `unfinished_call` report only when the stream's single `stop` has reason `aborted` (a stream with no `stop` still reports it, and `after_stop` still catches late call events). Add tests for both sides. `checkConversation` already drops unended calls on abort, so it needs no change. Satisfies **AC-5**, **AC-10**.
2. In `@pk/provider`, add `Provider`, `StreamOptions`, `RetryInfo`, `Sleep`, `ProviderError` with `DEFAULT_RETRYABLE`, `resolveApiKey`, `NO_KEY_PLACEHOLDER`, `parseFakeScript` and `createFakeProvider` (events, error steps, `requests()`, exhaustion, abort). Satisfies **AC-1**, **AC-9**, **AC-10**.
3. Install `openai@7.56.0` (exact) in `provider-openai`, allow `zod` there in `scripts/check-boundaries.ts`, and add `createOpenAIProvider` handling text only: a per call client built as in AC-13 (`organization: null`, `project: null`, injected `fetch`), the entry abort check, early `return()` cancelling the request; a minimal `toChatRequest` (system and text messages); `ChatChunk`; `text_delta`, finish reason and `stop`. Test it with an OpenAI text fixture. Satisfies **AC-1**, **AC-13**.
4. In `cli`, add `BUILTIN_PROVIDERS` and `createProviderRegistry` (`providerFor`, `mainModel`, `unknown_provider`, `unsupported_api`, `no_model`, `keyHint`), and serve every ref from the fake provider when `PK_FAKE_SCRIPT` is set. Add an integration test: registry → fake provider → events, and registry → adapter over a fixture → events. Satisfies **AC-9**, **AC-10**.

**Milestone 2: tool calls and full translation**

5. Complete `toChatRequest`: merging, image parts, `tool` messages with `Error: `, tool images in a follow up user message, assistant `tool_calls` with pk ids, reasoning dropped, `tools` mapping and omission, the max tokens field by host, `stream_options`. Satisfies **AC-3**.
6. Complete the stream mapper: reasoning fields, tool call grouping by index, id or 0, name repair, argument parsing with `inputError`, end ordering, usage math, `providerCostMicroUsd`, the full stop mapping. Satisfies **AC-4**.

**Milestone 3: failure, retry and abort**

7. Add `toProviderError` and the *Error mapping* table, with `Server said:` redacted and cut to length, the `keyHint` and `localhost` variants, and `error` chunks inside a stream. Satisfies **AC-6**.
8. Handle abort in the adapter: `stop: aborted`, no ends for open calls, no usage, fetch cancelled. Satisfies **AC-5**.
9. Add `retryDelay`, `withRetry` (only before the first event, `Retry-After`, the 60s give up, abort during wait, `onRetry`, the `gave up after` message) and `retryNoticeText`. Satisfies **AC-7**.
10. Add `withTimeouts` with an injected `setTimer`: timers only while awaiting the inner `next()`, the child controller, user abort wins, `return()` on the inner iterator, and cleanup in `finally` with a no leftover timer or listener test. Wire `withRetry(withTimeouts(adapter))` in the registry. Satisfies **AC-8**, **AC-9**.
11. Add the `debug`, `warn` and `error` log lines in `withRetry` through the injected logger, with a test that no message text reaches the log. Satisfies **AC-12**.

**Milestone 4: compatible servers and live smoke**

12. Add the OpenRouter, Ollama and Groq SSE fixtures and the same reply test across all four servers. Satisfies **AC-2**, **AC-11**.
13. Add `src/live.test.ts` behind `PK_LIVE_TEST=1` (one text reply and one tool call against a real endpoint), and confirm `bun run check` skips it and passes. Satisfies **AC-11**, **AC-13**.

## Consequences

**Positive**:
- Every OpenAI style server works through one adapter, and #19 presets only fill in settings entries.
- Retry and timeout logic is written once and applies unchanged to #20 and #31, because it wraps any `Provider`.
- The adapter is stateless, so resumed sessions (#24) and provider switches mid session (#21) send correct tool call ids without a saved map.
- The fake provider exercises every failure path (retries, mid stream breaks, exhaustion, slow streams) offline and in e2e.

**Negative / tradeoffs**:
- No retry after the first event: a network blip mid reply ends the turn with an error, and you have to resend.
- Mistral's OpenAI compatible API requires 9 character alphanumeric tool call ids, so sending pk `CallId`s will fail there until #19 adds a per preset id rewrite.
- Reasoning is never sent back, so a reasoning model on a compatible server loses its earlier thinking between turns (OpenRouter's `reasoning_details` replay is not supported).
- Picking the max tokens field by host is a heuristic. An OpenAI model behind a proxy URL gets `max_tokens` and may reject it.
- Servers that reject `stream_options` (rare, older local servers) fail with `provider.bad_request`. There is no automatic fallback.
- A 5 minute first event timeout means a dead hosted endpoint that accepts the connection but never answers takes 5 minutes (times 5 attempts, about 25 minutes) to fail, unless you press Esc. A retried timeout also resends the whole prompt to a server that may still be working on the first one, so it can bill twice.
- The 5 minute idle limit means a stream that dies after its first event takes 5 minutes to report it, because keepalive chunks are invisible to the wrapper.
- The SDK still adds its own fixed client headers (`User-Agent`, `x-stainless-*`) to every request, to every server.
- `provider-openai` gains a direct `zod` dependency, a module map exception to keep in mind.

**Neutral**:
- Spec 0002 AC-7 changes (an unfinished call is allowed under an aborted stop), and spec 0001's module map row for `provider-openai` gains `zod`.
- The loop (#6) owns turning `onRetry` into `notice` events, and the `Cost` it builds from `providerCostMicroUsd`.
- The `openai` SDK releases almost daily. Pin it exactly, and rerun the fixture tests on each upgrade.

## Follow-up

- [ ] #6 Agent loop: pass `onRetry` and emit `notice { level: "warning", code: "provider.retrying", text: retryNoticeText(info) }`, and end the turn with `TurnError { code, message }` from a thrown `ProviderError`.
- [ ] #19 Model catalog and presets: add Mistral's tool call id rewrite, optional per preset headers (OpenRouter's app headers), a per preset max tokens field to replace the host rule, and a preset flag for servers without `stream_options`.
- [ ] #21 Model switching: consider a `--model` flag next to `/model`. This spec deliberately adds no default model and no flag.
- [ ] #25 Context compaction: trigger on `provider.context_length`.
- [ ] Update `packages/provider/AGENTS.md` and `packages/provider-openai/AGENTS.md` (via `/sync`) with the wrapper order `withRetry(withTimeouts(adapter))`, the fixture folder and `PK_LIVE_TEST`.
