# Epic: Providers

The one shared provider layer, so the agent loop and tools never depend on a particular vendor. Part of the [pk scope](index.md).

## Slice 1: First working conversation

### 5. Provider layer & OpenAI compatible adapter · needs a decision
The provider interface (streaming, tool calls, usage, errors, retries) and its first adapter for the OpenAI compatible format, configurable by base URL and an API key from an environment variable. Also a scripted fake provider so the loop and tools can be tested offline.
**Done when:** the same code path talks to OpenAI, OpenRouter, Groq or a local Ollama by changing only base URL, key and model; rate limits and network errors surface as clear messages, not crashes; tests run against the scripted provider with no network. (basis: the OpenAI compatible format is the widest reaching single adapter)
- [ ] Design it (spec): `/architect provider layer & OpenAI compatible adapter`

## Slice 6: Providers and accounts

### 18. Login & keychain storage · needs a decision
`pk login` and `/login` add a provider and store its API key in the OS keychain (macOS Keychain, Linux Secret Service), never in plain text, config files or logs.
**Done when:** a user logs in once and pk works across restarts; secrets never appear in files, logs, session transcripts, errors or headless JSON; logout removes them; a clear message shows when no keychain is available. (basis: secrets belong in the OS credential store)
- [ ] Design it (spec): `/architect login & keychain storage`

### 19. Model catalog & provider presets · needs a decision
Known providers (Anthropic, OpenAI, Gemini, xAI, Mistral, DeepSeek, OpenRouter, Groq, Together, Ollama, LM Studio) as presets, and per model facts: context size, tool calling support, image support, prices.
**Done when:** picking a preset needs only a key (or nothing, for local servers); models without tool calling are clearly flagged before use; unknown models still work with sensible defaults; local model prices are zero.
- [ ] Design it (spec): `/architect model catalog & provider presets`

### 20. Anthropic native adapter · needs a decision
The second API style: Anthropic's Messages API behind the same provider interface, including streaming, tool use and prompt caching.
**Done when:** every tool and the loop behave the same on Anthropic and OpenAI compatible models; cache and usage tokens are reported so costs are exact; the conversation can switch between the two styles mid session.
- [ ] Design it (spec): `/architect anthropic native adapter`

### 21. Model switching & model roles · needs a decision
`/model` switches provider and model at any time; roles map different models to different jobs (main conversation, context summarizing, later subagents).
**Done when:** switching mid conversation keeps the history; a cheaper model can be set for summarizing; choosing a model without tool calling warns before it is used as the main model; choices persist per user and project.
- [ ] Design it (spec): `/architect model switching & model roles`

### 22. Cost tracking · needs a decision
Track tokens and cost per provider and model, per session and over time, all stored locally. `/cost` shows the breakdown.
**Done when:** `/cost` shows tokens and cost per provider and model for this session; cached tokens are priced correctly; providers that report their own cost (like OpenRouter) use that figure; unknown prices show as unknown, never as zero.
- [ ] Design it (spec): `/architect cost tracking`

## Slice 9: Subscription and more providers

### 30. Subscription sign in · needs a decision
Sign in with an existing paid subscription only where the provider officially allows third party tools, such as "Sign in with ChatGPT" for participating apps. Tokens go to the keychain. Consumer subscriptions restricted to a provider's own apps (such as Claude Free, Pro or Max) are never used.
**Done when:** a ChatGPT subscriber signs in through the browser and uses pk without an API key; tokens refresh and are stored only in the keychain; any provider without official third party permission is not offered; the spec records each provider's terms as checked. (basis: OAuth for native apps with PKCE; each provider's published terms)
Heads up: as of November 2026, OpenAI's developer docs describe using a ChatGPT plan in third party apps as a limited trial for approved partners, so pk must apply and be approved before this ships. Anthropic's Claude Code docs say third party apps may not offer Claude.ai login or route requests through Free, Pro or Max credentials. See [References](index.md#references).
- [ ] Design it (spec): `/architect subscription sign in`

### 31. Gemini native adapter · needs a decision
A native Google Gemini adapter for features the OpenAI compatible endpoint does not expose well.
**Done when:** Gemini models pass the same tool and loop tests as the other two styles, and pk-bench can compare them.
- [ ] Design it (spec): `/architect gemini native adapter`
