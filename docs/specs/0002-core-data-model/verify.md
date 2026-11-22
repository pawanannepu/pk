# Verify: Core data model · spec 0002 · updated 2026-11-22
_Steps derived from spec 0002 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## Commands
- [x] `bun run check` → lint, typecheck, boundaries, `schemas --check` and every test pass → AC-17
- [x] `bun run boundaries` → passes with `@pk/schema` depending on `zod` (exact `4.6.7`) and `@pk/env` on `@pk/schema` → AC-17
- [x] `bun test packages/schema/src/exports.test.ts` → every schema named in AC-1 is exported as a Zod schema, and every export has a doc comment → AC-1
- [x] `bun test packages/schema/src/conversation.test.ts` → the every block fixture (text, image, reasoning with replay, two parallel calls, an error result with `details`) parses and passes `checkConversation` → AC-1
- [x] Add a property `finish_reason` to any exported schema and run `bun test packages/schema/src/exports.test.ts` → the vendor guard fails naming it; remove it again → AC-2
- [x] `bun test packages/schema/src/conversation.test.ts` → each issue code is reported, a pending tail and same role neighbours are valid, and repair output always passes `checkConversation` → AC-3
- [x] `ModelRefInput.parse("openrouter/anthropic/claude-x")` → `{ provider: "openrouter", model: "anthropic/claude-x" }`; `""`, `"gpt-x"` and `"Open AI/x"` are rejected with a message naming the rule → AC-4
- [x] `sumCosts([{ source: "catalog", microUsd: 1500 }, { source: "unknown" }])` → `{ knownMicroUsd: 1500, unknownCalls: 1 }`; `{ source: "unknown", microUsd: 0 }` is rejected → AC-5
- [x] Delete one `case` from `label()` in `packages/schema/src/events.test.ts`, then `bun run typecheck` → fails on the `never` line; restore it → AC-6
- [x] `bun test packages/schema/src/provider.test.ts` → a well formed stream has no issues, and the bad stream reports every `StreamIssue` code at the right index → AC-7
- [x] `bun test packages/env/src/session-file.test.ts` → the committed `fixtures/session-v1.jsonl` parses and folds; the damaged file gives `skipped: 3` and a repaired context; `v: 2` throws `session.too_new` → AC-8
- [x] `bun test packages/env/src/tracer.test.ts` → messages written as `message` records with `PRIVATE_FILE` read back and fold to the same messages, file mode `0600` → AC-8, AC-14, AC-16
- [x] `bun test packages/schema/src/stored.test.ts` → images (including inside tool results) become blob references and round trip; a missing blob reads `[image unavailable]` and is listed once → AC-9
- [x] `bun test packages/env/src/session-file.test.ts` → `CostRecord` and `HistoryEntry` lines with `v: 1` read, others skipped and counted → AC-10
- [x] `bun test packages/schema/src/settings.test.ts` → an unknown key is a warning, a wrong type is an error, and `"apiKey": "sk-live-abc"` gives the fixed message with no value in it → AC-11
- [x] `bun test packages/env/src/settings.test.ts` → the layer order, the hostile project file (three `user_only_key` warnings, user provider kept, deny rules applied), the broken project file and `skipProject`, and the home root case all behave as specced → AC-12
- [x] `bun test packages/env/src/project.test.ts` → `~/code/app/src/deep` with `.git` in `~/code/app` gives `~/code/app`; `~` gives `~` even with `~/.pk`; `/Users/ab` is not inside `/Users/a`; same named folders get different keys → AC-13
- [x] `bun test packages/env/src/ids.test.ts` → IDs match `<prefix>_[0-9A-HJKMNP-TV-Z]{26}`, sort in creation order across prefixes, survive a backward clock, and overflow throws `id.overflow` → AC-14
- [x] `bun run schemas --check` → up to date; change a `Settings` description and run it again → exits 1 as stale; `bun run schemas` regenerates → AC-15
- [x] `stat -f %Lp` (macOS) or `stat -c %a` (Linux) on a file and folder written with `PRIVATE_FILE` → `600` and `700`; an existing `0755` folder passed to `ensurePrivateDir` becomes `700` → AC-16

## UI / manual
- [x] `bun run dev -- --help` → lists `--no-project-settings` → AC-12

## Value sourcing
- [x] IDs: build a factory with a fixed `now` and `randomBytes`, and check the time part changes only with the clock and the random part only within one millisecond → `newId` from `createIdFactory`
- [x] `at`: every record and event `at` parses as `Timestamp` (UTC with milliseconds); an offset time like `+01:00` is rejected → the injected clock
- [x] `agentId`: a fold over records with an `agent_…` ID ignores them; `main` records are kept → `MAIN_AGENT_ID`
- [x] Repair message: an inserted user message has the assistant message's `at` and the ID from `newId("msg")` → repair sourcing
- [x] Synthetic result text is exactly `REPAIRED_RESULT_TEXT` → the constant in `schema`
- [x] `Cost` source: `provider` and `catalog` need `microUsd`, `unknown` has none, and sums never count `unknown` as zero → `Cost` rules
- [x] `projectRoot` and `projectKey`: run from a deep subfolder, from home, and from outside home (`/srv/...`) → `findProjectRoot`, then `projectKey(projectRoot)`
- [x] Cost file month: a record at `2026-11-30T23:59:59.999Z` belongs to `2026-11`, even in a local timezone already in December (`TZ=Asia/Tokyo`) → the UTC month of `at` (writer arrives in #22)
- [x] Blob name: the blob `sha256` is the hash of the decoded bytes, not of the base64 text → `toStoredMessage` with `sha256Hex`
- [x] Settings paths: the user file is `join(paths().config, "settings.json")` under `PK_HOME`, macOS and Linux XDG; the project files are `<projectRoot>/.pk/settings.json` and `.pk/settings.local.json` → `paths()` and `projectRoot`
- [x] Flags layer: a bad flag value fails with file `flags` → the flags layer
- [x] Missing image text is exactly `[image unavailable]` → `IMAGE_UNAVAILABLE_TEXT`

## Acceptance-criteria coverage
- AC-1 exports and fixture · AC-2 vendor guard · AC-3 check and repair · AC-4 model refs · AC-5 costs · AC-6 exhaustive switch · AC-7 stream order · AC-8 session files, tracer · AC-9 blobs · AC-10 cost and history lines · AC-11 settings schema · AC-12 settings load, `--help` · AC-13 project root and key · AC-14 IDs, tracer · AC-15 published schema · AC-16 private files, tracer · AC-17 `bun run check`, boundaries
