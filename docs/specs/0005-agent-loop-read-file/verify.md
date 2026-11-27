# Verify: Agent loop and read file tool · spec 0005 · updated 2026-11-27
_Steps derived from spec 0005 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

Everything here runs offline on the scripted fake provider. The live steps are optional and need your own key (or a local Ollama).

## Automated
- [x] `bun run check` passes, including `bun run boundaries` with `zod` allowed in `tools` and not in `agent` → all ACs
- [x] `bun run test:e2e` → in a PTY, `pk` in a temp project with `PK_FAKE_SCRIPT` shows the `read_file` line for the fixture and the streamed answer, and Ctrl+C exits 130 with the terminal restored after the session closes → AC-1, AC-16
- [x] `bun test packages/agent` → the happy path event order matches AC-2 exactly, `seq` rises from 0 across two turns, and `checkConversation` returns `[]` at every `turn_end` → AC-2
- [x] `bun test packages/agent` → `maxTurns: 3` with an always calling script gives exactly 3 stream calls and `turn_end turn_limit` with no notice; a scripted retry does not count; with no setting, 50 → AC-3
- [x] `bun test packages/agent` → one reply with an unknown tool, an `inputError`, a schema failure, a `ToolError` and a plain `Error` gives five error results with the AC-4 texts, a `tool_run_start` only for the two that ran, and the next model call happens; a 3,000 character error text is cut to 2,000 with `…` → AC-2, AC-4
- [x] `bun test packages/agent` → two submits while running give two more turns in order; whitespace and post `close()` submits give no turn → AC-5
- [x] `bun test packages/agent` → interrupt mid stream, mid permission wait and mid tool run each end `interrupted` with the synthetic texts, an empty aborted reply is dropped, and queued prompts are cleared with the notice; a tool resolving after the abort has its outcome and stamps thrown away; `submit` then `interrupt` in one tick gives `turn_start`, the prompt `message` and `turn_end interrupted` with no stream call; `close()` resolves with no reader draining → AC-6, AC-14
- [x] `bun test packages/agent` → `rate_limited`, `rate_limited`, `server` gives two `provider.retrying` notices and `turn_end error provider.server` with the partial reply dropped, and a `tool_result` for each orphan call, and the next prompt completes; a plain `Error` from a stub provider gives `agent.internal` with the fixed text, never the raw message → AC-2, AC-7
- [x] `bun test packages/agent` → `max_tokens` with text only gives `agent.output_cut` and `done`; `refusal` with text gives `done`; a reply with no blocks gives `agent.empty_reply` and no assistant message in history; `end_turn` with a call still runs it → AC-8
- [x] `bun test packages/agent` → a `usage` with `providerCostMicroUsd: 1200` gives `cost { source: "provider", microUsd: 1200 }`, and one without gives `{ source: "unknown" }` → AC-9
- [x] `bun test packages/agent packages/permissions` → a test write tool asks; `allow_session` makes the second call run with no prompt; `deny` with a note gives `denied by user (note: …)`; a stale or late `requestId` is ignored; a write tool with invalid input never prompts → AC-4, AC-10
- [x] `bun test packages/tui` → a result `denied by user (note: x)` reduces to a denied tool, not counted in `errors`; `provider.missing_key` shows its hint → AC-10, AC-16
- [x] `bun test packages/tools` → `cat -n` output, the default window of 2,000, a 2,500 character line cut with the marker (an emoji at the cut is never split), the 100 KB cap ending on a whole line with the footer, the footer with the right next `offset`, an empty file with `offset: 5`, BOM, CRLF and invalid UTF-8 → AC-11
- [x] `bun test packages/tools` → `../x`, an absolute path outside, and a symlink out of the root are all refused with the outside text; the `..` refusal never calls `fs`; a root under `/tmp` (real path `/private/tmp`) accepts both absolute forms; a missing file inside the root gives "does not exist", not "outside" → AC-12
- [x] `bun test packages/tools` → a fake `FileSystem` gives the not found, directory, not a regular file (no `readFile` call), access denied, too large (`stat` size 10,485,761, no `readFile` call), binary and offset past end texts → AC-13
- [x] `bun test packages/agent` → two reads of one file leave one ledger entry with the second stamp; a failed read leaves the ledger unchanged → AC-14
- [x] `bun test packages/agent` → the request's `system` equals `placeholderSystemPrompt` for the root, date and tool names, and `maxOutputTokens` is absent → AC-15
- [x] `bun test packages/cli` → with no `model.main`, `pk` prints `pk: No model set…` and exits 1 before the screen; the same for an unknown provider and an invalid `PK_FAKE_SCRIPT`; the screen's `info.mode` is `normal` even with `permissions.mode: "plan"` → AC-16

## Live (optional)
- [ ] With `OPENAI_API_KEY` set and `model.main` set to a real model, run `pk` in this repo and ask "what does packages/provider/src/retry.ts export?" → a `read_file` call on that path, `r` in the FILES rail, and a correct streamed answer → AC-1, AC-11
- [ ] Same, and ask it to read `/etc/hosts` (an absolute path, since `~` is not expanded) → an error result saying it is outside the project, and the model explains → AC-12
- [ ] Unset `OPENAI_API_KEY` and run `pk` → the screen opens; the first prompt ends with the `provider.missing_key` error block and its hint → AC-16
- [ ] Point at a local Ollama and ask a multi file question → several `read_file` calls in a row, each line shown, the answer streams → AC-1, AC-2

## Value sourcing
- [x] Set `limits.maxTurns: 2` in user settings → the third model call never happens → `maxTurns` source
- [x] Start `pk` in a subfolder of the repo → the system prompt and the FILES rail use the repo root, and `read_file` with a root relative path works → `projectRoot` source
- [x] Check the request in a test across a fake clock set to 23:59 local → `today` is the local date, not the UTC date → `today` source
- [x] A fake script reply with a reasoning replay → the stored reasoning block carries `api: "openai_chat"` from the provider and the session's model → replay source
