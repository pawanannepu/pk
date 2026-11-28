# pk design: the terminal HUD

This is pk's visual language for the full screen terminal UI. It is the written form of [spec 0003](specs/0003-terminal-ui-foundation/index.md), and the code in `packages/tui` follows it. If you build a screen feature, start here: use the tokens, glyphs and primitives below instead of inventing a style.

The look is a dark heads up display (an instrument panel). A near black canvas, white and grey linework, panels framed only at their corners, and three signal colors: amber for "running or needs you", green for "done or added", red for "failed or removed". The conversation sits in the middle. Two side rails show session state and activity, and they drop away as the window narrows.

`design-doc.test.ts` reads the Palette and Glyphs tables below and fails if they and the code (`theme.ts`, `glyphs.ts`) ever disagree. When you add a token or a glyph, add it to both.

## Palette

Tokens are named by role, never by hue, so a later theme can change values without renaming anything. In the 16 color column a number is the ANSI palette slot, `default fg` and `default bg` mean the terminal's own colors, and `+ dim` or `+ bold` adds that attribute. The "No color" column is what `NO_COLOR` gets: colors are always the terminal defaults, and only the listed attribute is applied. Grey roles use the dim attribute instead of slot 8, because slot 8 matches the background in some themes (Solarized, for example).

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

Contrast against `canvas` (WCAG): `text` is at least 7:1; `textDim`, `amber`, `green` and `red` are at least 4.5:1; `bracket` is at least 3:1, the level for graphics that are not text. `textFaint` and `line` are for decoration only, and the `Words` primitive does not accept them.

Rules you can rely on:

- One meaning per signal color, everywhere.
- No meaning lives only in color. Every colored state also has a glyph or a word.
- Bold marks titles and your prompt. Dim marks secondary text.

Numbers that are not colors (the 80% context warning, the 300 ms permission guard, the 40% bottom panel cap, the 33 ms event flush) live in `hud-constants.ts`, not in `theme.ts`.

### Color modes

`resolveColorMode` picks the depth. `NO_COLOR` set to anything non empty means `none`. Otherwise pk uses what the terminal reports (`truecolor` when it does RGB, `256` when it does 256 colors, else `16`). Before the first report it guesses from `COLORTERM` (`truecolor` or `24bit`) and `TERM` (containing `256color`). The screen repaints when a report changes the mode. In `16` and `none` the canvas is always the terminal's own background; so is it when you set `ui.background` to `"terminal"`.

## Glyphs

Code never writes a raw glyph. It asks the active set by name, and a test scans `packages/tui/src` to keep it that way.

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

pk uses the ASCII column when you set `ui.ascii: true`, or when the first non empty of `LC_ALL`, `LC_CTYPE`, `LANG` does not name UTF-8 (all three empty counts as not UTF-8).

Widths are measured in terminal cells with `Bun.stringWidth`, never with `.length`. A terminal set to draw East Asian "ambiguous width" characters as two cells will misalign the Unicode glyphs. If that is you, set `ui.ascii: true` in your user settings.

The cost figure shows the `rule` glyph in place of a dollar amount before any call is priced, so ASCII mode stays pure ASCII.

## Layout and widths

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
| under 60, or under 16 rows | a `too_small` notice drawn over the mounted screen | unchanged underneath |

`layoutFor({ width, height, railsHidden })` computes this, and it is pure. Ctrl+B or F2 hides both rails at any width (F2 because tmux uses Ctrl+B as its prefix). Each rail's inner edge is a `vrule` in `line`. The input and the permission panel sit at the bottom of the center column, capped at 40% of its height; the transcript takes the rest.

The screen tree stays mounted for the whole session. A resize, the `too_small` notice, a rail toggle or a permission prompt never unmounts the transcript, the input or the panel, so your draft, the scroll position and an open request survive. While `too_small` shows, only Ctrl+C and Ctrl+Z work.

## Frames and titles

