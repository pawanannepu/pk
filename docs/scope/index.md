# Scope: pk

pk is an open source terminal AI coding agent. It helps a developer understand, write, change, run and verify code in their current project through a conversation in the terminal, with any model provider behind one shared provider layer. It is built clean room from the product description, for developers on macOS and Linux.

**Build approach:** Tracer Bullet (prove one real thread runs end to end through provider, loop, tools, permissions and terminal, then thicken one segment per slice). (basis: tracer bullet development, walking skeleton)
**Workflow:** GA (after `/develop`: `/check verify`, `/test`, a fresh model `/check review`, then `/document`). The project default level of rigor. `/architect` is the recommended first stop for a feature with a real decision, but skippable when you already know the build. Any feature can carry its own tag (e.g. `· Beta`) to do more or less.

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use `/develop` and skip `/architect`. You decide when a feature is `done`._

**Product decisions so far:** MVP is the core loop with two API styles (Anthropic native plus OpenAI compatible, which already reaches OpenRouter, Groq, Together, Ollama, LM Studio, DeepSeek, xAI and Mistral); open source and published; macOS and Linux at launch; solo builder, no hard deadline; no telemetry (costs, sessions and logs stay on the user's machine); English only; plain output when `NO_COLOR` is set or output is not a terminal. The MVP is everything through **#29 Release & distribution**.

## At a glance

| # | Feature | Phase | Status | Epic |
|---|---------|-------|--------|------|
| 1 | Stack & architecture | Foundation | in-progress | [foundations](foundations.md) |
| 2 | Coding standards & tooling | Foundation | done | [foundations](foundations.md) |
| 3 | Core data model | Foundation | done | [foundations](foundations.md) |
| 4 | Terminal UI foundation | Foundation | in-progress | [foundations](foundations.md) |
| 5 | Provider layer & OpenAI compatible adapter | Slice 1 | done | [providers](providers.md) |
| 6 | Agent loop & read file tool | Slice 1 | in-progress | [agent](agent.md) |
| 7 | Permission prompts & modes | Slice 2 | planned | [safety](safety.md) |
| 8 | File write & exact edit tools with diffs | Slice 2 | planned | [tools](tools.md) |
| 9 | Shell command tool | Slice 2 | planned | [tools](tools.md) |
| 10 | Permission rules & always ask list | Slice 2 | planned | [safety](safety.md) |
| 11 | Search & listing tools | Slice 3 | planned | [tools](tools.md) |
| 12 | To do list tool | Slice 3 | planned | [tools](tools.md) |
| 13 | Slash command framework & core commands | Slice 4 | planned | [terminal](terminal.md) |
| 14 | Streaming markdown & compact tool display | Slice 4 | planned | [terminal](terminal.md) |
| 15 | Input editing, history & Esc interrupt | Slice 4 | planned | [terminal](terminal.md) |
| 16 | Project instructions & environment context | Slice 5 | planned | [agent](agent.md) |
| 17 | System prompt | Slice 5 | planned | [agent](agent.md) |
| 18 | Login & keychain storage | Slice 6 | planned | [providers](providers.md) |
| 19 | Model catalog & provider presets | Slice 6 | planned | [providers](providers.md) |
| 20 | Anthropic native adapter | Slice 6 | planned | [providers](providers.md) |
| 21 | Model switching & model roles | Slice 6 | planned | [providers](providers.md) |
| 22 | Cost tracking | Slice 6 | planned | [providers](providers.md) |
| 23 | Status line | Slice 6 | planned | [terminal](terminal.md) |
| 24 | Session save, continue & resume | Slice 7 | planned | [agent](agent.md) |
| 25 | Context compaction | Slice 7 | planned | [agent](agent.md) |
| 26 | Headless mode | Slice 8 | planned | [headless](headless.md) |
| 27 | pk-bench harness | Slice 8 | planned | [headless](headless.md) |
| 28 | pk-bench task suite | Slice 8 | planned | [headless](headless.md) |
| 29 | Release & distribution | Launch | planned | [release](release.md) |
| 30 | Subscription sign in | Slice 9 | planned | [providers](providers.md) |
| 31 | Gemini native adapter | Slice 9 | planned | [providers](providers.md) |
| 32 | Command sandbox | Slice 10 | planned | [safety](safety.md) |
| 33 | Undo & checkpoints | Slice 10 | planned | [safety](safety.md) |
| 34 | Custom slash commands | Slice 11 | planned | [terminal](terminal.md) |
| 35 | Hooks | Slice 11 | planned | [agent](agent.md) |
| 36 | MCP server support | Slice 11 | planned | [tools](tools.md) |
| 37 | Web fetch & search tools | Slice 11 | planned | [tools](tools.md) |
| 38 | Subagents | Slice 11 | planned | [agent](agent.md) |
| 39 | Image input | Slice 11 | planned | [terminal](terminal.md) |
| 40 | Self update | Slice 11 | planned | [release](release.md) |

Deferred (no slice yet): Windows support, screen reader mode, Linux musl support. See [release](release.md#deferred).

## Phases

- **Foundation (1 to 4):** stack, standards, data model, terminal look. Nothing feature shaped starts before these exist. (basis: foundations before features)
- **Slice 1 (5 to 6), the walking skeleton:** `pk` starts, you type a question, an OpenAI compatible model reads a file through a real tool call, and the answer streams back. Real loop, real provider, narrow.
- **Slice 2 (7 to 10), safe changes:** permissions come before any tool that writes or runs, so pk is never able to change things unasked. (basis: least privilege)
- **Slice 3 (11 to 12), find your way around:** search, listing, and the visible to do list.
- **Slice 4 (13 to 15), interactive experience:** slash commands, rendered markdown, real input editing and clean interrupt.
- **Slice 5 (16 to 17), project awareness and behavior:** PK.md, environment and git context, and pk's own system prompt.
- **Slice 6 (18 to 23), providers and accounts:** secure login, the model catalog, the second API style, `/model`, costs, status line.
- **Slice 7 (24 to 25), long sessions:** save and resume, and summarizing when context fills.
- **Slice 8 (26 to 28), headless and measurement:** `pk -p`, then pk-bench right away so every later change is measured.
- **Launch (29):** package, document and publish the MVP.
- **Slice 9 (30 to 31):** subscription sign in where providers officially allow it, and a native Gemini adapter.
- **Slice 10 (32 to 33):** OS level command sandbox, undo.
- **Slice 11 (34 to 40):** extensibility: custom commands, hooks, MCP, web tools, subagents, images, self update.

## Epics

- [foundations](foundations.md): 2 done, 2 in progress. Stack, standards, data model, terminal UI foundation.
- [providers](providers.md): 1 done, 7 planned. The provider layer, adapters, login, catalog, model roles, costs, subscription sign in.
- [agent](agent.md): 1 in progress, 6 planned. The loop, context, system prompt, sessions, compaction, hooks, subagents.
- [tools](tools.md): 6 planned. File, shell, search, to do, MCP and web tools.
- [safety](safety.md): 4 planned. Permission prompts, rules, sandbox, undo.
- [terminal](terminal.md): 6 planned. Slash commands, rendering, input, status line, custom commands, images.
- [headless](headless.md): 3 planned. `pk -p` and pk-bench.
- [release](release.md): 2 planned. Release, self update, deferred items.

## Legend

**The decision box.** Every feature carries exactly one, the sub task whose label ends with `(spec)`. Its wording varies (`Design it (spec)` normally, `Decide the stack (spec)` on Stack & architecture), so skills locate it by that `(spec)` suffix, never by an exact label. Every other box is an execution box and `/architect` never ticks one.

**Feature lifecycle**: the scope updates as a feature moves; each row is what it shows and who sets it:

| State | Set by | The feature shows |
|---|---|---|
| `planned` · needs a decision | `/scope` | one box: `Design it (spec): /architect <feature>` |
| `in-progress` (designed) | **`/architect` at spec capture** | `Design it` ticked; spec linked; `Build it: /develop <feature>` + **2 to 5 milestones**; the tier's closing boxes (`Verify it` Alpha+, `Test it` Beta+, `Review it` + `Document it` GA); any surfaced follow up enrolled |
| `in-progress` (building) | `/develop` | milestone sub boxes tick one by one; code pointer filled |
| `in-progress` (verified) | `/check verify` | `Build it` + milestones ticked; `Verify it` ticked |
| `done` | **you, when you decide it is** (any skill sets it when you say so); `/sync` reconciles | boxes you ran ticked, skipped ones marked skipped; the tier's last stage (`Prototype` → after `/develop`; `Alpha` → after `/check verify`; `Beta`/`GA` → after `/test`) is the suggested point to call it done; `/sync` captures conventions |

- **Next step** = the first unticked box (always a command or a tracked milestone).
- **needs a decision** = run `/architect` first; otherwise straight to `/develop` (or `/audit` for standards & tooling). The tag drops once the spec is captured.
- **Atomic build tasks live in the spec's `## Build plan`, not here**: the scope carries only the milestone rollup.
- **Status** `planned` → `in-progress` → `done`, plus `existing` (pre workflow) and `dropped` (de scoped, kept for history).
- **Approach tag** beside a heading (e.g. `· Facade`) overrides the project default for that feature; no tag = inherits it.
- **Workflow tier tag** beside a heading (e.g. `· Beta`) sets that one feature's rigor above or below the project default; no tag inherits the default. It decides the feature's check boxes and each skill's next suggestion.
- **Workflow** (header line) is the project default, what runs after `/develop`: **Prototype** = nothing (trust develop's own build time self check); **Alpha** = `/check verify`; **Beta** = `/check verify` then `/test`; **GA** = adds a fresh model `/check review` then `/document`. A feature built on an unratified decision (an `Assumed` spec) stays flagged, but that never blocks `done`.
- **Pointer line** (`spec <n> · code in <path>`): the spec link added by `/architect`, the code path by `/develop`.

## References

**Project sources**
- The pk product description (the `/scope` brief, November 2026): every capability, tool, permission mode, slash command and system prompt rule above comes from it.
- Planning answers from this `/scope` run: MVP boundary, audience, platforms, team, extras, sign in timing, pk-bench timing, telemetry, approach, sandbox, terminal behavior, workflow tier.

**Practices & standards**
- Tracer bullet development and walking skeleton: build one thin real thread through every layer first (Slice 1).
- Foundations before features; the data model is the costliest thing to redo (#1 to #4).
- Least privilege: permissions before any tool that writes or runs (Slice 2).
- Secrets belong in the OS credential store, never in files or logs (#18).
- OAuth for native apps with PKCE, through the system browser (#30).
- Grading agent output by running tests (#27).

**Links** (each fetched and checked in November 2026)
- [NO_COLOR](https://no-color.org/): CLI tools should not add color when `NO_COLOR` is set (#4, #14).
- [OpenAI: Sign in with ChatGPT quickstart](https://developers.openai.com/siwc/quickstart): using a ChatGPT plan in third party apps is a limited trial for approved partners (#30).
- [OpenAI Help: Sign in with ChatGPT](https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt): launched with a limited set of partners (#30).
- [Claude Code: legal and compliance](https://code.claude.com/docs/en/legal-and-compliance.md): third party apps may not offer Claude.ai login or route requests through Free, Pro or Max credentials; use API keys (#30).
- [Anthropic Consumer Terms](https://www.anthropic.com/legal/consumer-terms): automated access only through an API key or where explicitly permitted (#30).
- [OpenAI Chat Completions API](https://developers.openai.com/api/reference/resources/chat): the de facto OpenAI compatible format (#5).
- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages): the second API style (#20).
- [Ollama OpenAI compatibility](https://docs.ollama.com/openai): local models through an OpenAI compatible base URL (#5, #19).
- [OpenRouter quickstart](https://openrouter.ai/docs/quickstart): one key, hundreds of models, OpenAI style client (#5, #19).
- [Gemini API OpenAI compatibility](https://aistudio.google.com/docs/openai): Gemini reachable through the OpenAI compatible format before a native adapter (#19, #31).
- [Model Context Protocol specification](https://modelcontextprotocol.io/specification): hosts must get explicit user consent before invoking a tool (#36).
- [gitignore](https://git-scm.com/docs/gitignore): ignore pattern format and precedence (#11).
- [Apple Keychain Services](https://developer.apple.com/documentation/security/keychain-services): macOS credential store (#18; only the page's existence was confirmed).
- [freedesktop Secret Service API](https://specifications.freedesktop.org/secret-service/latest/): Linux credential store (#18; still a draft spec).
- [RFC 8252, OAuth 2.0 for Native Apps](https://www.rfc-editor.org/rfc/rfc8252) and [RFC 7636, PKCE](https://www.rfc-editor.org/rfc/rfc7636): system browser sign in with loopback redirect and PKCE (#30).
- [The Pragmatic Programmer, 20th Anniversary Edition](https://pragprog.com/titles/tpp20/the-pragmatic-programmer-20th-anniversary-edition/): source of tracer bullets (book page only).
- [Alistair Cockburn](https://alistaircockburn.com/Bio): walking skeleton, "a thinly connected functioning architecture".
- [SWE-bench evaluation guide](https://www.swebench.com/SWE-bench/guides/evaluation/) and [paper](https://arxiv.org/abs/2310.06770): coding agents graded by running the repository's tests (#27).
