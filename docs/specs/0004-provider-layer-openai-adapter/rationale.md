# 0004. Provider layer and OpenAI compatible adapter: rationale

Decision record for [spec 0004](index.md). `/develop` builds from `index.md` and skips this file.

## Context

pk must talk to many model servers without the loop or the tools knowing which one. Spec 0001 already put each vendor SDK inside its own adapter package, created with `maxRetries: 0`, and gave `@pk/provider` the one retry policy. Spec 0002 already fixed the shapes at this boundary: `ModelRequest` in, an ordered stream of `ProviderStreamEvent` out (exactly one `stop`, last), `Usage` with uncached input, `Cost` that is never unknown as zero, pk minted `CallId`s, and a user only `providers` settings entry (`api`, `baseURL`, `apiKey: { env } | { keychain }`). What is still open is the contract that produces those shapes, and what happens when the server misbehaves.

The OpenAI chat completions format is the widest reaching single format: OpenAI, OpenRouter, Groq, Together, DeepSeek, xAI, Ollama and LM Studio all accept it. But compatible servers differ in small ways that break naive code. Reasoning arrives in non standard fields (`reasoning_content`, `reasoning`). Tool call fragments sometimes come without an `index`, or whole in one chunk. Usage comes only when asked for, and sometimes not at all. OpenRouter reports a cost figure. OpenAI's newer models reject `max_tokens`, while many other servers do not know `max_completion_tokens`. Tool messages accept text only, though pk tool results can hold images. And errors range from clean HTTP statuses to error objects sent in the middle of a stream.

Failure is the normal case for a coding agent that runs for minutes: rate limits in bursts, overloaded servers, local models that take minutes to load, laptops changing networks, and a user who presses Esc at any moment (spec 0001 requires one `AbortSignal` through every call, and an abort that ends the turn without a throw). The scope's done criteria ask that rate limits and network errors read as clear messages, not crashes, and that tests run with no network. pk's rules add pure functions at the core, I/O and clocks passed in, Zod at every trust boundary, and `redact()` on everything leaving the process, which includes error text a server may echo the key into.

Not deciding this blocks #6, the walking skeleton. Deciding it badly costs more later: retry logic copied into each adapter stacks retries, and an adapter that keeps per session state breaks resume (#24) and provider switching (#21).

## Options considered

### Option 1: Provider object with one stream method, stateless adapter, wrappers for retry and timeouts (chosen)

`Provider` is `{ id, api, stream(request, { signal, onRetry }) }` returning an async iterable of pk events. The OpenAI adapter maps requests and chunks with pure functions and keeps nothing between calls: the ids it sends are the pk `CallId`s already stored in the conversation. Retry (`withRetry`) and timeouts (`withTimeouts`) are separate wrappers in `@pk/provider` that take a `Provider` and return one, composed once in `cli`.

**Pros**:
- One contract for every adapter, tested by the existing `checkStreamOrder`. Retry and timeouts apply to #20 and #31 unchanged.
- Pure mappers are easy to unit test from SSE fixtures, and the wrappers are easy to test against the fake provider with injected clocks and timers.
- No adapter state means resume and provider switching just work.

**Cons**:
- Two wrapper layers plus an adapter is three async iterator layers to follow when you debug a stream.
- Sending pk ids on the wire breaks providers with strict id rules (Mistral) until presets add a rewrite.

### Option 2: Adapter owns everything (retries, timeouts, id map) inside one class

Each adapter handles its own retries and timeouts, using the SDK's built in retry, and keeps a map from pk `CallId` to the provider's ids, as the spec 0002 follow up first sketched.

**Pros**:
- Fewest layers. The SDK's retry logic is well tested and already reads `Retry-After`.
- Provider ids sent back exactly as the server made them, which suits strict servers.

**Cons**:
- Retry logic repeats in every adapter and drifts, against spec 0001's "one retry policy".
- The SDK retries can resend after partial output reached the screen, unless each adapter wraps them carefully.
- The id map is session state: it is lost on restart and is wrong after a provider switch, so it would have to be saved in the session (a spec 0002 change).

### Option 3: Collected replies, no streaming interface

`provider.complete(request)` returns a finished assistant message. Retrying the whole call is always safe.

**Pros**:
- The simplest interface and the simplest retry story (any failure can retry).
- Trivial to fake in tests.

**Cons**:
- No token by token output, which the TUI (spec 0003) and #14 are designed around. Long replies look frozen.
- Esc cannot show what had arrived so far, and slow local models feel broken.

## Rationale

Option 1 wins because it answers the two forces that matter most here: many slightly different servers, and constant failure. The first is handled by keeping every server difference inside pure mapping functions with fixtures per server, so adding OpenRouter's cost field or Ollama's chunk shape is a fixture plus a few lines. The second is handled by wrappers that know one safe rule, never retry once the reply has started showing. They are written once for every adapter, and every clock, timer and random source is injected, so the rule is tested offline to the millisecond. Option 2's single class is fewer layers, but it repeats the retry policy that spec 0001 says lives once in `@pk/provider`, and its id map turns a stateless translation into session state that resume and model switching would have to carry.

Sending the pk `CallId` as the wire id departs from spec 0002's follow up note, which sketched an adapter side map. OpenAI, OpenRouter, Groq and Ollama accept any id string that matches an earlier call. A stateless mapping is the only one that survives a restart or a provider switch without new saved data. Mistral's strict id format is the known exception, and a preset level rewrite (#19) handles it without touching the core.

The rest of the choices follow one pattern: prefer honest data over a guess. No usage means no usage event, so cost tracking (#22) counts the call as unknown rather than zero. Reasoning is read for display but never sent back, because the chat format has no standard slot and DeepSeek rejects it. A server's error text is kept, redacted and cut short, because it usually names the real cause (a wrong model name, a bad tool schema). No default model ships, because model names go stale within months and the catalog (#19) is where defaults belong. The 5 minute first event timeout favors local users loading a large model over fast failure on hosted APIs, and Esc covers the impatient case.
