# Review, main (provider layer and OpenAI compatible adapter), 2026-11-27

**Reviewed by**: Sonnet 5.5 (fresh reviewer, did not write the code)
**Scope**: 59 files (bun.lock ignored), uncommitted on main
**Verdict**: Approve with nits

## Summary
This change adds the provider interface, the fake provider, `withRetry`, `withTimeouts`, key resolution, the OpenAI compatible adapter (request mapping, stream mapping, error mapping), the `cli` registry and the 15 SSE fixtures. It follows spec 0004 closely. I traced the abort paths, the retry and timeout wrappers, tool call grouping, the error table and the key handling, and found no blockers and no majors. The findings are a handful of small gaps: a spec inconsistency about `stream_broken` retries, weak error messages for bad fake scripts, key redaction for very short keys, and wiring that exists only in tests so far.

## Minor

### 🟡 `stream_broken` is never retried, even before the first event, `packages/provider/src/errors.ts:21`
**Problem**: AC-4 says a body that ends with no `[DONE]` and no finish reason throws `provider.stream_broken` "(retryable only before the first event, AC-7)". The Error mapping table and `DEFAULT_RETRYABLE` say `stream_broken` is not retryable. The code follows the table, so `withRetry` never retries it. The spec contradicts itself and the code picked one side.
**Why it matters**: A server that accepts the connection and drops it before sending any event is a common transient failure. With the current code the user sees "The reply from X broke off partway" at once instead of a retry. If the AC-4 wording was the intent, this is a behavior gap.
**Suggested fix**: Decide which sentence is right and fix the other. If a zero event truncation should retry, have the adapter mark that one case retryable (the `retryable` init field already allows it), and add a test through `withRetry`. If not, remove the parenthetical from AC-4.

