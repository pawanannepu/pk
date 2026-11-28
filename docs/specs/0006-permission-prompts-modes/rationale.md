# 0006. Permission prompts and modes: rationale

The decision record behind [index.md](index.md). `/develop` builds from the index; this file explains why.

## Context

Slice 2 exists so pk can never change or run anything you did not allow, and it has to be in place before the first tool that writes (#8) or runs a command (#9). Spec 0005 left a small seam for this: a pure `decide` that lets `read` kind tools run and asks for everything else, a `permission_request` event the loop waits on, and three answers (`allow_once`, `allow_session`, `deny` with an optional note). The screen (spec 0003) already draws the panel, guards it for 300 ms against stray keys, and colors the footer's mode marker per mode. The settings schema (spec 0002) already has `permissions.mode` with four values, read only from your user file. What is missing is any behavior behind the modes, a way to change them, and a clear meaning for "no".

Several forces pull here. The core stays functional and pure: rules in, decision out, no I/O, testable cell by cell. A mode must be switchable while you work, but the slash command framework that would host `/mode` is three slices away (#13). Skip all exists for sandboxes and scripts, yet it is the one setting that turns every protection off, so it must never be on by accident, by a stale settings file, or by a cloned repo. Plan mode has to be truly read only, and the model needs to learn why its write did nothing without a system prompt to explain it (#17 is later). Session allows were keyed by tool name, which is fine for an edit tool but means "always allow the shell" would allow every command.

The neighbors shape the edges. #10 owns rules (allow, deny, always ask) and anything about paths, including writes outside the project. #24 owns session files, #26 owns headless answering. This feature must leave each of those a clean place to plug in, without deciding for them.

Not deciding leaves `/develop` to invent the precedence between modes and session allows, what a plan mode block looks like to the model, whether a plain deny stops a turn, how a note is typed, and whether skip all can come from settings.

## Options considered

### Option 1: one pure decision table, mode held by the session (chosen)

`decide` takes `{ tool, kind, key }` and `{ mode, sessionAllows }` and returns `allow`, `ask` or `block`, with a fixed check order. The session holds the mode as replaceable state, exposes `setMode`, emits `mode_change`, and decides a pending request again on a change. The screen only calls `setMode`; it never applies a mode rule itself.

**Pros**:
- The entire safety surface is a 4 by 4 table plus one session allow check, tested exhaustively as a pure function.
- Tools stay ignorant of modes; they declare `kind` (and `sessionKey` for commands) and nothing else.
- #10 extends the same function with rules; #13, #26 reuse `setMode` and the same decisions.

**Cons**:
- `decide` only sees kind, not what a call touches, so anything path or command shaped (writes outside the project, destructive commands) has to wait for #10's richer request.
- The session gets a little more state (mode, the pending request kept for a second decision).

### Option 2: mode checks spread through the loop and the tools

The loop skips the prompt for writes in `accept_edits`, each write tool checks for plan mode itself, and the screen hides skip all from the cycle.

**Pros**:
- Fewest new types; each check sits next to the code it affects.

**Cons**:
- Mode rules end up in four packages. Every new tool must remember to check plan mode, and one that forgets writes in plan mode.
- Nothing can test the whole policy in one place, which is exactly the property a safety feature needs.

### Option 3: build the rule engine now (fold #10 into #7)

Treat modes as built in rule sets in a general allow, deny and ask engine with patterns for tools, commands and paths, and ship it all at once.

**Pros**:
- One design pass for the whole permission system; no exact key step before prefix rules.

**Cons**:
- Command matching for chained and quoted commands is the hard part of #10, and it has no real shell tool to test against until #9. Designing it now means designing it blind.
- Doubles the size of the slice's first feature, against the Tracer Bullet approach of thickening one segment at a time.

## Rationale

Option 1 is chosen because the force that matters most is that the policy must be checkable. A permission system fails by a single forgotten branch, and Option 2 makes that branch live in every tool forever. A pure table with a fixed order is small enough to test every cell and to read in one screen, and it keeps the functional rule from `AGENTS.md` (pure functions, I/O at the edges) intact. Option 3 is the right destination, but #10 is where it belongs: its hard problem (matching real shell commands) needs #9's tool to exist, and the decision shape chosen here (`key` in the request, `reason` on `block`) leaves room for it without a rewrite.

The answers in the design conversation follow the same line. A plain deny stops the turn and a note continues, because a bare "no" usually means "stop, I want to redirect", while a note is guidance meant for the turn still running; making both continue (today's behavior) invites the model to retry the same goal another way. The note gets its own key (`e`) so a plain deny stays one keystroke. Session allows are exact for commands and whole tool for writes, because "always allow the shell" is a footgun before #10 has prefix rules, while every edit's input differs and an exact key would make `[a]` useless for writes. Shift+Tab gives live switching now without a throwaway `/mode` parser that #13 would replace. Skip all comes only from its own long flag, never settings, and joins the cycle only when that flag was given, so it is explicit on every launch yet you can still step down to normal and back. Plan mode blocks writes and commands but still asks for network, because looking things up is part of planning. A pending request is decided again on a mode change (with Shift+Tab under the same 300 ms guard), because switching to accept edits while a write waits and still being asked feels broken. `turn_end denied` is a new reason, not a reuse of `interrupted`, so the screen, headless and session files can tell a deny from an Esc.

Runner ups worth recording: for the deny effect, "both stop" was the safer alternative, rejected because a note could then no longer steer a running turn; for session allows, "tool name for everything" was simpler, rejected because of the shell; for skip all, "flag plus a typed confirmation" was the stricter alternative, rejected because it breaks the scripted sandboxes skip all exists for.

### Decisions settled while writing (the recommend items)

- **Plan block text names its cause first.** `blocked by plan mode: …` lets the screen match it like `denied by user` and tells the model to keep exploring and describe a plan. Runner up: reuse the denied text, rejected because the model would think you said no.
- **Later calls after a plain deny get `not run`, not a denial.** They were never shown to you, so calling them denied would be false. Runner up: drop them, rejected because every call needs a result for the conversation to stay valid.
- **The pending panel closes on `tool_run_start` or `tool_result` for its call.** No new "request withdrawn" event is needed. Runner up: a `permission_cancel` event, rejected as one more contract member for the same information.
- **The skip all warning is a screen item, not an event.** The screen already knows the mode from `info.mode` and `mode_change`; headless (#26) will print its own warning. Runner up: a new `danger` notice level in `AgentEvent`, rejected as a schema change for a presentation concern.
- **Start notices go through `AgentDeps.notices`.** Settings warnings today only reach the log; the ignored skip all setting must reach you, and the session's event stream is the one channel every frontend reads. Runner up: a TUI only option, rejected because headless would need its own copy.
- **`sessionKey` is required for `execute` by the type, not at run time.** The strict types rule prefers a compile error to a runtime check. Runner up: throw in `defineTool`, rejected as a failure found later.
- **The queue continues after a plain deny.** A deny is a decision about one call, not a request to drop what you already typed. Runner up: clear it like interrupt, rejected because Esc already does that.
- **The note is capped at 500 characters.** Enough for a sentence or two of guidance; it is a single line field, not a second prompt box.

### After the cross check

An independent read by a second model found the design sound and listed gaps a builder would otherwise guess at. All of them were closed in `index.md` with the recommended fixes (the wait type, end reason order, the mode getter against the Shift+Tab race, the note field mechanics, session key typing, the `agent.invalid_mode` check, flag order, the shared result matcher, and the screen seeding). It also questioned two earlier answers, and both were kept on purpose:

- **A mode switch still settles a pending call.** Switching into accept edits is itself a deliberate yes to edits, and the 300 ms guard covers stray keys. To keep every approval traceable, the call now gets an `allowed by <mode> mode` notice and an info log. Runner up: re-decide only for blocks, rejected because asking after you switched to accept edits feels broken.
- **Skip all stays in the cycle when the flag was given.** You opted in at launch, every entry adds a red line, and the footer stays red. Runner up: make skip all leave only, rejected as harder to remember for little gain once the flag is required.
