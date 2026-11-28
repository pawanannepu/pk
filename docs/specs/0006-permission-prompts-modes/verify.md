# Verify: permission prompts & modes · spec 0006 · updated 2026-11-28
_Steps derived from spec 0006 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [x] Run `pk` with no flags → footer shows `■ normal` and the hint `shift+tab mode` → AC-10
- [x] Press Shift+Tab three times → footer and the SESSION rail read `accept_edits`, `plan`, then `normal` again; `skip_all` never appears → AC-10
- [x] Run `pk --mode plan` → footer reads `plan` from the first frame → AC-7, AC-8
- [x] Run `pk --dangerously-skip-permissions` → a red `▲ skip all: every tool runs without asking` line shows above the input under the hero, the footer marker is red `skip_all`, and the header warning count is 1 → AC-11
- [x] In that session, Shift+Tab through a whole lap → each entry into `skip_all` adds one more red line, and the lines stay after you leave → AC-10, AC-11
- [x] Put `{ "permissions": { "mode": "skip_all" } }` in your user `settings.json` and start `pk` → it starts in `normal`, with the amber warning `permissions.mode "skip_all" in your settings is ignored…` → AC-7
- [x] Put `{ "permissions": { "mode": "plan" } }` in your user settings → pk starts in `plan`; the same line in a project `.pk/settings.json` changes nothing (user only) → AC-7, value sourcing (`settings.permissions.mode`)
- [x] `pk __tui-demo`, turn 2: the panel shows `[y] allow once  [a] this session  [n] deny  [e] deny and explain`; within 300 ms every key and Shift+Tab is ignored → AC-6, AC-10
- [x] Press `e` → the keys become `note › ` and a dim `enter send · esc back`; the panel does not move. Type `y a n` → typed as text, nothing answered. Esc → keys come back, nothing sent → AC-6
- [x] `e`, type `  use the fixture  `, Enter → the tool line shows dim `denied` and the call is not counted in the header error count → AC-4, AC-6, AC-12
- [x] Narrow the terminal until the panel's inner width is under the keys row → the keys wrap onto the second row and the panel keeps its height → AC-6
- [x] An `execute` kind prompt (bash in the demo) reads `[a] this command` → AC-6, value sourcing (`permission_request.kind`)
- [x] With the note field open, press Ctrl+C → pk quits as usual; on interrupt (from #15 on) the field and panel close and the note is dropped → AC-6, AC-14

## Commands
- [x] `bun test packages/permissions` → all 16 table cells pass, each with and without a session allow; plan plus a session allow still blocks → AC-1
- [x] `bun test packages/tools` → `[a]` keys: a write tool keys by name, an execute tool by `<name>:<exact command>` untrimmed; a parse failure gives the `\u0000invalid` key; the three `@ts-expect-error` checks hold → AC-2
- [x] `bun test packages/agent/src/modes.test.ts` → plan block result with `durationMs: 0` and no prompt, plain deny gives `denied by user` then `not run…` for every later call and `turn_end denied`, a whitespace note acts as plain deny, live `setMode` runs, blocks or keeps waiting, interrupt beats `setMode` → AC-3, AC-4, AC-5, AC-9, AC-14
- [x] Same file → `[a]` on `ls` lets `ls` run again with no prompt while `ls -la` asks (exact key, value sourcing `tool.permissionKey(validated.input)`) → AC-2
- [x] Same file → a plain deny on the last allowed model call (`maxTurns: 1`) ends `denied`, not `turn_limit` → AC-5
- [x] Same file → start notices are the first events (`seq` 0, before `turn_start`); `skip_all` without `skipAllAvailable` throws `agent.invalid_mode` → AC-8
- [x] Same file → switching to `accept_edits` while a write waits emits `mode_change` then the `allowed by accept edits mode` notice, and a late `respond` is ignored → AC-9, value sourcing (mode allow trace)
- [x] `bun test packages/permissions/src/start-mode.test.ts` → every `resolveStartMode` branch, including the ignored `skip_all` setting with its code and text → AC-7
- [x] `bun test packages/tui` → Shift+Tab cycles three modes (four with the flag), two fast presses step two modes (from the session getter, not HUD state), ignored in the guard and with the note open; the note field sends trimmed, empty is a plain deny, pasted newlines become spaces → AC-6, AC-10
- [x] Same → `denied`, `blocked` and `not run` outcomes from `classifyResultText` are dim and not counted; `turn_end denied` adds `stopped: you denied a tool call`; `tool_run_start` or `tool_result` for the pending call drops its panel → AC-9, AC-12
- [x] `bun test packages/schema` → `mode_change` parses with a mode and is not saved as a session record; `TurnEndReason` has `denied`; `classifyResultText` matches by prefix and equality → AC-13
- [x] `bun test packages/cli` → `--mode yolo` and `--mode skip_all` exit 2; `--mode plan --dangerously-skip-permissions` exits 2 with the exact message, with and without a terminal; `__tui-demo` and `__tui-smoke` refuse both flags → AC-7
- [x] `bun run test:e2e` → the five AC-15 checks pass on the compiled binary (`--mode plan` footer then Shift+Tab to `normal`, the red skip all line and red marker, the clash exit 2, the ignored setting) → AC-15
- [x] `bun run check` → passes → AC-13 (every exhaustive switch handles the new members)

## Acceptance-criteria coverage
- AC-1 decide table: permissions tests · AC-2 session keys: tools tests, agent `[a]` on a command · AC-3 plan block: agent plan tests · AC-4 note deny: agent note test, panel Enter · AC-5 plain deny: agent plain deny tests · AC-6 panel keys and note field: tui modes tests, manual panel steps · AC-7 start mode: start-mode tests, cli tests, settings steps · AC-8 session owns mode: agent start notice and invalid mode tests · AC-9 setMode: agent live switch tests, reducer panel drop · AC-10 Shift+Tab: tui modes tests, footer steps · AC-11 skip all line: tui and reducer tests, skip all steps · AC-12 outcomes: reducer outcome tests · AC-13 schema: schema tests, `bun run check` · AC-14 interrupt wins: agent interrupt test · AC-15 binary: `test:e2e`
