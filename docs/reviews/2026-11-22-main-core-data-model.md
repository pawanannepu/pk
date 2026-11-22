# Review, main (core data model, spec 0002), 2026-11-22

**Reviewed by**: Claude Sonnet 5.5 (author model not recorded)
**Scope**: 14 tracked files changed plus about 45 new files (uncommitted, working on main)
**Verdict**: Approve with nits

## Summary
This change adds pk's shared data model. `@pk/schema` now holds the Zod shapes for messages, events, provider streams, session records and settings, along with pure helpers such as check and repair of a conversation, the stream order check, the fold of session records and the stored image form. `@pk/env` adds ID minting, safe JSONL and session reading, layered settings with user only keys, project root detection and private file writes. The work follows the spec closely, the trust rules for project settings hold up when I tried a hostile project file by hand, and the code is clean and well tested. I found no blockers and no majors. The findings are small edge cases and a few places where the code has drifted from what the spec says.

## Minor

### 🟡 Subagent `todo` and `model_change` records would be read as the main agent's, `packages/schema/src/session.ts:176`
**Problem**: `TodoRecord` and `ModelChangeRecord` carry no `agentId`, and `sessionRecordFromEvent` drops the event's `agentId` when it builds them. `isMainAgent` (line 250) then treats every record without an `agentId` as the main agent's. Once #38 emits `todo_update` and `model_change` events with an `agent_` id, those events will be saved without any mark of who sent them. On resume, a subagent's to do list or model switch would overwrite the main agent's.
**Why it matters**: The spec says the fold uses only records whose `agentId` is `main`. Today that is only true for message, usage and turn_end records. Nothing breaks yet, but the saved file format will have to change later, and then old files are ambiguous.
**Suggested fix**: Either make `sessionRecordFromEvent` return `undefined` for these two events when `agentId` is not `main` (a cheap guard now), or add an optional `agentId` to both records now while the format is still at `v: 1` with no real files. Add a test for whichever is chosen.

### 🟡 A migration that throws escapes the "never throws" promise, `packages/env/src/jsonl.ts:28` and `packages/env/src/session-file.ts:84`
**Problem**: `readJsonlRecords` is documented as never throwing, but it calls `upgrade(raw)` outside any try block. A migration function in `SESSION_MIGRATIONS` receives untrusted raw data (typed `unknown`), so a bug in one, or a hostile line, makes it throw a plain error out of the reader and abort the whole read. The same applies to `migrate(header, header)` on the header in `readSessionFile`, which would surface as a bare `Error`, against the "never throw a plain Error" rule.
**Why it matters**: One damaged line is supposed to cost one record, not the session. The table is empty at `v: 1`, so this only bites at the first real migration, when it is easy to forget.
**Suggested fix**: Wrap the per line `upgrade` call so a throw counts the line as skipped, and wrap the header migration so a throw becomes a `SessionError` (for example `session.no_header` or a new code). Add one test with a throwing migration.

### 🟡 The spec and the code disagree on a few public shapes, `packages/schema/src/session.ts:228` and `packages/env/src/session-file.ts:78`
**Problem**: `foldSessionRecords` takes `{ newId, blobs }` and `SessionState` has `missingBlobs`, but spec AC-8 and the API table say `{ newId }` and list no `missingBlobs`. `readSessionFile` can also throw `session.unsupported_version`, which is not in the spec's list of new error codes. `readJsonlRecords` has a third `upgrade` parameter, and `readSessionFile` has a `versioning` parameter that the spec does not show. The additions are sensible (images cannot be restored without blobs), but the governing document is now wrong.
**Why it matters**: #24 and #26 will be built from the spec, and they will call `foldSessionRecords` with the documented arguments.
**Suggested fix**: Update spec 0002 (through /architect) to match the code: the `blobs` option, `missingBlobs`, the extra error code and the optional parameters.

### 🟡 Key names from untrusted files reach warnings unchanged, `packages/schema/src/settings.ts:294`
**Problem**: `parseSettingsLayer` builds the warning `unknown key "<path>"` from the raw key text. Keys come from a project settings file, which is untrusted. A key can hold terminal escape characters (I confirmed `"\u001b[2Jevil"` comes back verbatim) or newlines, and `cli` and the TUI will print the warning.
**Why it matters**: A cloned repo could clear or rewrite the terminal when pk starts, or fake extra warning lines. This is the same trust story the spec cares about, only on the display side.
**Suggested fix**: Escape control characters in the key (for example through `JSON.stringify` of the key, or replace anything outside printable characters) when building warning messages and paths. Add a test with an escape character in a key.

