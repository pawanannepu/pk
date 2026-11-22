# 0002. Rationale: core data model

The decision record for [index.md](index.md). Builds never need this file.

## Context

pk talks to many model providers through two API styles at launch (OpenAI compatible chat and Anthropic Messages), with a third (Gemini) later. Each style has its own idea of roles, tool call IDs, tool results, reasoning, stop reasons and token counts. For example, one style's prompt token count includes cached tokens and the other's does not, and one needs a signed reasoning block sent back while the other has none. Every later feature reads or writes conversation data: the loop (#6), the tools (#8, #9, #11, #12), permissions (#7, #10), sessions (#24), compaction (#25), costs (#22), headless JSON (#26) and pk-bench (#27). Spec 0001 fixes where these shapes live (`@pk/schema`, Zod 4, depending on nothing else) and how data is stored (JSONL through `appendJsonl`, settings JSON through `atomicWriteFile`). It leaves the shapes themselves to this feature.

Several forces pull at once. The data model is the costliest thing to redo, because every package and every saved file depends on it. Saved data outlives the code: a session written today must resume after upgrades, and a crash can tear the last line of any JSONL file. Settings files come from three trust levels, and one of them (a cloned repo's `.pk/` folder) is effectively attacker controlled. A hostile project file that could point a provider's base URL at its own server would receive your API key on the first request. Sessions and costs hold your code and prompts on machines that may be shared. Finally, pk is built by one person in Tracer Bullet slices, so the design must be provable by a thin end to end test long before the loop exists, and must not demand designs for features that are not yet specified.

If nothing is decided now, #5 and #6 would each invent their own message shape around the first vendor they meet. The OpenAI shape would quietly become the internal format, and #20, #24 and #25 would pay for it later with translation layers and session format breaks.

## Options considered

### Option 1: Neutral pk owned model, typed session records, versioned files, guarded settings layers

pk defines its own shapes: two roles with tool results as blocks, its own call IDs, a reasoning block with an opaque replay token, uncached input tokens with separate cache counts, integer micro USD costs with an explicit source, and an event stream with both deltas and completed messages. Sessions are a typed record log (deltas folded away), versioned and migrated on read, with images moved to hash named blobs. Settings merge in four layers, and a schema marked list of user only keys is ignored in project files.

**Pros**:
- Every adapter translates one neutral shape. Switching providers mid session is safe because IDs, reasoning and usage are already neutral.
- Saved files evolve independently of the in memory event union. Old files keep working through the migration table.
- The trust and privacy rules live in the data model itself, not in scattered code.

**Cons**:
- The largest up front design: many schemas exist before anything uses them.
- Each adapter carries two translations plus an ID map.
- pk's model can lag a new vendor capability until someone extends the neutral shape.

### Option 2: Adopt the OpenAI chat format as the internal model

Use the OpenAI Chat Completions message shape (system, user, assistant and `tool` roles, `tool_calls` with provider IDs, `prompt_tokens` and `completion_tokens`) as pk's own format, since most providers already speak it. Only the Anthropic and Gemini adapters translate.

**Pros**:
- The first adapter (#5) translates almost nothing, and the walking skeleton is reached fastest.
- The format is familiar to contributors and well documented.

**Cons**:
- Vendor fields would sit in the loop, the tools and every saved session, which breaks the scope's own "Done when" for #3.
- It has no place for a signed reasoning block, so Anthropic tool use with thinking would need side channels.
- Cached tokens are folded into the prompt count, so exact cache pricing for #20 and #22 needs extra fields grafted on.
- A provider that returns empty or duplicate tool call IDs corrupts history directly.

### Option 3: Slice 1 shapes only, grown feature by feature

Define only what the walking skeleton needs (text, tool call and result, a handful of events, a minimal settings file) and let each later feature add its own shapes when it is designed.

**Pros**:
- The smallest surface today, and no guessing about later features.
- Each shape is designed with full knowledge of the feature that needs it.

**Cons**:
- The session file, cost record and usage shapes would be designed one feature at a time, often after data in the older shape is already saved on users' machines.
- Cross cutting rules (versioning, trust of project files, privacy of state files) have no owner and tend to be skipped.

### Option 4: Event sourcing, persist the raw AgentEvent stream

Keep the neutral message model, but make the session file the raw event stream (every delta included) and rebuild state by replaying it.

**Pros**:
- No mapping between events and records. The persistence tap writes what it sees.
- A perfect audit trail of what the screen showed.

**Cons**:
- Files grow 10 to 100 times larger, because of every token delta.
- Any change to the event union breaks old sessions, which couples the frontend contract to the storage format.
- Resume is slower, and has to deal with partial streams.

## Rationale

Option 1 is chosen because the forces in Context all point at the same two properties: no vendor leakage, and saved data that survives change. Option 2 is the fastest route to the walking skeleton, but it fails the scope's own definition of done for this feature and pushes the costliest rework (session format, cache pricing, reasoning replay) onto #20, #22 and #24, after users already have saved data. Option 3 looks lean, but the shapes it defers are exactly the persisted ones, which are the hardest to change later. Option 4 keeps the neutral model but welds the storage format to the event union, which spec 0001 deliberately keeps free to change as frontends grow.

The extra up front work in Option 1 is bounded. Every shape is a plain Zod schema, the hard behavior (conversation repair, stream order checks, settings merge) is a handful of pure functions, and the Tracer Bullet build plan proves the chain end to end in its first milestone before the rest is thickened. The engineer chose every major call below during the design conversation, and each recommended pick was accepted.

### Calls made in the design conversation

| Call | Chosen | Why | Runner up |
|---|---|---|---|
| Coverage | Full contract now, later features extend | Persisted shapes are the costliest to redo | Slice 1 shapes only |
| Saved data evolution | `v` on each file, migrate on read, never rewrite | Old sessions keep working, and a downgrade never meets a rewritten file | Additive only, no version |
| Invalid settings | Bad values stop pk, unknown keys warn | A dropped deny rule silently widens permissions, while a newer file must still load | Refuse everything invalid |
| Roles | `user` and `assistant`, results as blocks, system as a request field | It maps directly to Anthropic and Gemini, and the OpenAI adapter splits it | A separate `tool` role |
| Reasoning | Neutral block with an opaque replay token tagged by API style | Anthropic needs the signed block back, and switching styles drops foreign tokens safely | Defer to #20 |
| Tool call IDs | pk mints its own | Local servers return bad IDs, and Anthropic restricts the characters | Keep the provider's ID |
| Tool results | Model content plus typed `details` | The TUI needs diffs and exit codes without parsing text | Model content only |
| Token counting | Uncached input, cache read and write separate | One field per price, so cost is a plain sum | Total input with cache as a subset |
| Money | Integer micro USD plus `source` | Exact sums, and unknown is explicit | USD as a float |
| Model reference | Object in data, `provider/model` string accepted at input | Model IDs contain slashes, and saved data stays unambiguous | Always a string |
| Tool kind | `read`, `write`, `execute`, `network` on the definition | Plan mode and auto accept edits become rules over `kind`, and MCP tools get a default | Name list kept in `permissions` |
| Session file | Typed records, deltas folded away | Small files, decoupled from the event union | Raw event stream |
| Session layout | One folder per project key | `--continue` lists one folder, with no shared index to fight over | Flat folder plus index file |
| Event granularity | Deltas plus completed events | The TUI streams, while the tap and headless read completed messages | Deltas only |
| Cost log | One record per model call, monthly files | Sessions, subagents and periods all add up from the same rows | One record per turn |
| Settings layers | User, project, project local, flags | A personal place for project overrides without editing the shared file | User, project, flags |
| Project trust | User only keys ignored in project files: `providers`, `permissions.mode`, `permissions.allow` (widened after the cross check, since an allow rule like `Bash(*)` acts like skip all) | A hostile repo cannot redirect your key or loosen permissions, while project `deny` and `ask` still tighten | A trust prompt per project |
| Broken project file | Still stops pk, with a `--no-project-settings` flag to skip both project files | Skipping a broken file could silently drop a deny rule, and the flag is the escape hatch | Skip the broken file with a warning |
| Array merge | Permission lists concatenate, other arrays replace | A project can never drop a user deny rule | All arrays replace |
| Damaged session lines | Skip, count, warn, repair | One crash never locks you out of a long session | Refuse to resume |
| Images in sessions | Hash named blob files, with the blob form only in saved record schemas (`StoredMessage`), never in `Message` | Small, greppable lines, repeated screenshots stored once, and adapters only ever see base64 | Inline base64 first, blobs later in #24 or #39 |
| State file privacy | `0600` files in `0700` folders | Transcripts hold code and prompts, and machines can be shared | The system default umask |
| Key source | `{ env }` now, `{ keychain: true }` for #18, never a literal | Secrets never live in files, and #18 adds no shape change | Env var name only |
| Provider boundary | `schema` owns request data and stream events, `provider` owns the interface | The main vendor leak surface is designed once, here | Request data only |
| Project root | Nearest `.pk` or `.git` ancestor, never your home folder, else `cwd` | A subfolder run finds the repo's settings and sessions | Always `cwd` |
| ID format | Prefix plus ULID style, time sortable | Readable in logs, sorts by time, valid for every provider, no dependency | UUID v7 |
| Settings version | None. Renames keep working with a warning | You never maintain a version key by hand | A `version` key in settings |
| JSON Schema | Committed `schemas/settings.schema.json`, checked for staleness | Editors get autocomplete during development | Generated at build time only |

### Smaller calls made while writing

| Call | Chosen | Why | Runner up |
|---|---|---|---|
| Errors from `schema` helpers | Helpers never throw. `env` and `agent` raise `PkError` subclasses | `schema` may depend only on `zod`, so it cannot import `PkError` from `env`, and the root rules forbid Result types for errors | Move `PkError` into `schema` |
| ID typing | Zod branded types | Swapping a `CallId` for a `MessageId` becomes a type error | Plain strings |
| Timestamps | ISO 8601 UTC strings with milliseconds | Readable and greppable in JSONL, and they sort as text | Epoch milliseconds |
| Cost file month | UTC month of `at` | The same file name on every machine and time zone | Local month |
| Project key | Readable slug plus 8 hex of the path's SHA 256 | You can find a project's folder by eye, and same named folders never collide | Hash only |
| Home as project root | Never | On macOS `~/.pk` is pk's own data folder, so home would always match | Allow home when it has `.git` |
| Unknown settings keys | Strict parse, then `unrecognized_keys` split out as warnings, stripped and parsed again | Zod 4 strips silently by default, so warnings need the strict pass | A loose object plus a manual key diff |
| Unknown fields in saved records | Stripped (Zod default) | A newer pk's optional fields never break an older one | Strict, which would refuse them |
| Summed costs | `{ knownMicroUsd, unknownCalls }` | Shows what is known and how much is not, never zero for unknown | One `unknown` total if any call is unknown |
| `seq` scope | Per session object, from 0 | Spec 0001 requires it to rise across the stream, and nothing persists it | Per turn |
| API style names | `openai_chat`, `anthropic_messages` | They name a wire format, so one style can serve many vendors | Vendor names (`openai`, `anthropic`) |
| Tool name rule | `^[a-zA-Z0-9_-]{1,64}$` | The strictest common rule across the target APIs, so a name is valid everywhere | Per adapter checks |
| Invalid tool arguments | `input: {}` plus `inputError` | History stays valid JSON for every provider, and the loop can explain the error to the model | Store the raw string as `input` |

### Calls added after the cross check

An independent read of the draft on another model found gaps the builder would otherwise have had to guess. The engineer chose to apply the recommended fix for each. The ones that are real choices:

| Call | Chosen | Why | Runner up |
|---|---|---|---|
| Replay token scope | `replay` carries `api` and `model`, and is sent back only when both match | Signed reasoning is model specific, and one API style serves many models | Match on `api` only |
| Resume across versions | Only a pk of the header's `v` appends, otherwise resume forks to a new file | One file never mixes record versions under one header | Version every record |
| Torn last line | `appendJsonl` starts with `\n` when a file does not end in one | Otherwise the next record glues onto the torn line and is lost too | Repair the file on resume |
| Existing loose folders | `ensurePrivateDir` tightens state folders to `0700` | Mode options only affect new paths, and a `0700` folder protects every file inside it | Change every file's mode |
| Home as a project | Project layers are skipped when the root is home, or a project file is the user file | On macOS `~/.pk/settings.json` is the user file and would load twice as untrusted | Let `findProjectRoot` return no root |
| Pending tool calls | A trailing assistant message with calls is valid, and repair closes it only on request | That is the normal state in the middle of a turn, and resume needs it closed | Always an issue |
| Same role in a row | Allowed in pk data, merged by adapters that need it | Interrupted turns and compaction summaries produce it naturally | Forbid and repair |
| Blob helpers | Pure and synchronous: return blobs to write, take a blob map to read | Keeps `schema` free of I/O and of async callbacks | Injected async `putBlob` and `getBlob` |
| History and cost redaction | `redact()` on every `HistoryEntry` and `CostRecord` write | Pasted input can hold secrets, and spec 0001 requires secrets absent from saved files | Rely on the session tap only |
