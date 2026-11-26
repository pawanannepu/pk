# 0003. Terminal UI foundation: rationale

Decision record for [spec 0003](index.md). `/develop` builds from `index.md` and skips this file.

## Context

> ⚠️ Premise note: a dashboard look is built for watching, while a coding agent's screen is built for reading. The main risk in this direction is chrome crowding out the transcript: rails, frames and a decorative hero that cost width and attention on every turn. The design below keeps the transcript as the hero, gives the rails a strict width budget with breakpoints and a Ctrl+B escape, keeps motion to signals only, and stops the globe after the first prompt. If the rails turn out to be ignored in practice, the cheapest fix is to start with them hidden, not to redesign.

pk is a full screen terminal app (OpenTUI 0.9.7 with Solid, spec 0001), and every interactive feature after this one draws into it: the loop (#6), permission prompts (#7), tools with diffs (#8), slash commands (#13), streaming markdown (#14), input editing (#15) and the status line (#23). Today `@pk/tui` holds only the smoke screen that proved the stack. Without a shared visual language, each of those features invents its own colors, glyphs and layout, and the product looks assembled rather than designed. Fixing a look after six features have shipped means touching all six.

The engineer supplied a reference image: a dark HUD dashboard with a near black canvas, white and grey linework, corner bracket frames, bold titles with small subtitles, tick mark rulers, side rails around a central globe, a footer legend of colored squares, and only a few accent colors. It is a strong, specific direction, and it was built for a wall display, not a terminal. Translating it means honoring the terminal's limits: a fixed cell grid, 16 to 16 million colors depending on the terminal, fonts that may lack Braille or box drawing glyphs, windows from 60 to 300 columns, and users on `NO_COLOR`, tmux and SSH.

Several constraints are already fixed. Spec 0001 makes the `AgentEvent` stream the only thing frontends read, puts `@opentui/*` and `solid-js` only in `tui`, and owes an answer on what interactive `pk` does when stdout is not a terminal. Spec 0002 fixes the event shapes, `ToolResultBlock.details` (screen only, never sent to a model), the settings layering and the user only key mechanism. The full screen mode hides the terminal's own scrollback, so pk must provide scrolling, selection and copy itself. Root rules require pure functions over readonly data, I/O passed in at the edges, no module level side effects in `tui` (it is loaded lazily), and `redact()` on everything that leaves the process.

Not deciding means #6 builds a throwaway screen to show the loop working, and every later feature redoes its share of it.

## Options considered

### Option 1: Three column monochrome HUD with signal colors (chosen)

The image's language mapped onto pk: a near black canvas, white and grey linework, corner bracket frames with titled rules, amber, green and red as the only colors (each with one meaning), a center transcript with a state rail on the left and an activity rail on the right that collapse by width (140 and 100 columns) or with Ctrl+B, a header with lamps, a footer legend with `■` markers, and a Braille globe hero before the first prompt. Built as tokens, a two column glyph table and primitives, documented in `docs/design.md`, and proven in the binary through a scripted demo session.

**Pros**:
- Faithful to the engineer's reference while keeping the transcript readable (at least 75 columns whenever a rail shows).
- Agent state (context, plan, files, activity, cost) is visible at a glance without commands.
- Three signal colors with fixed meanings make the screen readable in a second, and degrade cleanly to 16 colors and `NO_COLOR` because every state also has a glyph.
- The demo proves every component in the compiled binary before the loop exists.

**Cons**:
- The rails cost 50 columns at full width, and a painted canvas ignores light terminal themes by default.
- More surface to build and test than a plain UI: seven rail panels, the lamps and the hero.
- Mouse capture trades away native selection unless the user holds a modifier.

### Option 2: Single column transcript with HUD accents

The transcript takes the full width. The HUD look comes only from the header, bracketed frames around tool output and errors, the footer legend, and the palette. Session state lives in the footer and in slash commands (`/context`, `/todos`, `/cost`).

**Pros**:
- Maximum reading width, and the least to build.
- Closest to what users of other terminal coding agents already know.
- No breakpoints to design or test.

**Cons**:
- Loses most of the reference image's character, which is what the engineer asked for.
- Context, plan and files are hidden behind commands, so the user has to ask what the agent is doing instead of seeing it.
- The footer becomes overloaded as #22, #23 and #25 add values.

### Option 3: Full dashboard with focusable, tabbed panels

The image taken further: every panel is focusable with Tab, scrollable on its own, and switchable between views (for example, files as a tree or a list, activity filtered by tool). Panels are rearrangeable, and the layout is saved in settings.

**Pros**:
- The most power for users who live in pk all day.
- Each panel can grow into a real tool (a file browser, an activity inspector).

**Cons**:
- A focus model, per panel key maps and layout persistence are a large design and test surface, and they fight the input for keys (#15).
- Pulls the product toward an IDE inside a terminal, away from a conversation.
- Far more to keep stable across OpenTUI upgrades while it is pre 1.0.

## Rationale

Option 1 is the only option that delivers the engineer's reference without sacrificing the job the screen exists for, which is reading and steering a conversation. The forces in Context decide the details. Since later features must not invent styles, the design is captured as named tokens, a glyph table and primitives, and a test keeps `docs/design.md` and `theme.ts` from drifting apart. Since terminals vary from 16 colors to truecolor and from ASCII to full Unicode, the color mode and glyph set are resolved once at start from explicit inputs, and no state is carried by color alone. OpenTUI already approximates RGB on 256 color terminals and supports indexed and terminal default color intents, so the 256 color tier costs nothing and the 16 color tier is a hand picked table (nearest match turns the greys to mush). The engineer's answers fixed the main shape: three columns collapsing at 140 and 100 columns, black by default with an opt out, amber/green/red, corner brackets, the rail contents, signal only motion, and a scripted demo.

Several smaller calls were made here with full design context. The `TuiSession` port is declared in `tui` (the consumer states what it needs) rather than in the still empty `agent` package. The runner up was declaring it in `agent` now, which would pre design #6's session before the loop exists. The tool line's target comes from a small naming convention over the call input (`path`, `command`, `pattern`, ...) rather than a new field on `tool_run_start`, because changing `AgentEvent` for a display concern would widen spec 0002 for one consumer. The runner up was a `title` in `ToolDisplayDetails`, which only arrives after the tool finishes, too late for the running state. The diff and file counts come from `ToolDisplayDetails` in `details`, which spec 0002 reserved for the screen. A shared schema now means #8 builds to a known contract instead of the UI guessing. The context gauge uses the last call's prompt tokens because that is the size the model actually saw, and it shows no percent until the catalog (#19) can say how big the window is, rather than guessing a size.

The not a terminal case refuses rather than falling back to line output, because `pk -p` (#26) owns plain output and a second, half interactive mode would duplicate it badly (permission prompts have no good line form). `NO_COLOR` keeps the layout, because the convention is about color, not structure, and a monochrome HUD still reads well. This departs from the scope row's wording, which is flagged for update. Copy uses OSC 52 only and never a subprocess: it works over SSH, needs no platform tools, and when it fails the user is told how to select natively instead of getting a silent no op. Option 2 was the safe choice and remains the fallback if the rails prove to be noise (hide them by default). Option 3 is a direction pk could grow into later, panel by panel, without rework, because the primitives and `reduceHud` already separate state from drawing.