### 🟡 Project settings are read with no size limit, `packages/env/src/settings.ts:82`
**Problem**: `readSettingsFile` calls `readFile(path, "utf8")` on whatever is at `<root>/.pk/settings.json`. Git can commit a symlink, so a hostile repo can point that path at a device such as `/dev/zero`, or at a very large file. The read then never ends or fills memory before any parsing happens.
**Why it matters**: Opening pk in an untrusted clone could hang or crash it. The spec names project files as untrusted input.
**Suggested fix**: For project layers, stat the path first and refuse anything that is not a regular file under a small size cap (for example 1 MB), treating it as `settings.unreadable`. Keep the check inside the injected `readFile` or in `readSettingsFile` so tests stay offline.

### 🟡 A few new branches have no test, `packages/env/src/ids.ts:48`, `packages/env/src/settings.ts:164`, `packages/env/src/settings.ts:304`
**Problem**: Coverage shows three untested paths: the `id.overflow` error when the clock is past the ULID time range, the `deprecated_key` warnings inside `loadSettings` (the renames table is empty, so only the schema helper is tested), and the "merged settings are invalid" error in `mergeSettings`. Also the `atomicWriteFile` failure cleanup (`files.ts:65`, `files.ts:87`) is untested.
**Why it matters**: These are error paths. The rename wiring in particular runs user only filtering after renames, which is a security relevant order that nothing exercises through `loadSettings`.
**Suggested fix**: Add a test for the time range overflow, a `loadSettings` test that passes a rename table (or tests the layer pipeline with a rename into a user only key from a project file), and a failure test for the temp file cleanup. The merge error is a "can't happen" guard, so it can stay uncovered with a comment.

## Nits
- ⚪ `packages/env/src/settings.ts:84`, a project root where `.pk` is a regular file makes `readFile` fail with `ENOTDIR`, which becomes `settings.unreadable` and stops pk. It is a plain "missing" case, so treat `ENOTDIR` like `ENOENT`.
- ⚪ `packages/env/src/settings.ts:160`, the `map` callback pushes into the outer `warnings` array. It is local and correct, but the project rules prefer returning values. Returning `{ settings, warnings }` per layer and flattening would match the style used elsewhere.
- ⚪ `packages/env/src/session-file.ts:97`, the record text is rebuilt with `join("\n")` and split again inside `readJsonlRecords`. For big session files that is an extra copy. Passing the lines through (or a start offset) would avoid it.
- ⚪ `packages/env/src/index.ts:42`, `SessionVersioning` is a test only override but is part of the public export list. Consider keeping it internal, or say clearly in its comment that tests are the only users.
- ⚪ `packages/schema/src/stored.ts:113` and `:170`, `Buffer` is a Node global used inside `@pk/schema`, which is meant to depend on `zod` alone. It works on Node and Bun, but a tiny base64 helper would keep the package runtime neutral.
- ⚪ `packages/schema/src/stored.ts:162`, `fromStoredMessage` trusts the bytes in the map. `blob.bytes` is stored but never compared with the real length, and the hash is not rechecked. Cheap to add when the blob reader lands in #24.
- ⚪ `packages/schema/src/session.ts:158`, `sessionRecordFromEvent` returns `undefined` for a `message` event when `stored` is left out. A caller that forgets the argument silently loses every message. A comment or a separate function for messages would make the mistake harder.
- ⚪ `packages/schema/src/settings.ts:294`, the dotted path `a.b` is ambiguous when a key itself contains a dot. Harmless today because only warnings use it.

## Strengths
- The trust model is implemented as designed and holds up when tried. A hostile project file with `providers`, `permissions.mode` and `permissions.allow` loads with exactly three `user_only_key` warnings, the user's `deny` rules survive an empty project `deny`, and user only keys are dropped before validation so a bad value is never echoed back.
- `repairConversation` and `checkConversation` are pure, never mutate their input and agree with each other. The fold repairs with `closePendingTail: true`, so a resumed session always gives the model a valid conversation.
- Error handling follows the project rules: `PkError` subclasses with stable codes, Zod parsing at every file and settings boundary, a literal key message that never contains the value, and exhaustive `switch` with `never` checks.
- `appendJsonl` now guards against a torn last line, `PRIVATE_FILE` and `ensurePrivateDir` give clear private storage building blocks, and the tracer test proves modes on disk end to end.
- The vendor field guard walks every exported schema's JSON Schema, the stale `schemas/settings.schema.json` check is part of `bun run check`, and a committed `v: 1` fixture protects old sessions.

## Test coverage
Coverage for `packages/env` and `packages/schema` is about 98 percent of lines, with 138 passing tests. The tracer test, the damaged file case, the trust cases, the merge rules, torn line appends, the project detection cases, the newer file case and the vendor guard from the spec's critical scenarios are all present. The untested parts are the error paths listed in the last minor finding, plus the throwing migration case, a control character in a settings key, and a project settings file that is not a regular file. Nothing in the new logic is untested at the branching or security level beyond those items.
