# 0003. Terminal UI foundation: a monochrome HUD with signal colors

**Date**: 2026-11-22
**Status**: In Progress

## Summary

pk's full screen terminal UI gets one visual language, modelled on a dark "HUD" dashboard (a heads up display, like an instrument panel). It uses a near black canvas with white and grey linework, panels framed only at their corners, and just three signal colors: amber for "running or needs you", green for "done or added", red for "failed or removed". The conversation sits in the middle. Two side rails show session state and activity, and they drop away as the window narrows. This feature writes the design down in `docs/design.md`, builds the theme, the reusable pieces and the live screen shell, and proves the whole thing in the real binary with a scripted demo, so the later features (#6, #7, #13, #14, #15, #23) only fill in content. A terminal without color, without Unicode, or narrower than usual still gets a correct screen. A stdout that is not a terminal is refused with a pointer to `pk -p`.

## Requirements

**User stories**:
- As a pk user, I want a calm, distinctive screen where the conversation is the hero and the agent's state is visible at a glance, so that I always know what pk is doing and what it costs.
- As a pk user, I want a clear, hard to miss prompt whenever pk needs my permission, so that nothing runs unasked and I can decide without losing context.
- As a pk user on `NO_COLOR`, a 16 color terminal, a non UTF-8 locale or a narrow window, I want the screen to stay correct and readable, so that no meaning lives only in color or in a glyph my terminal cannot draw.
- As a pk contributor building a later feature, I want named tokens, glyphs and primitives plus a written design, so that my part looks like the rest without inventing a style.

