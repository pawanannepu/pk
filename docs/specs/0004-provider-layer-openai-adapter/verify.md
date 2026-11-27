# Verify: Provider layer and OpenAI compatible adapter · spec 0004 · updated 2026-11-27
_Steps derived from spec 0004 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

Most of this feature is verified by offline tests. The live steps are optional and need your own keys (or a local Ollama).

## Automated
- [x] `bun run check` passes, and the output shows the live smoke test skipped → AC-11, AC-13
- [x] `bun test packages/provider-openai` → the four server fixtures (OpenAI, OpenRouter, Ollama, Groq) give the same event sequence for the same reply, and every stream passes `checkStreamOrder` → AC-1, AC-2, AC-4
- [x] `bun test packages/provider` → retry, timeout, abort and fake script tests pass with injected clocks, no real waiting → AC-5, AC-7, AC-8, AC-10
- [x] `bun run boundaries` → `openai` appears only in `provider-openai`, and `zod` is allowed there → AC-13

## Live (optional)
- [ ] `PK_LIVE_TEST=1 PK_LIVE_BASE_URL=https://api.openai.com/v1 PK_LIVE_MODEL=<model> PK_LIVE_API_KEY=$OPENAI_API_KEY bun test packages/provider-openai/src/live.test.ts` → one text reply and one tool call with parsed input → AC-2, AC-11
- [ ] Same with `PK_LIVE_BASE_URL=http://localhost:11434/v1`, a local model and no key → works, and the request carries `Bearer pk-no-key` → AC-2, AC-9
- [ ] Same with OpenRouter → the `usage` event carries `providerCostMicroUsd` → AC-4
- [ ] Stop Ollama and run again → `provider.network` with `Is the local server running?` after the retries → AC-6, AC-7
- [ ] Use a wrong key against OpenRouter → `provider.auth` naming the key's env var, and the key value nowhere in the message or the log → AC-6, AC-12

## Value sourcing
- [x] Unset `OPENAI_API_KEY` with `model.main: "openai/<model>"` → `provider.missing_key` naming `OPENAI_API_KEY` → API key source
- [x] Remove `model.main` → `provider.no_model` showing your real user settings path → main model, settings path
- [x] Put `providers.openai.baseURL` in a project `.pk/settings.json` → ignored with a `user_only_key` warning, and requests still go to the user entry's URL → baseURL source
- [ ] Run the e2e smoke with a `PK_FAKE_SCRIPT` whose first step is `rate_limited` with `retryAfterMs: 50` → one retry, then the scripted reply → retry wait source

## Added by /develop · 2026-11-27
- [x] `bun test packages/provider-openai/src/adapter.test.ts` → with `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID`, `OPENAI_BASE_URL`, `OPENAI_CUSTOM_HEADERS` and `OPENAI_LOG` all set, the request still goes to the configured URL and carries only `authorization`, `content-type`, `accept`, `user-agent` and `x-stainless-*` headers, and nothing prints to the console → AC-3, AC-12, AC-13
- [x] `bun test packages/cli/src/providers.test.ts` → registry to adapter over a fixture, registry to fake under `PK_FAKE_SCRIPT`, Ollama sends `Bearer pk-no-key`, a project file cannot redirect the key, and the four setup errors read as the spec says → AC-9, AC-10