Panels draw only their corners, a top rule with the title set into it, and a short stub of rule at each bottom corner:

```
┌─ CONTEXT  window usage ─────────┐

   ▓▓▓▓▓▓▓▓▓░░░░░  62%  48.2k

└─                              ─┘
```

- Titles are bold uppercase (`title`). The subtitle is lowercase in `textDim`, two spaces after the title, and it shortens first when space is short.
- Center panels (permission, error) carry subtitles. Rail panels carry the title only, because 24 columns leave no room.
- Frame corners use `bracket` (or the panel's accent: amber for permission, red for error). Rules use `line`.
- Inside a center panel, content starts 3 columns in, with one blank row above and below. Rail panels have 1 column margins and no blank rows.
- The header's lower rule carries a `tick` every 6 columns in `textFaint`.

Build frames with the `Panel` primitive (`TitleRule` and `BottomRule` underneath); never draw corners by hand.

## Header

Left: `◢◣ PK` in bold, then `terminal coding agent` dim. Middle: the project folder (your home folder shown as `~`), then ` · <branch>` once #16 provides it. Right:

- The status lamp: `◉` and a word. `ready` in `textDim` when idle, `working` in `text` while a turn runs, and `waiting` while a permission request is open, swapping between `amber` and `textDim` once a second.
- An amber `▲ n` warning count when n is above 0. It counts the whole session and never resets.
- A red `◉ n err` count when n is above 0. It counts failed tool calls and error turn ends since the last turn started. A call you denied, a call blocked by plan mode, a call not run after a plain deny and a call cut off by the end of a turn do not count.

When the width is short, the middle shortens first (ellipsis in the middle), then the subtitle drops.

## Footer

A legend strip of `■` markers and values on the left, hints on the right in `textDim`:

```
 ■ normal   ■ openai/gpt-5   ■ 12.4k tok   ■ $0.04 +1 unpriced     shift+tab mode · ctrl+b/f2 rails · ctrl+c quit
```

- The mode marker is `bracket` for `normal` and `plan`, amber for `accept_edits`, red for `skip_all`. It starts from the start mode and follows each `mode_change`, as does the SESSION rail's mode row (spec 0006).
- Tokens are the session total (input, cache read, cache write and output). Cost uses 2 decimals from $0.01, else 4. A call with no price shows as `+n unpriced`, never as $0; before any call is priced the figure is the `rule` glyph (`─ +2 unpriced`).
- Hints show only keys that work today. Later features add theirs through `TuiOptions.hints`. While a turn runs the footer adds `turn running`, and after a copy it shows `copy sent (N chars)` for 2 seconds.
- Hints drop from the left when space is short. The values never do.

## Rails

Each rail is 24 columns: a `vrule` plus 23 for panels, which leaves 21 columns of content inside a panel's 1 column margins. Extra rows go to ACTIVITY on the right, and stay empty at the bottom on the left.

| Rail | Panel | Content rows | Shows | Empty state |
|---|---|---|---|---|
| left | SESSION | 3 | model (end truncated), mode, folder name | never empty |
| left | CONTEXT | 2 | a 10 cell gauge then the percent; then tokens (`48.2k tok`). Amber from 80% | `no calls yet`. Without a known context window, row 1 is `window unknown` with no gauge |
| left | PLAN | up to 8 | in list order: `◆` done (dim), spinner amber in progress, `◇` pending; then `+n more` | `no plan yet` |
| left | FILES | up to 8 | newest touch last: path (middle truncated), then `+a -r` in green and red, or `r` for read only; `+n more` at the top | `no files yet` |
| right | ACTIVITY | the rest | newest first: status glyph, name, short target, one call per row | `idle` |
| right | TOKENS | 1 | a 14 cell sparkline of the last 14 calls' output tokens, then the last value | `no calls yet` |
| right | COST | 2 | session total and unpriced count; then `last turn $0.0012` | `no calls yet` |

When a rail is too short, whole panels drop from the bottom up (FILES, then PLAN on the left; COST, then TOKENS on the right). A panel is drawn only if its title row and at least one content row fit. Rails fill only from the event stream, through the pure `reduceHud` reducer.

## Hero

Until your first message, the center shows the hero: a Braille globe (28 columns by 14 rows) tilted 23.4°, the wordmark, and three dim tips (`type a prompt and press enter`, `ctrl+b hides the side rails`, `hold shift (option on macOS) to select text natively`).

- Land is drawn in `textDim`, the outline in `bracket`, and the graticule (a line every 30°) in `line`. Where layers share a Braille cell, outline beats land and land beats graticule. In `none` mode the graticule is not drawn.
- The land comes from a committed 72 by 36 mask (one cell per 5°), derived once from public domain Natural Earth data.
- The globe turns at 8 frames per second, 3° per frame, and stops 60 seconds after start. The hero is gone as soon as you submit a prompt or a message arrives. Notices that come before that (a start warning, the red skip all line) show under it, above the input.
- When the transcript region is under 24 rows or 40 columns, the hero is the ASCIIFont `tiny` rendering of `PK` with the tips. In ASCII mode it is a four line ASCII art `PK` instead, since every ASCIIFont uses block glyphs.

## Transcript items

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

A blank row separates turns. Tool lines, notices and reply text sit 2 columns in. Items appear in the order things happened: text after a tool line is a new reply segment below it.

- **Your message**: a `┃` bar in `bracket` down its left edge and a bold `›`.
- **Reply**: plain wrapped text (markdown arrives with #14). One assistant message can make several reply or reasoning segments: a segment ends when any other item is added after it.
- **Reasoning**: folds to one dim line, `∿ thinking` with a spinner while it streams, then `∿ thought for Ns`.
- **Tool call**: one line with a status glyph, the tool name in bold, the target dimmed and truncated in the middle, and on the right the result size and duration, or the elapsed time while running. Pending is `◇` dim, running a spinner in amber, done `◆` green, failed `✖` red with the first line of the error in place of the size. A call you denied, a call blocked by plan mode and a call not run after a plain deny show their state word dim on the right (`denied`, `blocked`, `not run`), matched by `classifyResultText`. A call still running when the turn ends is marked failed with `interrupted`.
- **Diff**: when a tool's result carries a unified patch (`ToolDisplayDetails.diff`), it is drawn under the line in unified view with line numbers. Rows are tinted (`addBg`, `removeBg`) in `truecolor` and `256`, shown with colored signs only in `16`, and with sign columns only in `none`. The patch is cut to 40 lines, followed by a dim `… N more lines`. Expand arrives with #14.
- **Error**: a red framed block titled `ERROR`, the error code as its dim subtitle, the message, and a dim `try:` hint when `ERROR_HINTS` has one for the code.
- **Notice**: info is a dim `·` line; a warning is an amber `▲` line and also raises the header's warning count. An interrupted turn adds `· interrupted`, a turn limit adds `▲ turn limit reached`, a plain deny adds `· stopped: you denied a tool call`, and a session that ends adds `· session ended`.
- **Skip all line**: each time the mode enters `skip_all` (at start, or by Shift+Tab), a red `▲ skip all: every tool runs without asking` line is added. It is a screen only `danger` notice, counts as a warning, and stays after the mode moves on.

Every string from outside `tui` (model text, tool output, paths, error text) passes through `sanitizeForScreen` first, which removes escape sequences and control characters and expands tabs, so nothing the model or a tool prints can move the cursor or clear your screen.

## Permission panel

```
┌─ PERMISSION  bash wants to run ─────────────── 1 of 2 ┐
   rm -rf dist && bun run build
   { "command": "rm -rf dist && bun run build" }
   [y] allow once  [a] this command  [n] deny  [e] deny and explain

└─                                                     ─┘
```

Narrow, the keys wrap onto the second row: `[y] allow once  [a] this command`, then `[n] deny  [e] deny and explain`. `[a]` reads `this command` for a run (it allows only that exact command) and `this session` for everything else (the whole tool).

- It replaces the input area. Corners and title are amber, and the fill is `surface`. The verb follows the tool's kind: read, write, run, or reach the network.
- It shows the target, then the call input as indented JSON (at most 6 rows, ending with a dim `…` when cut). Both pass through `redact()` first.
- For the first 300 ms after a panel shows, every key is ignored, so a keystroke meant for the input never approves anything. The keys row is dim during that pause, then turns to `text` so you can see when the panel starts listening.
- `y`, `a` and `n` (either case) answer. The input stays mounted but loses focus, so nothing you type reaches it, and your draft comes back afterwards. A plain `n` stops the turn, so you can redirect pk with your next prompt.
- `e` (either case) swaps the keys for a one line note field, `note › `, with a dim `enter send · esc back` below it, in the same two rows so the panel never moves. Enter denies with your note (trimmed), which goes back to the model as guidance and the turn goes on; an empty note is a plain deny. Esc brings the keys back and sends nothing. The note keeps at most 500 characters; pasted newlines and tabs become spaces. While it is open, `y`, `a`, `n` and Shift+Tab are typed or ignored, never answers.
- A second request queues behind the first (`1 of 2`), and each newly shown request restarts the pause. The panel never takes more than 40% of the center height; the JSON rows shrink first.

## Input

```
┌─                                        ─┐
 › ask pk anything
└─                                        ─┘
```

A framed panel with a `›` caret and a dim placeholder. It grows with your text from 1 to 8 rows (never past 40% of the center), then scrolls. Enter sends; Shift+Enter (in terminals that report it) and Ctrl+J insert a newline. Text that is empty or only spaces is not sent. While a turn runs, the input stays editable but Enter does not send, so two quick presses never send twice.

The shell takes these keys before the input: Ctrl+C, Ctrl+Z, Ctrl+B and F2, PgUp and PgDn, Home and End on an empty input, and Shift+Tab, which steps the permission mode (`normal → accept_edits → plan → normal`, plus `skip_all` after `plan` only when pk started with `--dangerously-skip-permissions`). Shift+Tab is ignored during the permission panel's 300 ms pause, while its note field is open, and in `too_small`.

## Motion

Motion is a signal, never decoration that runs forever. Only three things move: a spinner (10 frames per second) on whatever is running, the amber lamp blinking once a second while pk waits on you, and the hero globe until it stops. One shared interval drives every spinner on screen. When no turn runs, no request is open and the hero has stopped, no timer is pending at all.

## Plain output rules

- **Not a terminal**: interactive pk refuses to start when stdin or stdout is not a terminal, or `TERM` is `dumb`. It prints `pk: interactive mode needs a terminal.` and a pointer to `pk -p "<prompt>"`, then exits with code 2. Plain line output belongs to `pk -p` (#26).
- **`NO_COLOR`**: the same layout, no color, and the terminal's own background. Bold, dim and inverse stay. Meaning is carried by glyphs and the `+` and `-` diff markers.
- **16 colors**: the hand picked slots in the Palette, the terminal's background, and no diff row tints.
- **Non UTF-8 locale or `ui.ascii`**: the ASCII glyph column and the wordmark hero.

## Settings

Two user only settings change how pk draws. A project's `.pk/settings.json` cannot set them, so a cloned repo cannot change your screen.

```json
{ "ui": { "background": "terminal", "ascii": false } }
```

- `ui.background`: `"pk"` (the default) paints the near black canvas; `"terminal"` keeps your terminal's own background, which suits light and transparent themes.
- `ui.ascii`: `true` draws with plain ASCII glyphs.

## Trying it

`pk __tui-demo` plays a scripted session through the real screen, with every item kind above. `--speed 4` plays it four times faster. It is the fastest way to look at a change to the UI.