### 🟡 Bad fake scripts give a message with no detail, `packages/provider/src/fake.ts:46`
**Problem**: AC-10 says a script that fails its schema throws `provider.fake_script_invalid` naming the step and event index. Because `FakeStep` is a Zod union, Zod collapses every failure inside a step into one issue at `steps.N` with the text "Invalid input". I ran three bad scripts (a misspelled field, a bad `stop` reason, an unknown error code) and each gave `Fake script step 1: Invalid input.` The event index and the real cause never appear. Only `checkStreamOrder` failures name the event.
**Why it matters**: The fake script is how every offline test and e2e run is written. A typo in a script is likely, and this message gives no hint where to look.
**Suggested fix**: When the first issue is a union failure, look inside it (for example parse the step against each branch separately, or walk the union's inner issues) so the message names the event index and the field. Add a test for the message of a bad event and a bad error code.

### 🟡 Short API keys are not scrubbed from `Server said:` text, `packages/provider-openai/src/errors.ts:178`
**Problem**: `redact()` ignores known secrets shorter than 8 characters (`MIN_KNOWN_SECRET_LENGTH` in `packages/env/src/redact.ts`). The adapter relies on it to remove the key from echoed server text. A key such as `ollama` or `local` would pass through into the error message.
**Why it matters**: The spec invariant is that no error message ever contains the key value. Short keys are mostly local servers, so the risk is low, but the guarantee as written is not true for them.
**Suggested fix**: Either scrub the key with a direct string replace in the adapter before calling `redact()`, or write down the 8 character floor in the spec's Security model and accept it.

### 🟡 Registry and fake script loading have no call site yet, `packages/cli/src/providers.ts:71`
**Problem**: `createProviderRegistry`, `loadFakeScript`, `createSleep` and `createSetTimer` are used only by tests. `program.ts` and `main.ts` never build a registry or read `PK_FAKE_SCRIPT`. AC-9 and AC-10 say "cli reads and parses it and serves every model ref from that one fake provider". The unchecked verify step (e2e with a scripted `rate_limited`) depends on this wiring.
**Why it matters**: This is fine as a slice if #6 is meant to wire it (the spec says the loop calls the registry). But the `PK_FAKE_SCRIPT` behavior is not reachable from the binary today, and nothing records that #6 must do it.
**Suggested fix**: Add a line to the Follow up list in spec 0004 (and the #6 scope entry) saying #6 builds the registry in the composition root with real `setTimeout`, `Date.now` and `Math.random`, and reads `PK_FAKE_SCRIPT`. Or wire a minimal call now.

### 🟡 `messageFor` ends in a catch all `default`, `packages/provider-openai/src/errors.ts:67`
**Problem**: The `switch` over `ProviderErrorCode` handles some codes and sends every other code (including `provider.missing_key`, `provider.fake_exhausted` and any future code) to "The reply from X broke off partway".
**Why it matters**: AGENTS.md asks for exhaustive switches with a `never` check. Today only valid codes reach it, but a new code added later would silently get the wrong message with no compile error.
**Suggested fix**: List the stream and non adapter codes explicitly and end with a `never` check, or narrow the parameter type to the codes this adapter can produce.

## Nits
- ⚪ `packages/provider/src/timeouts.ts:37`, the abort listener is added before the `try`. If `provider.stream()` ever threw synchronously the listener would leak. Move the setup inside the `try`.
- ⚪ `packages/provider-openai/src/adapter.ts:143`, after a normal finish `cancel` is cleared, so the response body is not cancelled. The SDK stops reading at `[DONE]` and servers normally close the connection, but a server that holds it open would leave it until the server gives up. Calling `cancel` after `[DONE]` as well would match the invariant "no open request outlives a call".
- ⚪ `packages/provider-openai/src/stream-map.ts:213`, a usage object that exists but has no token fields becomes a `usage` event of zeros. The invariant says a missing usage is never reported as zeros. Only matters for odd servers that send `usage: {}` or cost only.
- ⚪ `packages/provider/src/retry.ts:151`, a non `ProviderError` thrown by an inner provider is rethrown without the final `error` log line that AC-12 describes. Adapters always throw `ProviderError`, so this is theoretical.
- ⚪ `packages/provider-openai/src/errors.ts:55`, the SDK connection timeout message says "sent nothing for 86400s". It is unreachable in practice because `withTimeouts` fires first, but the text would read oddly if it ever surfaced.

## Strengths
- Abort handling is careful and layered correctly: abort check before key read, user abort wins over timeout in the same tick, unfinished calls dropped, request cancelled on early `return()`, and tests assert no timer or listener is left.
- `withRetry` and `withTimeouts` are clean, injected wrappers (clock, random, sleep, timer all passed in), errors are never mutated, and the 60 second and "gave up" suffix rules match the spec exactly.
- The adapter hardens against the environment: per call client with `organization: null`, `project: null`, `logLevel: "off"` (verified the SDK would otherwise log chunk text), a header allow list that drops `OPENAI_CUSTOM_HEADERS`, and a `[DONE]` detector that survives markers split across reads.
- Error mapping is a faithful single table with redaction, HTML bodies never echoed, a sanitized `cause`, and no vendor type crossing the `@pk/provider` interface.
- The stream mapper is pure and handles the real quirks (null fields, Ollama calls with no index or id, held arguments before the name, length cut off calls, name repair) with a fixture per server and a same reply test across all four.

## Test coverage
Strong. Every AC has direct tests: request translation, stream mapping, the four server same reply test, failure rows, abort and early return, retry timing with injected clocks, timeout cleanup, fake provider behavior, key resolution, registry wiring including the "project file cannot redirect the key" case, and the boundary rule for `openai` and `zod`. The live test is opt in and skipped. Gaps I would add: a test for the `stream_broken` retry decision once it is settled, a test for the message of a schema invalid fake script that names the event, and a short key redaction test. `bun run check` is reported green (486 pass, 2 skip, 0 fail), and I did not re run it.
