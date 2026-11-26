# Verify: Terminal UI foundation · spec 0003 · updated 2026-11-22
_Steps derived from spec 0003 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

The quickest way to see every screen state is the demo: `bun run build`, then `dist/pk-<os>-<arch> __tui-demo` (add `--speed 4` to go faster). Submit three prompts, answer the two permission prompts, and quit with Ctrl+C.

## UI / manual
- [x] Run `pk __tui-demo` in a 140x40 terminal → header shows `◢◣ PK  terminal coding agent`, your project folder with home as `~`, and `◉ ready` on the right; both rails and the turning globe hero show → AC-8, AC-10, AC-16
- [x] Submit a prompt → `┃ ›` message, `∿ thinking` with a spinner then `∿ thought for 2s`, streamed reply, `◆ read_file  src/provider/index.ts  2.0 KB · 0.2s`, a dim `· project root found` notice, then a second reply segment below the tool line → AC-11, AC-12
- [x] Watch the hero → it disappears with the first transcript item; on a fresh start left idle, it stops turning after 60 s → AC-16
- [x] Press Enter twice quickly on a second prompt while turn 1 still runs → nothing is sent twice; the footer shows `turn running`; the text stays in the input → AC-15
- [x] Submit the second prompt → amber `PERMISSION  edit_file wants to write` panel with `1 of 2`, the target, the JSON input and the keys row dim for a moment then bright; the lamp reads `waiting` and blinks → AC-13, AC-8
- [x] Press `y` immediately as the panel appears → ignored; press `y` after a beat → the next panel (`bash wants to run`) shows; press `y` again → a 40 line diff under `edit_file` with `… 12 more lines`, a red `✖ bash  2 tests failed`, an amber `▲ retrying after 429` line, and the header shows `▲ 1` and `◉ 1 err` → AC-12, AC-13, AC-8
- [x] Type a draft before the panel opens, then answer `n` twice in a fresh demo → both calls show `denied by user`, no error count, and the draft is back in the input → AC-13, AC-8
- [x] Submit the third prompt → `✖ grep  interrupted` and a red `ERROR  provider.rate_limited` block with `try: wait a minute, or switch model`; the error count resets to 1 for this turn → AC-14, AC-8
- [x] Submit a fourth prompt → a dim `· demo finished. ctrl+c quits` line → AC-22
- [x] Press Ctrl+B, then F2 → rails hide, then come back; resize the window with rails hidden → they stay hidden → AC-7
- [x] Shrink the window to 99, then 59 columns → right rail goes at 99; at 59 a centered `window too small` notice with both sizes covers the screen and keys other than Ctrl+C do nothing; grow back → draft, scroll position and any open panel are still there → AC-6
- [x] Scroll up with the mouse wheel and PgUp while text streams → the view stays put and a dim `↓ new` appears; press End → it follows again and the marker clears; Home jumps to the top only when the input is empty → AC-17
- [x] Scroll up, then resize → the same line stays at the top of the view → AC-17
- [x] Drag to select reply text → only transcript text highlights (not rails, header or frames); on release the footer shows `copy sent (N chars)` for 2 s and the text is in your clipboard (in a terminal with OSC 52) → AC-18
- [x] Inside tmux with `allow-passthrough off` (the tmux default, or another terminal without OSC 52) → no `copy sent`; the first copy adds one amber notice naming Shift or Option, plus `set -g allow-passthrough on in tmux`; the second copy adds none. Then `tmux set -g allow-passthrough on` with pk still running → the next copy shows `copy sent (N chars)` and the text reaches the outer terminal → AC-18
- [x] Run with `NO_COLOR=1` → same layout, no color, terminal background; diff rows still show `+` and `-` after the line numbers; every tool line still starts with its glyph → AC-4
- [x] Run with `TERM=xterm` and `COLORTERM` unset (a bare PTY works: `bun run test:e2e` does this, or capture the demo's raw output yourself) → amber, green and red go out as palette slots `38;5;3`, `38;5;2` and `38;5;1`, so they come from your terminal palette; no `38;2` or `48;2` code anywhere; the only background code is `49`, so the background is your terminal's own and diff rows are not tinted → AC-3
- [x] Run with `LANG=C` (or `"ui": { "ascii": true }` in your user settings) → only ASCII on screen, the hero included; the hero is the ASCII art `PK` instead of the globe → AC-5
- [x] Put `"ui": { "background": "terminal" }` in your user settings → the canvas is your terminal's background; put it in a project `.pk/settings.json` instead → ignored, with a `user_only_key` warning in the log → AC-21, AC-3
- [x] Let the demo go idle (turn done, no panel, hero stopped) and watch CPU → it drops to zero; nothing animates → AC-19
- [x] 2,000 item scroll check: `bun test packages/tui -t "2,000 item transcript"` → it scrolls 2,000 items through the real shell with PgDn and the wheel, and every frame renders inside the 33 ms budget (95th percentile under 16 ms) → AC-25

## Value sourcing
- [x] Header project folder → start the demo from a folder inside your home, then from one outside it (for example `/tmp`) → `~/...` inside home, the full path outside → info.projectRoot, info.home
- [x] Header branch slot → stays empty (filled by #16) → branch
- [x] Footer mode → `■ normal` in the demo; the marker uses `bracket` (amber for `accept_edits`, red for `skip_all` once #7 changes modes) → info.mode
- [x] Footer and SESSION model → `demo/scripted` → info.model, then `model_change` (main role)
- [x] Footer session tokens → after turn 1 `6.4k tok` (4,100 input + 2,000 cache read + 320 output); after turn 2 `31.9k tok` → sum over `usage` events
- [x] Footer and COST cost → after turn 1 `$0.0012`; after turn 2 `$0.0031 +1 unpriced` (never `$0`); before any priced call the figure is `─` → sumCosts, formatMicroUsd
- [x] COST last turn → `last turn $0.0019` after turn 2, `last turn $0.0000` after turn 3 → usage since the last `turn_start`
- [x] CONTEXT tokens and percent → after turn 2 the gauge shows `7%` of 200,000 and `13.9k tok` (the last call's input plus cache) → last `usage`, info.contextWindow
- [x] CONTEXT without a window → in a session without `contextWindow` (unit test `window unknown`) the row reads `window unknown` and no gauge → info.contextWindow unset
- [x] CONTEXT amber threshold → a session near 80% of the window turns the gauge amber → CONTEXT_WARN_RATIO
- [x] TOKENS sparkline → three bars after turn 2, the last value `140` → outputTokens of the last 14 calls
- [x] PLAN items → after turn 2: `◆` done (dim), a spinner on the in progress item, `◇` pending → todo_update
- [x] FILES paths and counts → `src/provider/index.ts  r` and `src/provider/retry.ts  +3 -1`; with the denied branch only the `r` file shows → ToolDisplayDetails.files
- [x] Tool line name, target, size, duration → `read_file`, `src/provider/index.ts`, `2.0 KB · 0.2s`; while bash runs, `running 0.3s`… counting up → tool_call_start, toolTarget, result bytes, durationMs and the clock
- [x] Tool line target from either source → `edit_file` shows its path before you answer (from the assistant message) → message or permission_request input
- [x] Tool error line → `2 tests failed` (first line only) → first text block when isError
- [x] Diff patch → under `edit_file`, 40 patch lines, then `… 12 more lines` → ToolDisplayDetails.diff
- [x] Reasoning duration → `thought for 2s` (about 2.3 s of reasoning deltas, rounded) → last minus first reasoning_delta `at`
- [x] Permission verb, target and JSON → `edit_file wants to write`, `bash wants to run`; a call input containing a key like `sk-...` shows `[REDACTED]` → ToolKind, toolTarget, redact()
- [x] Permission guard end → a `y` pressed within 300 ms of the panel showing does nothing → PERMISSION_GUARD_MS from the clock
- [x] Error block code, message, hint → `provider.rate_limited`, `OpenAI returned 429 after 3 retries.`, `try: wait a minute, or switch model` → turn_end.error, redact(), ERROR_HINTS
- [x] Color mode depth → vary `NO_COLOR`, `COLORTERM`, `TERM` as in the UI steps above (the `test:e2e` color cases do all three); with `COLORTERM=truecolor` the canvas is `#07080A` (`48;2;7;8;10` in the raw output); with `TERM=xterm` only palette slots → NO_COLOR, renderer capabilities, the env guess, nativeColorTerm
- [x] Glyph set → vary `LC_ALL`, `LC_CTYPE`, `LANG` (for example `LC_ALL=C LANG=en_US.UTF-8` is ASCII) → locale order, ui.ascii
- [x] Canvas background → `ui.background` `pk` paints `48;2;7;8;10`, `terminal` paints no canvas while colors stay; 16 color and `NO_COLOR` write no background code but `49` (the `test:e2e` color cases) → ui.background plus color mode
- [x] Copy support → OSC 52 support from the terminal; inside tmux, `allow-passthrough` asked at each copy (see the tmux step above); outside tmux, `bun test packages/tui -t "outside tmux without OSC 52"` shows the notice without the tmux part and tmux never asked (OpenTUI 0.9.7 does not report `unsupported` for any terminal we could script, so this half runs through the real shell with the capability set) → osc52_support, TMUX, tmuxPassthrough
- [x] Hero land → `bun test packages/tui -t "world map"` and `-t "face you"`: known land points (Sahara, Brazil, Siberia, Australia, Antarctica and more) are land, open ocean points are water, and at turn 0 the globe's center is land (Africa and Europe face you), at 180 it is not; if you like, also look at the hero yourself → LAND_MASK

## Commands
- [x] `bun run check` → lint, typecheck, boundaries, schemas and every test pass → AC-23
- [x] `bun run test:e2e` → `demo: three turns, two prompts answered, the error block` and `demo: Ctrl+C exits 130 with the terminal restored` both `ok`, plus the four color cases (`16 colors`, `truecolor`, `NO_COLOR`, `ui.background "terminal"`) → AC-22, AC-20, AC-3, AC-4
- [x] `echo hi | dist/pk-<os>-<arch>` and `dist/pk-<os>-<arch> __tui-demo > out.txt` → stderr `pk: interactive mode needs a terminal.` then `For scripts and pipes use: pk -p "<prompt>"`, exit code 2, and nothing loads the UI → AC-20
- [x] `TERM=dumb dist/pk-<os>-<arch>` → the same refusal, exit 2 → AC-20
- [x] `bun run schemas --check` → `schemas/settings.schema.json` includes `ui.background` and `ui.ascii` → AC-21
- [x] `bun test packages/tui` (from the repo root, so the Solid preload in `bunfig.toml` applies) → every screen test passes → AC-1 to AC-25

## Acceptance-criteria coverage
- AC-1 design.md and its sync test: `design-doc.test.ts`, check step
- AC-2 contrast and decoration tokens: `theme.test.ts`
- AC-3 color mode and theme: `theme.test.ts` (including `nativeColorTerm`), `plain-output.test.tsx` (16 colors), `scripts/e2e.ts` (color codes on the wire), UI 16 color and background steps
- AC-4 NO_COLOR: `plain-output.test.tsx`, UI NO_COLOR step
- AC-5 ASCII: `glyphs.test.ts`, `plain-output.test.tsx`, `hud.test.tsx` (hero fallback), UI ASCII step
- AC-6 layout and too_small: `layout.test.ts`, `hud.test.tsx` (too_small, width snapshots), UI shrink step
- AC-7 rail toggle and key routing: `hud.test.tsx`, `shell.test.tsx`, UI Ctrl+B step
- AC-8 header lamps and counts: `hud.test.tsx`, `reduce.test.ts`, UI permission and error steps
- AC-9 footer legend: `hud.test.tsx`, `text.test.ts` (formatCost), Value sourcing cost steps
- AC-10 rails: `hud.test.tsx`, `layout.test.ts` (fitting), Value sourcing rail steps
- AC-11 transcript items and segments: `reduce.test.ts`, UI first prompt step
- AC-12 tool lines and diffs: `reduce.test.ts`, `transcript.test.tsx`, `text.test.ts` (cutPatch), UI permission steps
- AC-13 permission panel and guard: `shell.test.tsx`, `transcript.test.tsx`, UI permission steps
- AC-14 error blocks and stream end: `reduce.test.ts`, `transcript.test.tsx`, UI third prompt step
- AC-15 input: `shell.test.tsx`, UI double Enter step
- AC-16 hero and globe: `layout.test.ts` (snapshots, world map points), `hud.test.tsx`, UI hero step
- AC-17 scrolling and resize anchor: `scroll-copy.test.tsx`, UI scroll and resize steps
- AC-18 selection and copy: `scroll-copy.test.tsx`, UI copy steps
- AC-19 idle: `hud.test.tsx`, UI idle step
- AC-20 not a terminal refusal: `program.test.ts`, command steps
- AC-21 schema and settings: `display.test.ts`, `settings.test.ts`, command step
- AC-22 demo and PTY e2e: `script.test.ts`, `scripts/e2e.ts`, command step
- AC-23 the gate: `bun run check`
- AC-24 sanitizing: `text.test.ts`, `transcript.test.tsx`
- AC-25 batching: `store.test.ts`, `scroll-copy.test.tsx` (2,000 item frame budget), UI 2,000 item scroll step
