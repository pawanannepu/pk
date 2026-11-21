# Epic: Terminal

The interactive experience. Follows the look set in [#4 Terminal UI foundation](foundations.md). Part of the [pk scope](index.md).

## Slice 4: Interactive experience

### 13. Slash command framework & core commands · needs a decision
One registry for slash commands with help text and completion, plus the core set: `/help`, `/clear`, `/exit`, `/mode`, `/todos`, `/context`. Later features add their own (`/login`, `/model`, `/cost`, `/compact`, `/resume`, `/init`).
**Done when:** `/help` lists every command with a one line description; typing `/` suggests commands; an unknown command says so instead of going to the model.
- [ ] Design it (spec): `/architect slash command framework & core commands`

### 14. Streaming markdown & compact tool display · needs a decision
Responses stream as rendered markdown (headings, lists, code blocks with highlighting); tool calls show as compact one line summaries that can expand.
**Done when:** markdown renders while streaming without flicker; tool calls show tool name, target and result size in one line; output falls back to plain text when not a terminal or `NO_COLOR` is set.
- [ ] Design it (spec): `/architect streaming markdown & compact tool display`

### 15. Input editing, history & Esc interrupt · needs a decision
Multiline input, history across sessions, and Esc that interrupts cleanly at any point (streaming, tool running, waiting on permission).
**Done when:** a user can write and edit multiline prompts and paste large text; up arrow recalls earlier prompts; Esc stops the current turn, leaves the session usable, and tells the model what was interrupted.
- [ ] Design it (spec): `/architect input editing, history & Esc interrupt`

## Slice 6: Providers and accounts

### 23. Status line · needs a decision
A status line showing provider, model, permission mode, context usage and session cost.
**Done when:** the line updates live, stays readable in narrow windows, and never shows a secret.
- [ ] Design it (spec): `/architect status line`

## Slice 11: Extensibility

### 34. Custom slash commands · needs a decision
Users save reusable prompts as files (user and project level) and run them as `/name`, with arguments.
**Done when:** a prompt file in the right folder becomes a command listed in `/help`; arguments are filled in; a custom command never overrides a built in one silently.
- [ ] Design it (spec): `/architect custom slash commands`

### 39. Image input · needs a decision
Paste or attach screenshots for models that accept images.
**Done when:** an image attaches to the next message for models that support images; models that don't are flagged before sending; image cost is tracked.
- [ ] Design it (spec): `/architect image input`