**Acceptance criteria**:
- **AC-1**: `docs/design.md` exists and covers every section of *Design language* below: palette tokens, glyphs, layout and widths, frames and titles, header, footer, rails, hero, every transcript item (your message, reply, reasoning, tool call, diff, permission panel, error, notice), the input, motion, and the plain output rules. A test (`design-doc.test.ts`) reads the token table and the glyph table in `docs/design.md`, taking every backticked name in each row's first cell (so `` `cornerTL` `cornerTR` `` gives two names). It fails if any token name is missing from `theme.ts` or any glyph name from `glyphs.ts`, or if any name in those files is missing from the doc.
- **AC-2**: `theme.ts` defines the tokens with the exact hex values and 16 color treatment in *Palette*. A test computes WCAG contrast (the standard formula for how readable text is against its background) against `canvas`: `text` is at least 7:1, while `textDim`, `amber`, `green` and `red` are each at least 4.5:1, and `bracket` is at least 3:1 (the WCAG level for non text graphics). `textFaint` and `line` are used only for decoration (ticks, rules, separators), never for words, and a test asserts no text primitive accepts them.
- **AC-3**: `resolveColorMode({ env, capabilities })` returns `"none"` when `NO_COLOR` is set to a non empty value. Otherwise, when `capabilities` is known, it returns `"truecolor"` if `rgb` is true, `"256"` if `ansi256` is true, else `"16"`. Before OpenTUI's first capability report (`capabilities` is `null`) it guesses from the environment: `COLORTERM` of `truecolor` or `24bit` gives `"truecolor"`, a `TERM` containing `256color` gives `"256"`, anything else `"16"`. The shell repaints on each `capabilities` event that changes the mode. `resolveTheme(mode, background)` returns a `Style` per token, `{ fg?: RGBA, bg?: RGBA, bold?: boolean, dim?: boolean, inverse?: boolean }`: `fromHex` colors for `truecolor` and `256` (OpenTUI approximates on 256 color terminals), the *Palette* 16 color treatment for `16`, and for `none` the terminal default intents plus the attribute in the *Palette* "No color" column. The canvas is the terminal default background when `ui.background` is `"terminal"` or the mode is `16` or `none`. OpenTUI 0.9.7 writes an indexed color as `38;5;N` only when `TERM` names 256 colors, and as the slot's fixed RGB value otherwise. So when the environment guess is `16`, `startTui` hands the native layer `TERM=<TERM>-256color` (`nativeColorTerm`; `xterm-256color` when `TERM` is empty), and the `ansi256` it then reports is dropped (`terminalColorCapabilities`), leaving the mode at `16` unless the terminal itself reports `rgb`. Slots 0 to 15 then reach the terminal as `38;5;N`, its own palette. Unit tests cover each branch, including the `null` capabilities guess. A `test:e2e` case plays the demo with `TERM=xterm` and no `COLORTERM` and asserts that no `38;2` or `48;2` code is written, that amber, green and red go out as `38;5;3`, `38;5;2` and `38;5;1`, and that no background code but `49` appears. Further cases assert the `48;2;7;8;10` canvas with `COLORTERM=truecolor`, no colors with `NO_COLOR`, and no canvas with `ui.background` `"terminal"`.
- **AC-4**: With `NO_COLOR` set, an in memory render of the demo's full transcript (every item kind the script produces) emits no color: every cell's foreground and background intent is `"default"`. Every color prop handed to OpenTUI components, including all of `Diff`'s colors, comes from the theme, so no component default leaks a color. Bold, dim and inverse may still appear. Every changed diff row still shows its `+` or `-` sign column (after the line numbers), and every tool line still starts with its status glyph.
- **AC-5**: `glyphSet({ LC_ALL, LC_CTYPE, LANG }, ascii)` returns the Unicode set unless `ascii` is true, or the first non empty value of `LC_ALL`, `LC_CTYPE`, `LANG` (in that order) does not contain `UTF-8` or `utf8` (case insensitive). When all three are empty or unset, it counts as not UTF-8. The two sets have the same keys, and a test asserts every ASCII glyph is printable ASCII (0x20 to 0x7E). In ASCII mode an in memory render of the demo contains only printable ASCII, and the hero shows the ASCII art wordmark (`ASCII_WORDMARK`, printable ASCII only) instead of the globe.
- **AC-6**: `layoutFor({ width, height, railsHidden })` is pure and returns which regions show and their widths: both rails (24 columns each, one gap column between each rail and the center) at width 140 or more, the right rail only from 100 to 139, no rails below 100, and the `too_small` layout below 60 columns or 16 rows. `railsHidden` removes both rails at any width. Boundary tests at widths 59, 60, 99, 100, 139 and 140, and heights 15 and 16. In `too_small` a centered notice with the current and minimum sizes is drawn over the screen. The screen tree stays mounted underneath, so the session keeps consuming events, and scroll position, the draft and any open permission request survive when the window grows. While `too_small` shows, every key except Ctrl+C and Ctrl+Z is ignored.
- **AC-7**: Ctrl+B and F2 both toggle `railsHidden` (F2 because tmux takes Ctrl+B as its prefix by default). The toggle survives resizes. Focus stays on the input except while a permission panel is open (AC-13). The shell takes only these keys before the input sees them: Ctrl+B, F2, Ctrl+C, Ctrl+Z, the scroll keys (AC-17), Enter (AC-15), and the permission keys while a panel is open (AC-13).
- **AC-8**: The header shows the wordmark and the dim subtitle `terminal coding agent`, the project folder (your home folder shown as `~`), an empty branch slot (filled by #16), and on the right:
  - The status lamp: a `◉` followed by its word. It reads `ready` in `textDim` when idle and `working` in `text` while a turn runs. While a permission request is open it reads `waiting`, and the glyph and word swap between `amber` and `textDim` once a second.
  - An amber `▲ n` warning count when n > 0. This is a session total that never resets.
  - A red `◉ n err` count when n > 0, counting `failed` tool calls and error turn ends since the last `turn_start`, which resets it. A call denied by you and a call cut off by `turn_end` do not count.
- **AC-9**: The footer is a legend strip of `■` markers followed by values: permission mode, model (`provider/model`), session tokens, session cost. Mode marker color: `normal` and `plan` use `bracket`, `accept_edits` uses amber, `skip_all` uses red. On the right are hints only for keys that work today (`ctrl+b/f2 rails · ctrl+c quit`). Later features add their own hints through a `hints` list in `TuiOptions`. Values follow *Value sourcing*. An unpriced call shows as `+1 unpriced` after the dollar figure, never as $0, and when every call so far is unpriced the figure is `—` (`— +2 unpriced`).
- **AC-10**: The left rail shows SESSION, CONTEXT, PLAN and FILES. The right rail shows ACTIVITY, TOKENS and COST. Rail panels show their title only (no subtitle), with sizes, row limits and empty states as in *Rails*. They fill from the event stream through the pure `reduceHud` reducer. When a rail is too short, whole panels drop from the bottom up (FILES, then PLAN on the left; COST, then TOKENS on the right). A panel is drawn only if it fits its title row plus at least one content row. ACTIVITY takes the remaining height and shows the newest calls first.
- **AC-11**: Transcript items render as in *Transcript items*:
  - Your message gets a bold `›` and a `┃` bar.
  - Reply text is plain wrapped text (markdown is #14).
  - Reasoning folds to one dim line: `∿ thinking` with a spinner while streaming, `∿ thought for Ns` after.
  - Info notices are a dim `·` line. Warning notices are an amber `▲` line, and they also raise the header warning count.

  One assistant message can make several transcript items: a reply or reasoning segment ends when any other item (a tool line, a notice) is added after it, and the next delta of that kind starts a new segment, keyed `<messageId>:<n>`. The assistant `message` event adds text only for a message that had no `text_delta` at all (shown as one segment). Otherwise it is used only for tool call inputs.
- **AC-12**: A tool call is one line: status glyph, tool name in bold, target dimmed and truncated in the middle, and on the right the result size and duration, or the elapsed time while running.
  - **States**: pending `◇` dim (from `tool_call_start`), running spinner amber (from `tool_run_start`), done `◆` green, failed `✖` red with the first line of the error text in place of the size.
  - **Target**: taken from the first of the assistant `message` event or `permission_request.call` that carries the call's input. It shows blank until then.
  - **Unknown call**: a `tool_run_start` or `tool_result` for an unknown `callId` creates the line on the spot with the name `tool`, so no result is lost.
  - **Diff**: a tool result whose `details` parses as `ToolDisplayDetails` with a `diff` renders that diff under the line. It uses OpenTUI `Diff` in unified view with line numbers and no syntax highlighting (no `filetype`; highlighting is #14). Rows are tinted (`addBg`, `removeBg`) in `truecolor` and `256`, shown as colored text only in `16`, and as sign columns only in `none`.
  - **Diff length**: the patch text is cut before it reaches `Diff`. It keeps the file headers, then at most 40 patch lines (context, added and removed lines; `@@` hunk headers do not count). A dim `… N more lines` row follows, where N is the number of patch lines cut. Expand is #14.
  - **Bad details**: `details` that do not parse show the line only and never throw.
- **AC-13**: A `permission_request` replaces the input area with an amber bracketed panel titled `PERMISSION` with the subtitle `<tool> wants to <verb>` (verb per `ToolKind`: read, write, run, reach the network).
  - **Contents**: the target, then the call input as indented JSON, then the keys `[y] allow once  [a] this session  [n] deny`. The target and the JSON both pass through `redact()`. The JSON gets at most 6 visual rows (wrapped rows count), ending with a dim `…` when cut.
  - **Focus and the typing guard**: while the panel is open, the input stays mounted but loses focus, so nothing typed reaches it and the draft is kept and restored afterwards. For the first 300 ms after a panel opens, every key is ignored, so a keystroke meant for the input never approves anything.
  - **Keys**: after that, `y`, `a` and `n` (either case) call `session.respond` with `allow_once`, `allow_session` or `deny`. Every other key is ignored, apart from Ctrl+C, Ctrl+Z and the scroll keys.
  - **Queue**: a second request queues behind the first, and the title shows `1 of 2`. Each newly shown request restarts the 300 ms guard.
  - **Lamp**: the header lamp blinks while any request is open.
  - **Height**: the panel never takes more than 40% of the center height. The JSON rows shrink first.
- **AC-14**: A `turn_end` with `reason: "error"` adds a red bracketed block titled `ERROR` with the error `code` as its dim subtitle, the `message`, and a dim `try:` line from `ERROR_HINTS` when the code has a hint (no line when it does not). The code and the message both pass through `redact()`. If `error` is missing, the code is `unknown` and the message `the turn ended with an error`. A `turn_end` with `reason: "interrupted"` adds a dim `· interrupted` line, and one with `reason: "turn_limit"` adds an amber `▲ turn limit reached` warning line. If the session's `events` stream ends, a dim `· session ended` line is added and the screen stays until Ctrl+C. If the stream throws, an error block with code `tui.session_failed` and the redacted error message is added.
- **AC-15**: The input is a bracketed panel with a `›` caret and a dim placeholder (`ask pk anything`). It grows with its content from 1 to 8 rows, never past 40% of the center height, then scrolls.
  - **Keys**: Enter is bound to submit, replacing the textarea's default. Shift+Enter inserts a newline, and pasted text keeps its newlines. History and other paste rules are #15.
  - **Submit**: Enter calls `session.submit(text)` with the text unchanged, then clears the input. Text that is empty or only whitespace is not sent.
  - **While a turn runs**: a local `submitting` flag is set on Enter and cleared at that turn's `turn_end`, so two quick presses can never send twice. While it is set, the input stays editable but Enter does not send, and the footer hint shows `turn running`.
- **AC-16**: While the transcript is empty, the center shows the hero: a Braille globe (land in `textDim`, outline in `bracket`, graticule in `line`) tilted 23.4° and turning at 8 frames per second (3° per frame), the wordmark, and three dim tips.
  - **Stopping**: the globe stops turning 60 seconds after start (one timeout), and the hero is gone as soon as the transcript has an item.
  - **Overlaps**: where layers share a Braille cell, outline beats land and land beats graticule. In `none` mode the graticule is not drawn.
  - **Fallback**: when the transcript region (the center minus the input) is under 24 rows or 40 columns, the hero is the ASCIIFont `tiny` font rendering of `PK` with the tips. In ASCII mode it is the four line ASCII art `PK` (`ASCII_WORDMARK`) with the tips instead, because every ASCIIFont draws with block or box glyphs.
  - **Test**: `globeFrame(rotationDeg, cols, rows)` is pure and tested against a committed snapshot at 0° and 90°.
- **AC-17**: The transcript scrolls with the mouse wheel and PgUp/PgDn. The shell routes these keys to the transcript's ScrollBox itself, since focus stays on the input. A page is the viewport height minus 2 rows. Home and End jump to the top and bottom only when the input is empty.
  - **At bottom**: the view is within 1 row of the end of the content. While at the bottom it follows new content (sticky).
  - **Scrolled up**: the view stays put, and a dim `↓ new` marker appears at the bottom edge whenever the content height grows. End, or scrolling back to the bottom, resumes following and clears the marker.
  - **Resize**: resizing keeps the anchor (the item at the top of the viewport and its row offset) and the input draft.
- **AC-18**: Dragging with the mouse selects text inside the transcript only (rails, frames and gutters are not selectable).
  - **On release**: the selected text (without frame glyphs or diff gutters) is sent with OSC 52 (a terminal escape sequence that asks the terminal to write to the system clipboard).
  - **Feedback**: OSC 52 cannot confirm the terminal accepted it, so the footer shows a dim `copy sent (N chars)` for 2 seconds, never "copied". Text over 100,000 characters is not sent, and an amber notice says so.
  - **Unsupported**: when OpenTUI reports OSC 52 as unsupported (`osc52_support` is `"unsupported"`), or `TMUX` is set and tmux's `allow-passthrough` for the pane is `off` (asked at each copy through `TuiOptions.tmuxPassthrough`, which `cli` backs with `tmux show-options -Apv allow-passthrough` and a 500 ms timeout, so turning it on works without a restart), the first copy attempt instead adds one warning notice per session: `copy not supported in this terminal. Hold Shift (Option in iTerm2 or Terminal.app) to select natively`. When `TMUX` is set, `, or set -g allow-passthrough on in tmux` is added. OpenTUI wraps OSC 52 in tmux passthrough, so `allow-passthrough` (not `set-clipboard`) decides whether a copy leaves tmux. When the value cannot be read (no tmux binary, an older tmux), the copy is sent as usual.
  - **Mechanism**: the copy call is injected through `TuiOptions.copy` (defaulting to the renderer's OSC 52 method), so tests cover both branches. No subprocess is ever started for copying.
- **AC-19**: Motion is signal only. When no turn runs, no permission request is open and the hero has stopped, no interval or timeout is pending. A test drives the demo to idle and asserts the `animating` memo is false and the fake clock has no pending interval or timeout.
- **AC-20**: Interactive `pk` and `pk __tui-demo` refuse to start when stdout or stdin is not a TTY, or when `TERM` is `dumb`. They print `pk: interactive mode needs a terminal.` and on a second line `For scripts and pipes use: pk -p "<prompt>"` to stderr and exit 2. This happens before the native library exec and before `@pk/tui` is imported. `cli`'s `Io` gains `stdin.isTTY` and `env` for this, and the existing tests for bare `pk` are updated to run with TTY streams.
- **AC-21**: `@pk/schema` exports `FileTouch` and `ToolDisplayDetails` as Zod schemas with doc comments, shaped as in *Data model sketch*. `Settings` gains `ui: { background?: "pk" | "terminal", ascii?: boolean }`, `"ui"` is added to `USER_ONLY_SETTINGS` (so a project file setting it is dropped with a `user_only_key` warning), and `schemas/settings.schema.json` is regenerated.
- **AC-22**: The hidden `pk __tui-demo [--speed <n>] [--exit-after <ms>]` command runs the real shell on a `TuiSession` built from the committed demo script, with the contents in *Demo script*. A unit test parses every scripted event with the `AgentEvent` schema. A `test:e2e` case drives the compiled binary in a PTY at 140x40: it submits twice, waits 300 ms and answers `y` to each of the two prompts, submits a third time, waits for the error block, exits with Ctrl+C, and asserts exit code 130 and that the terminal was restored.
- **AC-23**: `bun run check` passes, with the boundary rules unchanged: only `tui` imports `@opentui/*` and `solid-js`, and every new export from `src/index.ts` has a doc comment.
- **AC-24**: Every string drawn from outside `tui` (model text, reasoning, tool targets and error lines, diff text, file paths, notice and error text, the project folder) passes through `sanitizeForScreen` first. It removes C0 control characters (0x00 to 0x1F, except newline) and DEL (0x7F), expands a tab to the next multiple of 4 columns, and removes `\r`. A test feeds `"a\x1b[2Jb\tc\r\n"` and gets `"ab  c\n"` with no escape sequence on screen.
- **AC-25**: Events are applied in batches: the shell queues incoming events and applies them all in one Solid `batch` at most every 33 ms (one frame at 30 fps). A test streams 2,000 `text_delta` events at once through the fake clock and asserts at most one render per flush. A test scrolls a 2,000 item transcript through the real shell, 80 PgDn frames and 40 wheel frames, and asserts each frame renders well inside the budget (95th percentile under 16 ms, none over 33 ms). A verify step runs it.

## Decision

**Chosen option**: Option 1: a three column monochrome HUD with corner bracket frames, three signal colors and a scripted demo proving it end to end (see [rationale.md](rationale.md#options-considered)).

pk's screen is a near black canvas with white and grey linework. The transcript is the center hero, with a state rail on the left and an activity rail on the right that collapse by width or with Ctrl+B. Amber, green and red are the only colors, each with one meaning. Every part is built from named tokens, glyphs and primitives in `@pk/tui`, documented in `docs/design.md`, and driven only by the `AgentEvent` stream through a small `TuiSession` port.

**Implementation skills**: `opentui` (`anomalyco/opentui`, `.claude/skills/opentui/`) · `solid-js-1x-best-practices-and-api` (`doeixd/solid-skill`, `.claude/skills/solid-js-1x-best-practices-and-api/`) · `terminal-ui` (`ratacat/claude-skills`, `.claude/skills/terminal-ui/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Design language

This section is the content of `docs/design.md`. `/develop` writes it there in plain prose with these tables, and the tables are what `design-doc.test.ts` checks (AC-1).

#### Palette

Tokens are named by role, never by hue, so a later theme can change values without renaming. In the 16 color column a number is the ANSI palette slot (`fromIndex`), `default fg` and `default bg` mean the terminal's own colors, and `+ dim` or `+ bold` adds that attribute. The "No color" column is the `none` mode (`NO_COLOR`): colors are always the terminal defaults, and only the attribute listed is applied. Grey roles use the dim attribute instead of slot 8, because slot 8 matches the background in some themes (for example Solarized).

| Token | Hex | 16 color | No color | Used for |
|---|---|---|---|---|
| `canvas` | `#07080A` | default bg | none | Screen background (unless `ui.background` is `"terminal"`) |
| `surface` | `#0D0F12` | default bg | none | Input and permission panel fill, one step above the canvas |
| `line` | `#3D424A` | default fg + dim | dim | Rules, rail separators, globe graticule (decoration only) |
| `bracket` | `#A9AEB6` | 7 | none | Frame corners, the `┃` bar on your message, globe outline, neutral `■` markers |
| `text` | `#E4E6EA` | default fg | none | Body text, values |
| `title` | `#E4E6EA` | default fg + bold | bold | Panel titles, the wordmark, tool names, your prompt |
| `textDim` | `#8C919A` | default fg + dim | dim | Subtitles, targets, metadata, hints, empty states, globe land |
| `textFaint` | `#565B63` | default fg + dim | dim | Decoration only (header ticks); never for words |
| `amber` | `#F2A93B` | 3 | bold | Running, waiting on you, warnings, `accept_edits` |
| `green` | `#4CC38A` | 2 | none | Done, added lines |
| `red` | `#E5534B` | 1 | bold | Failed, errors, removed lines, `skip_all` |
| `addBg` | `#0E2A1C` | none | none | Added diff rows (dropped in `16` and `none`) |
| `removeBg` | `#2D1214` | none | none | Removed diff rows (dropped in `16` and `none`) |
| `selectionBg` | `#2B3340` | inverse | inverse | Mouse selection |

Non color constants (the 80% context warning ratio, the 300 ms permission guard, the 40% bottom panel cap, the 33 ms flush) live in `hud-constants.ts`, not in `theme.ts`.

Rules: one meaning per signal color, everywhere. No meaning lives only in color: every colored state also has a glyph or a word. Bold marks titles and your prompt. Dim marks secondary text.

#### Glyphs

One table, two columns. Code never writes a raw glyph; it asks the active set by name.

| Name | Unicode | ASCII |
|---|---|---|
| `cornerTL` `cornerTR` `cornerBL` `cornerBR` | `┌` `┐` `└` `┘` | `+` `+` `+` `+` |
| `rule` | `─` | `-` |
| `vrule` | `│` | `\|` |
| `tick` | `┬` | `+` |
| `bar` | `┃` | `\|` |
| `caret` | `›` | `>` |
| `done` | `◆` | `*` |
| `pending` | `◇` | `o` |
| `failed` | `✖` | `x` |
| `warn` | `▲` | `!` |
| `info` | `·` | `.` |
| `lamp` | `◉` | `@` |
| `marker` | `■` | `#` |
| `reasoning` | `∿` | `~` |
| `newBelow` | `↓` | `v` |
| `ellipsis` | `…` | `...` |
| `gaugeFull` `gaugeEmpty` | `▓` `░` | `#` `.` |
| `spark` (8 levels) | `▁▂▃▄▅▆▇█` | ` .:-=+*#` |
| `spinner` (frames) | `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` | `\|/-\` |
| `wordmark` | `◢◣` | `/\` |

Widths are measured in terminal cells with `Bun.stringWidth`, never with `.length`. Terminals set to draw East Asian ambiguous width characters as two cells will misalign the Unicode glyphs. `ui.ascii: true` is the documented fix, and `docs/design.md` says so.

#### Layout and widths

```
┌ header: wordmark · subtitle        project · branch        lamps ┐   1 row + 1 tick rule
│ LEFT RAIL (24) │        CENTER: transcript or hero        │ RIGHT RAIL (24) │
│ SESSION        │                                          │ ACTIVITY        │
│ CONTEXT        │                                          │                 │
│ PLAN           │                                          │ TOKENS          │
│ FILES          │ ┌─ input (1 to 8 rows) or PERMISSION ─┐  │ COST            │
└ footer: ■ mode  ■ model  ■ tokens  ■ cost                           hints ┘   1 row
```

| Width | Rails | Center width |
|---|---|---|
| 140 or more | left and right, 24 each, with one gap column between each rail and the center | width minus 50 (90 or more) |
| 100 to 139 | right only, 24, with one gap column | width minus 25 (75 or more) |
| 60 to 99 | none | full width |
| under 60, or under 16 rows | `too_small` notice drawn over the mounted screen | unchanged underneath |

Ctrl+B or F2 hides both rails at any width. Each rail's inner edge is a `vrule` in `line`. The input and the permission panel sit at the bottom of the center column, capped at 40% of its height. The transcript takes the rest.

#### Frames and titles

Panels draw only their corners plus a top rule with the title set into it, and a short stub of rule at each bottom corner:

```
┌─ CONTEXT  window usage ─────────┐

   ▓▓▓▓▓▓▓▓▓░░░░░  62%  48.2k

└─                              ─┘
```

Titles are bold uppercase (`title`). The subtitle is lowercase in `textDim`, two spaces after the title. Center panels (permission, error, and the example above) carry subtitles. Rail panels carry the title only, because 24 columns leave no room. Frame corners use `bracket`, and rules use `line`. Inside a frame, content starts 3 columns in, with no blank padding rows in the rails and one blank row above and below in the center panels. The header's lower rule carries a `tick` every 6 columns in `textFaint`.

#### Header

Left: `◢◣ PK` bold, then `terminal coding agent` dim. Middle: the project folder (home shown as `~`), then ` · <branch>` once #16 provides it. Right: the status lamp, the warning count and the error count, as in AC-8. When the width is short, the middle shortens first (middle ellipsis), then the subtitle drops.

#### Footer

` ■ normal   ■ openai/gpt-5   ■ 12.4k tok   ■ $0.04 +1 unpriced` on the left, and hints such as `ctrl+b/f2 rails · ctrl+c quit` on the right in `textDim`. The marker colors are in AC-9. Hints drop from the left when space is short. The values never do.

#### Rails

Each rail is 24 columns: a `vrule` plus 23 for panels, and 21 columns of content inside a panel's 1 column margins. Content rows below are the panel's natural height. Extra rows go to ACTIVITY on the right and are left empty at the bottom on the left.

| Rail | Panel | Content rows | Shows | Empty state |
|---|---|---|---|---|
| left | SESSION | 3 | model (end truncated), mode, folder name | never empty |
| left | CONTEXT | 2 | row 1: a 10 cell gauge, then the percent; row 2: tokens (`48.2k tok`). Amber from 80% | `no calls yet`. While `contextWindow` is unset, row 1 is `window unknown` and there is no gauge |
| left | PLAN | up to 8 | in list order: `◆` done (dim), spinner amber in progress, `◇` pending; then `+n more` when over 8 | `no plan yet` |
| left | FILES | up to 8 | newest touch last: path (middle truncated), then `+a -r` in green and red, or `r` for read only; `+n more` at the top when over 8 | `no files yet` |
| right | ACTIVITY | the rest | newest first: status glyph, name, short target, one call per row | `idle` |
| right | TOKENS | 1 | a 14 cell sparkline of the last 14 calls' output tokens, then the last value (`1.2k`) | `no calls yet` |
| right | COST | 2 | row 1: session total and unpriced count; row 2: `last turn $0.0012` | `no calls yet` |

#### Hero

A Braille globe, 28 columns by 14 rows (each Braille cell is a 2 by 4 grid of dots, so 56 by 56 dots), tilted 23.4° toward the viewer, drawn by orthographic projection (a picture of a sphere seen from far away) of a 72 by 36 land mask (one cell per 5° of longitude and latitude). The mask is committed as 36 strings of `#` and `.`, derived once from public domain Natural Earth 1:110m land data. The graticule (the grid of lines on a globe) is every 30°. Below it sit the wordmark and three tips: `type a prompt and press enter`, `ctrl+b hides the side rails`, `hold shift (option on macOS) to select text natively`. Motion is in AC-16.

#### Transcript items

```
┃ › why does the loop retry twice?

  ∿ thought for 4s
  The retry policy in provider/retry.ts backs off on 429 and 5xx ...

  ◆ read_file   src/provider/retry.ts                     2.1 KB · 0.2s
  ⠋ bash        bun test packages/provider                  running 3s
  ✖ edit_file   src/env/paths.ts                no match for old text
     12   const a = 1;
     13 - const b = 2;
     13 + const b = compute();
  · settings warning skipped
  ▲ retrying after 429 (attempt 2 of 3)

┌─ ERROR  provider.rate_limited ───────────┐
   OpenAI returned 429 after 3 retries.
   try: wait a minute, or switch model
└─                                        ─┘
```

Each item kind has its rule in AC-11 to AC-14. A blank row separates turns. Tool lines and notices sit two columns in, aligned with the reply text. Text after a tool line is a new reply segment below it (AC-11), so the transcript always reads in the order things happened.

`ERROR_HINTS` starts with: `provider.rate_limited` → `wait a minute, or switch model`; `provider.auth` → `check your API key (pk login arrives in #18)`; `provider.unreachable` → `check your network or the provider's base URL`; `tui.session_failed` → `restart pk; the log has details`.

#### Permission panel

```
┌─ PERMISSION  bash wants to run ─────────────── 1 of 2 ┐
   rm -rf dist && bun run build
   { "command": "rm -rf dist && bun run build" }
   [y] allow once   [a] this session   [n] deny
└─                                                     ─┘
```

Corners and title in amber, fill `surface`. Rules in AC-13. The keys row is dim for the 300 ms guard, then switches to `text`, so you can see when the panel starts listening.

#### Input

```
┌─                                        ─┐
 › ask pk anything
└─                                        ─┘
```

Rules in AC-15.

#### Motion

Signal only: a spinner (10 frames per second) on whatever is running, the amber lamp blinking at 1 Hz while waiting on you, and the hero globe until it stops. Nothing else moves. One shared spinner interval drives every spinner on screen, so many running calls still cost one timer.

#### Plain output rules

- **Not a terminal**: interactive pk refuses (AC-20). Plain line output belongs to `pk -p` (#26).
- **`NO_COLOR`**: same layout, no color, and the terminal's own background. Bold, dim and inverse stay. Meaning is carried by glyphs and `+`/`-` markers (AC-4).
- **16 colors**: the hand picked slots in *Palette*, the terminal's background, and no diff row tints.
- **Non UTF-8 locale or `ui.ascii`**: the ASCII glyph column and the wordmark hero (AC-5).

#### Demo script

`tui/src/demo/script.ts` holds a list of turns. Each turn is a list of `{ delayMs, event }` steps, where `event` is an `AgentEvent` without its envelope (`createScriptedSession` adds `seq`, `at` from the clock, and `agentId: MAIN_AGENT_ID`). `--speed n` divides every `delayMs` by `n`. The demo runs with `info` set to model `demo/scripted`, mode `normal`, `contextWindow: 200000`. Its `ui` and `env` come from the real settings and environment, like interactive `pk`.

| Submit | Turn contents |
|---|---|
| 1st | Reasoning for about 2 s. Streamed reply text. A `read_file` call on `src/provider/index.ts` (no permission) whose result carries `files: [{ path, action: "read" }]`. An info notice `project root found at ~/code/demo`. A second reply segment. `usage` priced at 1,200 microUsd. `turn_end` done |
| 2nd | Reply text. Two calls in one message: `edit_file` on `src/provider/retry.ts` and `bash` with `bun test packages/provider`. Two `permission_request`s (queued, `1 of 2`). After the first answer: allowed gives a result with `files: [{ action: "edit", added: 3, removed: 1 }]` and a 52 line patch (so the 40 line cut shows), denied gives an error result `denied by user`. After the second answer: allowed gives a failed result `2 tests failed`, denied gives `denied by user`. A `todo_update` with one done, one in progress and one pending item. A warning notice `retrying after 429 (attempt 2 of 3)`. One `usage` with cost `unknown` and one priced at 1,900 microUsd. `turn_end` done |
| 3rd | Some reply text. A `tool_call_start` for `grep` that never runs. `turn_end` with `reason: "error"` and `error: { code: "provider.rate_limited", message: "OpenAI returned 429 after 3 retries." }` |
| 4th and later | One info notice `demo finished. ctrl+c quits` |

### Data model sketch

No persistence. Two shared schemas land in `@pk/schema`; everything else is view state inside `tui`.

| Schema (in `@pk/schema`) | Shape | Notes |
|---|---|---|
| `FileTouch` | `{ path: string (at least 1), action: "read" \| "write" \| "edit", added?: int ≥ 0, removed?: int ≥ 0 }` | `path` is relative to the project root when inside it, absolute otherwise |
| `ToolDisplayDetails` | `{ files?: FileTouch[], diff?: string }` | `diff` is a unified patch (the `diff -u` text format). Tools put this object in `ToolResultBlock.details`. A tool may add other keys, and `tui` ignores them (a non strict object) |
| `Settings.ui` | `{ background?: "pk" \| "terminal", ascii?: boolean }` | Strict object. Defaults: `"pk"`, `false`. User only (AC-21) |

**Actions.** `reduceHud(state, action)` takes a `HudAction`, which is either an `AgentEvent` or one of the UI's own actions. It has one exhaustive `switch` with a `never` check over both.

| UI action | Raised by | Effect |
|---|---|---|
| `{ type: "ui_submit", text }` | Enter in the input | sets `submitting` |
| `{ type: "ui_respond", requestId }` | `y`, `a` or `n` in the permission panel | removes that request from the queue, and restarts `guardUntil` if another is shown |
| `{ type: "ui_notice", level, code, text }` | the shell itself (copy unsupported, copy too large) | adds a notice exactly like a `notice` event, warnings counted |
| `{ type: "ui_hero_timeout" }` | the 60 second timeout | sets `heroStopped` |
| `{ type: "ui_stream_end" }` and `{ type: "ui_stream_failed", message }` | the event pump | adds the `session ended` notice or the `tui.session_failed` error |

Events whose `agentId` is not `MAIN_AGENT_ID` return the state unchanged (subagent display is #38).

**View state** (`tui`, plain readonly data, built only by `reduceHud`):

| Field | Type | Fed by |
|---|---|---|
| `turn` | `{ status: "idle" \| "running", turnId?: TurnId }` | `turn_start`, `turn_end` |
| `submitting` | boolean | set by `ui_submit`, cleared by `turn_end` |
| `transcript` | `TranscriptItem[]`, each with a stable `key` | `message` (user, and assistant text only when it had no deltas), `text_delta`, `reasoning_delta`, `tool_call_start`, `tool_run_start`, `tool_result`, `notice`, `turn_end`, `ui_notice`, `ui_stream_end`, `ui_stream_failed` |
| `openSegment` | `{ messageId, kind: "text" \| "reasoning", key }` or `undefined` | set by a delta, cleared when any other item is added (AC-11) |
| `tools` | record by `CallId`: `{ name, target?, input?, state: "pending" \| "running" \| "done" \| "failed", denied: boolean, runAt?, durationMs?, sizeBytes?, errorLine?, display?: ToolDisplayDetails }` | `tool_call_start`, `message` (assistant), `permission_request`, `tool_run_start`, `tool_result`, `turn_end` |
| `permissions` | queue of `{ requestId, call, kind }`, plus `guardUntil` (a clock time) | `permission_request` adds; `ui_respond` or `turn_end` removes |
| `files` | ordered by first touch: `{ path, read: boolean, added, removed }` | `ToolDisplayDetails.files` from each `tool_result` |
| `usage` | `{ totalTokens, lastContextTokens, recentOutput: number[] (last 14) }` | `usage` |
| `cost` | `{ knownMicroUsd, pricedCalls, unknownCalls, lastTurnMicroUsd }` | `usage` (via `sumCosts` from spec 0002) |
| `todos` | `TodoItem[]` | `todo_update` |
| `model` | `ModelRef` | `TuiOptions.info.model`, then `model_change` (role `main`) |
| `warnings` | count for the session | warning `notice`, warning `ui_notice`, `turn_limit` |
| `errors` | count since the last `turn_start` | `failed` tool results that are not denials, error `turn_end`; reset by `turn_start` |
| `heroStopped` | boolean | `ui_hero_timeout` |

A tool result counts as denied when `isError` is true and its first text is exactly `denied by user` (the text #7 will use). `TranscriptItem` is a union on `kind`: `user`, `text`, `reasoning`, `tool` (refers to `tools[callId]`), `notice`, `error`. The reducer reuses every unchanged item object, so Solid's `<Index>` keeps the streaming item's slot and updates its text instead of remounting it.

### State transitions

Tool call: `pending` (`tool_call_start`) → `running` (`tool_run_start`) → `done` or `failed` (`tool_result`, by `isError`). A `turn_end` while a call is still `pending` or `running` marks it `failed` with the error line `interrupted`, and does not count it in `errors`.

Status lamp: `ready` → `working` (`turn_start`) → `waiting` (a request is open) → `working` (the last request answered) → `ready` (`turn_end`).

### Interface surface

| Surface | Kind | Key inputs | Key outputs | Key errors |
|---|---|---|---|---|
| `TuiSession` (declared in `tui`) | interface | | `events: AsyncIterable<AgentEvent>`, `submit(text: string): void`, `respond(requestId: RequestId, answer: PermissionAnswer): void`, `interrupt(): void` | #6's real session must satisfy it as is |
| `startTui(options: TuiOptions)` | function in `tui` | `session`, `info: { version, projectRoot, home, model: ModelRef, mode: PermissionMode, contextWindow?: number }`, `ui: { background, ascii }`, `env: { NO_COLOR?, COLORTERM?, TERM?, LANG?, LC_ALL?, LC_CTYPE?, TMUX? }`, `clock: { now(): number, setInterval, clearInterval, setTimeout, clearTimeout }`, `logger`, `hints?: string[]`, `copy?: (text: string) => boolean`, `onQuit?` (Ctrl+C; renamed from the smoke's `onInterrupt` so it is never confused with `session.interrupt()`), `onSuspend?` | `TuiHandle<TuiExit>` (the existing handle from `smoke.tsx`), where `TuiExit` is `{ reason: "quit" \| "session_ended" }` | the reducer never throws; a stream that ends or throws becomes a UI action (AC-14) |
| `createScriptedSession(script, { clock, speed })` | function in `tui/src/demo/` | the demo script (*Demo script*), the clock, the speed divisor | `TuiSession` that plays turn N on the Nth `submit`, waits on `respond` for each permission request, and follows the allowed or denied branch | |
| `pk __tui-demo` | hidden command in `cli` | `--speed <n>` (default 1), `--exit-after <ms>` (optional) | the shell on screen; exit 0 on `--exit-after`, 130 on Ctrl+C | exit 2 when not a terminal (AC-20) |
| `reduceHud`, `layoutFor`, `resolveColorMode`, `resolveTheme`, `glyphSet`, `globeFrame`, `toolTarget`, `sanitizeForScreen`, `truncateMiddle`, `formatTokens`, `formatBytes`, `formatDuration`, `formatMicroUsd` | pure functions in `tui` | as named in the ACs and *Value sourcing* | | none throw |
| Primitives | Solid components in `tui` | `Panel` (title, subtitle, accent), `TitleRule`, `Lamp`, `Marker`, `Gauge`, `Sparkline`, `StatusGlyph`, `Spinner` | | |

`startTui` and `TuiSession` are exported from `tui/src/index.ts`. `cli` builds a `TuiSession` (today only the scripted one) and calls `startTui`. An event pump reads `session.events` into a queue, and the shell applies the queue in one Solid `batch` at most every 33 ms (AC-25). Ctrl+C calls `onQuit` only. Nothing in #4 calls `session.interrupt()`; Esc wires it in #15. Interactive `pk` keeps its "not built yet" message until #6 wires the real session, but it does get the refusal from AC-20 now.

### Value sourcing

| Action | Value displayed | Source |
|---|---|---|
| header | project folder | `info.projectRoot` from `findProjectRoot(cwd)` in `cli`, shown with `info.home` replaced by `~` |
| header | branch | empty until #16 supplies it |
| header | lamps and counts | `reduceHud` fields `turn`, `permissions`, `warnings`, `errors` |
| footer, SESSION | mode | `info.mode`: `settings.permissions.mode` (spec 0002), default `"normal"`; #7 adds live mode changes |
| footer, SESSION | model | `info.model` from `settings.model.main` (or the flag), then `model_change` events with role `main` |
| footer | session tokens | sum over `usage` events of `inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens`, formatted by `formatTokens`: under 1,000 as is (`812`), under 1,000,000 as `12.4k`, else `1.2M` (one decimal, 1000 steps) |
| footer, COST | cost | `sumCosts` over each `usage.cost` (spec 0002): `knownMicroUsd` formatted by `formatMicroUsd` (2 decimals when at least 10,000 microUsd, that is $0.01, else 4 decimals), with `unknownCalls` shown as `+n unpriced`; `—` in place of the figure when no call is priced yet |
| demo | `info` | fixed in `cli` for `__tui-demo`: model `demo/scripted`, mode `normal`, `contextWindow: 200000`, the real `projectRoot` and `home`; `ui` from the real settings, `env` from the real environment |
| COST | last turn | `knownMicroUsd` over the `usage` events since the last `turn_start` |
| CONTEXT | tokens in context | the last `usage` event's `inputTokens + cacheReadTokens + cacheWriteTokens` (the prompt the model just saw) |
| CONTEXT | window and percent | `info.contextWindow`, supplied by `cli`; unset until the model catalog (#19), so the gauge shows `window unknown` and no percent |
| CONTEXT | amber threshold | 80% of the window, `CONTEXT_WARN_RATIO` in `hud-constants.ts` until #25 sets the compaction point |
| TOKENS | sparkline | `outputTokens` of the last 14 `usage` events, scaled to the largest of those (all zero draws the lowest level) |
| PLAN | items | `todo_update.todos` |
| FILES | paths and counts | `ToolDisplayDetails.files` from each `tool_result.details`; `added` and `removed` summed per path; any `read` action sets `read` |
| tool line | name | `tool_call_start.name` |
| tool line | target | `toolTarget(call.input)`, with the call input taken from whichever comes first: the assistant `message` event's `tool_call` block or `permission_request.call`. It is the first string among the keys `path`, `file_path`, `command`, `pattern`, `url`, `query`, cut to its first line and passed through `sanitizeForScreen`. Tools (#8, #9, #11, #37) name their main argument with one of these keys. Nothing is shown if none is present or the input has not arrived yet |
| tool line | size | sum of the byte length (UTF-8) of the text blocks in `tool_result.result.content`, formatted by `formatBytes` in 1024 steps: `512 B` (whole bytes), `2.1 KB`, `1.4 MB` (one decimal) |
| tool line | duration | `tool_result.durationMs`; elapsed while running is `clock.now()` minus the `at` of `tool_run_start`. Both formatted by `formatDuration`: `0.2s` under 10 s (one decimal), `14s` under a minute, `1m 05s` after |
| tool line | error line | the first line of the first text block when `isError` |
| diff | patch | `ToolDisplayDetails.diff` |
| reasoning | "thought for Ns" | the `at` of the last `reasoning_delta` minus the `at` of the first, for that message, rounded to whole seconds (at least 1) |
| permission panel | verb | `ToolKind`: `read` → read, `write` → write, `execute` → run, `network` → reach the network |
| permission panel | target and input | `toolTarget(call.input)` and `call.input` as indented JSON (2 spaces), both through `redact()`, the JSON capped at 6 visual rows |
| permission panel | guard end | `clock.now()` when the request is shown, plus `PERMISSION_GUARD_MS` (300) from `hud-constants.ts` |
| error block | code, message | `turn_end.error.code` and `turn_end.error.message`, both through `redact()`; `unknown` and `the turn ended with an error` when `error` is missing |
| error block | hint | `ERROR_HINTS` in `tui`, a `Record<string, string>` keyed by error code, seeded with `provider.rate_limited`, `provider.auth`, `provider.unreachable` and extended by the features that add codes |
| color mode | depth | `NO_COLOR` from `TuiOptions.env`; `rgb` and `ansi256` from the renderer's capabilities once reported (repaint on a `capabilities` event that changes the mode); before that, the `COLORTERM` and `TERM` guess in AC-3 |
| glyph set | Unicode or ASCII | `LC_ALL`, `LC_CTYPE`, `LANG` from `TuiOptions.env`, and `settings.ui.ascii` |
| canvas | background | `settings.ui.background`, plus the color mode rule in AC-3 |
| copy | OSC 52 support | the renderer's `osc52_support` and `osc52` capabilities; `TMUX` from `TuiOptions.env` for the hint; `TuiOptions.tmuxPassthrough` from `cli` |
| hero | land | the committed `LAND_MASK` constant, checked against known land and ocean points (a test) |

### Key invariants

- `tui` reads core state only from `AgentEvent`s and `TuiOptions`. It never imports `provider`, `tools` or `permissions`.
- `reduceHud` is pure and total: every `HudAction` variant (each `AgentEvent` type and each UI action) has a `case` with a `never` check, and no action throws.
- Every color comes from a theme token and every glyph from the active glyph set. A test scans the code of `tui/src` for hex literals and for the Unicode glyphs in the table. It skips `theme.ts`, `glyphs.ts`, `*.test.ts`, the `demo/` folder and comments.
- Every outside string is drawn only after `sanitizeForScreen` (AC-24).
- The screen tree stays mounted for the whole session; layout changes and `too_small` never unmount the transcript, input or permission panel.
- No state is shown only by color. Every status has a glyph or a word.
- `textFaint` is never used for words.
- At most one interval runs per animated thing (one shared spinner interval, the lamp, the globe), and no interval or timeout is pending while idle (AC-19).
- The input draft survives permission prompts, resizes, `too_small` and rail toggles.
- No permission answer is accepted within `PERMISSION_GUARD_MS` of a request being shown.

### Security model

- Single local user; there is no access control in the UI. The concern is leaking secrets onto the screen or into the clipboard.
- Error codes and messages, notice text, and the permission panel's target and JSON input pass through `redact()` before display. They can carry provider error bodies or arguments. Model text and tool output are shown unredacted, since they are the conversation itself. Their persistence is redacted by the session tap (#24).
- Every outside string is sanitized (AC-24), so model or tool output cannot move the cursor, clear the screen or send escape sequences to the terminal.
- A permission can never be granted by a keystroke typed before the panel appeared (the 300 ms guard and the input losing focus, AC-13).
- Copy uses only OSC 52, never starts a subprocess, and refuses text over 100,000 characters.
- `ui` settings are user only, so a cloned repo cannot change how pk draws.
- `__tui-demo` plays only its committed script. It takes no script path, and it reads the environment and settings exactly as interactive `pk` does, and for nothing else.

### Configuration required

No new environment variables or credentials. pk reads the existing `NO_COLOR`, `COLORTERM`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TERM` and `TMUX` (passed into `startTui` by `cli`, never read at module level), plus the new user only settings `ui.background` and `ui.ascii`. OpenTUI's own `COLORTERM` and `OPENTUI_FORCE_TRUECOLOR` keep working as OpenTUI documents.

### Critical test scenarios

- Happy path: the PTY e2e drives `pk __tui-demo` through all three turns, answers both permission prompts, sees the diff and the error block, then quits with exit 130 and a restored terminal. Verifies **AC-20**, **AC-22**.
- Reducer: feeding the full demo script (allowed branch) through `reduceHud` yields `+3 -1` on `src/provider/retry.ts` and `r` on `src/provider/index.ts`, cost `$0.0031 +1 unpriced`, an error count of 1 after turn 2 (the failed `bash`) that resets at turn 3's `turn_start` and becomes 1 again at its error `turn_end`, and turn 3's `grep` call marked `failed` (`interrupted`) by `turn_end` without being counted. The denied branch gives an error count of 0 after turn 2. Verifies **AC-8**, **AC-9**, **AC-10**, **AC-12**, **AC-14**.
- Segments: a message streaming text, then a tool call, then more text renders as text, tool line, text, in that order. Verifies **AC-11**.
- Typing guard: a `y` arriving 100 ms after a `permission_request` is ignored and reaches neither `respond` nor the input; a `y` at 350 ms calls `respond` with `allow_once`. Verifies **AC-13**.
- Double submit: two Enters 10 ms apart call `submit` once. Verifies **AC-15**.
- Sanitize: model text with an escape sequence renders without it. Verifies **AC-24**.
- Widths: in memory renders at 140x40, 120x40 and 80x30 match committed frame snapshots, and 59x30 shows the `too_small` notice. Verifies **AC-6**.
- Plain output: `NO_COLOR` render has only default intents. ASCII render has only printable ASCII. A 16 color render uses only indexed and default intents. Verifies **AC-3**, **AC-4**, **AC-5**.
- Color codes on the wire: the PTY e2e plays the demo with `TERM=xterm` and no `COLORTERM` and sees only `38;5;N` palette slots and `49`, never `38;2`. With `COLORTERM=truecolor` it sees the `48;2;7;8;10` canvas. With `NO_COLOR` it sees no color, and with `ui.background` `"terminal"` no canvas. Verifies **AC-3**, **AC-4**.
- Land: known land points (the Sahara, Brazil, Siberia, Australia, Antarctica and more) are `#` in `LAND_MASK`, and open ocean points are not. At turn 0 the globe's center cell is land, and at turn 180 it is not. Verifies **AC-16**.
- Scroll budget: the 2,000 item scroll test above. Verifies **AC-25**.
- Permission: two requests queue (`1 of 2`). `n` calls `respond` with `deny`, the draft `half typed` is restored, and the lamp stops blinking. Verifies **AC-13**, **AC-8**.
- Failure: a `tool_result` with `details: { diff: 42 }` renders the tool line and no diff, with nothing thrown. Verifies **AC-12**.
- Copy: with an injected `copy` that records its input, a drag release sends the selected text without gutters and shows `copy sent (N chars)`. With `osc52_support` set to `unsupported`, or inside tmux with `tmuxPassthrough` `off`, the first release adds one warning notice and the second adds none, and nothing is sent. Outside tmux the notice has no tmux part and `tmuxPassthrough` is never asked. Verifies **AC-18**.
- Trust: a project `.pk/settings.json` with `"ui": { "background": "terminal" }` is dropped with a `user_only_key` warning. Verifies **AC-21**.
- Idle: after the demo goes idle and the hero stops, no interval is pending on the fake clock. Verifies **AC-19**.

## Build plan

The order follows the project's Tracer Bullet approach. First one thin, real thread runs through every layer this feature owns: settings, the refusal, the session port, a scripted session, a minimal shell and the compiled binary under a PTY. Each segment is then thickened in turn. There is no migration: the two schema changes land in the first milestone.

**Milestone 1: the tracer thread**
1. In `schema`: add `FileTouch`, `ToolDisplayDetails` and `Settings.ui`, put `"ui"` in `USER_ONLY_SETTINGS`, regenerate `schemas/settings.schema.json`, and test the trust case. Satisfies **AC-21**.
2. In `cli`: add `stdin.isTTY` and `env` to `Io`, then the not a terminal refusal (stdin, stdout, `TERM=dumb`) for interactive `pk` and the new `__tui-demo`, before the native library exec, with exit 2. Update the bare `pk` tests to use TTY streams. Satisfies **AC-20**.
3. In `tui`: `TuiSession`, `TuiOptions`, `TuiExit` and `createScriptedSession` (with `delayMs` and `speed`), with the demo script's first turn only, plus the test that parses every scripted event as an `AgentEvent`. Satisfies **AC-22** (in part).
4. In `tui`: a first `reduceHud` over `HudAction` (turn status, `submitting`, user message, streaming text, the main agent filter), the event pump with the 33 ms batched flush, and `startTui` with a plain header, the transcript, the input (Enter rebound to submit, Shift+Enter newline, the double submit guard) and the footer, reusing the smoke screen's handle, close and suspend logic with `onQuit`. Wire `pk __tui-demo` in `cli` and add the PTY e2e for one turn. Satisfies **AC-15**, **AC-22** (in part), **AC-25**.

**Milestone 2: tokens, glyphs and plain output**
5. `theme.ts` with the palette, the `Style` type, the 16 color and no color treatments, `resolveColorMode` (including the guess before capabilities arrive), `resolveTheme` and the contrast test. Repaint on a `capabilities` event that changes the mode. Satisfies **AC-2**, **AC-3**.
6. `glyphs.ts` with both sets and `glyphSet`, `truncateMiddle` with `Bun.stringWidth`, `sanitizeForScreen` applied at every outside string, and the raw hex and glyph scan test. Satisfies **AC-5**, **AC-24**.
7. Primitives: `Panel`, `TitleRule`, `Lamp`, `Marker`, `StatusGlyph`, `Spinner`, used by the header, footer and input. Then the `NO_COLOR` and ASCII render tests. Satisfies **AC-4**, **AC-5**, **AC-15**.
8. Write `docs/design.md` from *Design language*, and add `design-doc.test.ts`. Satisfies **AC-1**.

**Milestone 3: transcript items**
9. Your message, reply and reasoning segments (the segment rule, folded reasoning with duration), notices, the interrupted and turn limit lines, and the stream end and stream failure items. Satisfies **AC-11**, **AC-14** (in part).
10. Tool lines with all four states, the unknown call rule, `toolTarget` from either source, `formatBytes` and `formatDuration`, and the diff under the line (`Diff` unified, every color from the theme, the patch cut to 40 lines, tints by color mode). Satisfies **AC-12**, **AC-4**.
11. The permission panel: queue, input focus loss, the 300 ms guard, keys, draft restore, `redact()` on the target and JSON, the 40% height cap, and the blinking lamp. Extend the demo script to turn 2 with both branches. Satisfies **AC-13**, **AC-8** (in part).
12. The error block with `ERROR_HINTS`. Extend the demo script to turns 3 and 4, and the PTY e2e to all three turns. Satisfies **AC-14**, **AC-22**.

**Milestone 4: rails, header, footer and hero**
13. Complete `reduceHud` (files, usage, cost, todos, model, counts) with the full demo script test. Satisfies **AC-10**, **AC-9** (in part).
14. `layoutFor`, the rails with all seven panels (`Gauge`, `Sparkline`) at the sizes in *Rails*, the panel drop order, Ctrl+B and F2, the `too_small` overlay over the mounted screen, and the width snapshots. Satisfies **AC-6**, **AC-7**, **AC-10**.
15. The full header (lamps, counts) and the footer legend (marker colors, unpriced and `—`, hints list). Satisfies **AC-8**, **AC-9**.
16. The hero with the ASCIIFont `tiny` wordmark and tips first, then the Braille globe as the last task of the milestone: `LAND_MASK`, `globeFrame` with tilt, layer order and snapshots, turning, and the 60 second timeout. The globe can be cut without touching anything else if it drags. Satisfies **AC-16**.

**Milestone 5: scroll, select, copy and idle**
17. Transcript scrolling (keys routed to the ScrollBox, wheel, PgUp/PgDn by viewport minus 2, Home/End when the input is empty, the at bottom rule, sticky follow, `↓ new`) and resize keeping the anchor and the draft. Satisfies **AC-17**.
18. Selection limited to the transcript, copy through the injected `copy` (OSC 52 by default), the `copy sent` flash, the 100,000 character limit, and the unsupported notice once per session. Satisfies **AC-18**.
19. The `animating` memo, the shared spinner interval, interval and timeout cleanup through the injected clock, and the idle test. Satisfies **AC-19**.
20. `bun run check` green, doc comments on every new export, the PTY e2e on the compiled binary, and the 2,000 item scroll check. Satisfies **AC-23**, **AC-25**.

## Consequences

**Positive**:
- A distinctive, coherent look that later features (#6, #7, #13, #14, #15, #23) fill in instead of designing their own.
- The screen is proven in the real binary before the loop exists, so #6 only connects a session to a known shell.
- `NO_COLOR`, 16 colors, ASCII and narrow windows are handled by construction (tokens, glyph sets, `layoutFor`), not patched later.
- `ToolDisplayDetails` fixes the tools to UI contract once, before any write tool is built.

**Negative / tradeoffs**:
- The rails take 50 columns at full width. On a 140 column terminal the transcript gets 90, against 140 for a plain single column UI. Ctrl+B and the breakpoints soften this, but the HUD costs reading width.
- A painted black canvas ignores light and transparent terminal themes unless the user sets `ui.background: "terminal"`.
- Mouse capture means native terminal selection needs Shift or Option. Some users will trip on this before they read the hint.
- OSC 52 does not work everywhere (some tmux setups, some SSH clients). Copy then needs the native modifier.
- The hero globe is decoration: a committed land mask, a projection function and snapshots that must be kept up.
- The 300 ms permission guard adds a short pause before a fast `y` counts. That is the price of never approving by accident.
- OSC 52 gives no confirmation, so `copy sent` can show in a terminal that silently dropped the copy.
- Batching events every 33 ms adds up to one frame of delay to streamed text.
- `toolTarget` relies on a naming convention for tool input keys. A tool that names its main argument differently shows no target until it follows the convention.
- Scope row #4 said output should be plain text when `NO_COLOR` is set. This spec keeps the full layout without color instead (allowed by the NO_COLOR convention, which is only about color). The scope "done when" needs that wording change.

**Neutral**:
- `docs/design.md` becomes a maintained document, kept honest by `design-doc.test.ts`.
- `@pk/schema` gains two schemas, and `Settings` gains a `ui` section (the generated JSON Schema changes).
- `cli` gains a hidden `__tui-demo` command. It stays after #6 as the fastest way to look at every UI state.

## Follow-up

- [ ] Scope #4 "done when": change "output is plain text when ... `NO_COLOR` is set" to "no color when `NO_COLOR` is set, layout kept", per this spec.
- [x] Spec 0001 Follow-up "decide what interactive `pk` does when stdout is not a terminal" is answered here (refuse with a `pk -p` hint, AC-20). Ticked there on 2026-11-22.
- [ ] #6 Agent loop: the real session satisfies `TuiSession`, interactive `pk` switches from "not built yet" to `startTui`, and `read_file` returns `ToolDisplayDetails` with a `read` file touch.
- [ ] #8 File write and edit tools: return `ToolDisplayDetails` with `files` (`added`, `removed`) and a unified `diff`, and name the main argument `path`.
- [ ] #9, #11, #37: name each tool's main argument with a `toolTarget` key (`command`, `pattern`, `url`, `query`).
- [ ] #7 Permission prompts: a diff preview inside the permission panel before a write runs, live mode changes in the footer, and a deny note. The loop's result text for a denied call must be exactly `denied by user`, which `tui` relies on to keep denials out of the error count (or #7 replaces that text match with a field in `ToolDisplayDetails`).
- [ ] #14 Streaming markdown: replaces plain reply text; adds expand and collapse for tool lines and diffs over 40 rows.
- [ ] #15 Input editing: newlines, history, paste, Esc interrupt (calls `session.interrupt()`), and transcript search.
- [ ] #16 Environment context: fill the header branch slot.
- [ ] #19 Model catalog: supply `contextWindow` so the CONTEXT gauge shows a percent. #25 replaces the 80% amber constant with the compaction point.
- [ ] #23 Status line: builds on the footer legend defined here rather than a separate line.
- [ ] #26 Headless mode: until it lands, the AC-20 refusal points at a `pk -p` that does not exist yet.
- [ ] `terminal-ui` is listed in `packages/tui/AGENTS.md` but not in root `AGENTS.md` `## Agent skills`. Add a one line pointer if you want it found from the root.
