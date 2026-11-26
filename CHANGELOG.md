# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The first `pk` project: a TypeScript workspace on Bun 1.4.4, split into one package per module (`schema`, `env`, `provider`, `provider-openai`, `permissions`, `tools`, `agent`, `tui`, `headless`, `cli`). Most of them are stubs for now (see spec 0001).
- `pk --version` and `pk --help`. Bare `pk` says interactive mode is not built yet and prints the help.
- One standalone `pk` binary per target, built with `bun run build`: macOS arm64, macOS x64, Linux x64 and Linux arm64 (glibc). The binary does not load a project's `.env` or `bunfig.toml`.
- A clear exit message when pk runs on Windows or on musl Linux (such as Alpine), instead of a native library crash.
- A fixed table of exit codes: 0 for success, 1 for failure, 2 for a usage error, and 128 plus the signal number when pk stops on a signal.
- A hidden `pk __tui-smoke` command that shows an OpenTUI and Solid hello screen, handles a resize and then exits, restoring the terminal. It proves the UI stack works inside the compiled binary.
- In the compiled binary, OpenTUI's native library is loaded from a private pk cache folder (`<cache>/native/<id>/`, mode 0700) instead of the shared temp folder. pk refuses to start, with one message for each cause, if that folder or any folder above it could be changed by another user. Copies left unused for more than 7 days are removed.
- Data folders from `paths()`: `~/.pk` on macOS, the XDG folders on Linux, or `PK_HOME` for everything when it is set.
- Shared building blocks in `@pk/env`: crash safe `atomicWriteFile` and `appendJsonl`, a JSONL logger under `<state>/logs/` (rotates at 5 MB, never writes to stdout, `--debug` mirrors it to stderr), a `redact()` helper that the logger and the error output pass everything through, and the `PkError` base class.
- `bun run check`, which runs Biome lint, a type check of every package, a module boundary check (`scripts/check-boundaries.ts`) and `bun test`. Tests never touch your real home folder. `bun run test:e2e` drives the compiled binary through a pseudo terminal.
- GitHub Actions: `ci.yml` runs `check` on Ubuntu 22.04 and macOS 15, and `build.yml` builds and smoke tests every target on that target's own runner.
- pk's own data shapes in `@pk/schema`, each written once as a Zod 4 schema that gives both the TypeScript type and the runtime check: messages and content blocks (text, image, reasoning, tool calls and results), tool definitions, token usage and cost, provider stream events, the `AgentEvent` stream the UI reads, saved file records and settings. No vendor field appears in them, and a test fails if one ever does, so adapters translate at their edge (see spec 0002).
- `checkConversation` reports a tool call with no result, an orphan or duplicate result, and a reused call ID. `repairConversation` always returns a conversation that passes the check, adding the error result "No result was recorded for this call." where one is missing.
- Model references written as `provider/model` (for example `openrouter/anthropic/claude-x`), split at the first `/`, with a clear message when the provider part is not valid.
- Cost tracking that never counts an unknown price as zero: `sumCosts` returns the known total in micro dollars plus how many calls had no known cost.
- `checkStreamOrder`, which reports every ordering problem in a provider stream (a missing or repeated `stop`, a tool call delta with no start, a call left open), so adapters and the fake provider can be tested against one set of rules.
- Session files that survive damage and upgrades. Each file starts with a versioned header. An older file is upgraded in memory as it is read, a newer one stops with `session.too_new`, and broken or unknown lines are skipped and counted instead of failing the whole file. Reading a session back repairs the conversation so it can always resume.
- Images in saved sessions are stored as separate blob files named by the SHA 256 of their bytes. An image whose blob is gone reads back as `[image unavailable]`.
- Record shapes for the cost log (`<state>/costs/<YYYY-MM>.jsonl`) and the prompt history (`<state>/history.jsonl`). The writers for both come in later features.
- Settings from up to three files plus command flags, applied in this order: your user file, `.pk/settings.json`, `.pk/settings.local.json`, then flags. An unknown key is a warning, a wrong type is an error that lists every problem, and an API key written as plain text is rejected without echoing the value. A published JSON Schema at `schemas/settings.schema.json` gives editors completion, and `bun run schemas` regenerates it.
- A project's own settings files can never send your API key to another server or loosen your permission checks: `providers`, `permissions.mode` and `permissions.allow` are dropped from them with a warning, while their `deny` and `ask` rules still apply. A broken project file stops pk and suggests `--no-project-settings`.
- The `pk --no-project-settings` flag, listed in `pk --help`. Settings loading is built and tested, but pk does not load settings at startup yet, so the flag has no effect today.
- Project detection: pk finds your project root as the nearest folder with `.pk` or `.git` (your home folder never counts) and gives each project a stable key, so two folders with the same name never share data.
- Sortable IDs with a type prefix (`ses_`, `msg_`, `call_` and so on). IDs made later always sort after earlier ones, even when the clock moves backward.
- Private files: sessions, blobs, costs and history are written as `0600` files inside `0700` folders, readable only by you. `ensurePrivateDir` also tightens an existing folder you own.
- pk's visual language for the full screen UI, written down in `docs/design.md`: a near black canvas with white and grey linework, panels framed only at their corners, and three signal colors with one meaning each (amber for running or waiting on you, green for done or added, red for failed or removed). A test fails if the doc and the code's color tokens or glyph names drift apart (see spec 0003).
- The building blocks of the full screen UI in `@pk/tui`: a header with status lamps, a footer legend for mode, model, tokens and cost, a left rail (session, context, plan, files) and a right rail (activity, tokens, cost), a transcript for your messages, replies, reasoning, tool calls with diffs, notices and error blocks, a permission panel, and an input that grows from 1 to 8 rows. While the transcript is empty, a slowly turning Braille globe and three tips fill the center, and the globe stops after 60 seconds.
- The screen adapts to your terminal. Both rails show at 140 columns or more, only the right rail from 100 to 139, and no rails below 100. Ctrl+B or F2 hides them at any width. Below 60 columns or 16 rows a notice gives the current and minimum sizes, and your draft, scroll position and any open permission request are kept until the window grows again.
- Correct output without color or Unicode. With `NO_COLOR` set, no color is written, and every state still has a glyph or word (diff rows keep their `+` and `-` signs). A 16 color terminal gets its own palette slots. A locale that is not UTF-8, or `ui.ascii: true`, switches every glyph to plain ASCII.
- A permission panel that is hard to approve by accident. It ignores every key for the first 300 ms after it opens, so a keystroke meant for the input never approves anything. Then `y`, `a` and `n` allow once, allow for the session, or deny. A second request waits in line behind the first, and the tool input it shows passes through `redact()`.
- Scrolling with the mouse wheel and PgUp/PgDn. The view follows new content while you are at the bottom, and shows a `↓ new` marker when you have scrolled up. Dragging selects transcript text only and sends it to your clipboard with OSC 52. The footer says `copy sent`, never `copied`, because the terminal cannot confirm it. When the terminal or tmux would drop the copy, a notice tells you how to select natively or turn on tmux's `allow-passthrough`.
- Text from outside the UI (model output, tool output, file paths, errors) is cleaned before it is drawn, so control characters and escape sequences can never repaint or take over your terminal.
- Two new user settings under `ui`: `background` (`"pk"` paints pk's canvas, the default; `"terminal"` keeps your terminal's own background) and `ascii` (forces ASCII glyphs). Both are user only, so a project's settings file setting them is dropped with a warning. `schemas/settings.schema.json` includes them.
- `ToolDisplayDetails` and `FileTouch` in `@pk/schema`, the shapes a tool result uses to hand the UI a diff and the files it touched.
- A hidden `pk __tui-demo [--speed <n>] [--exit-after <ms>]` command that plays a scripted session (replies, tool calls, a diff, two permission prompts and an error) through the real full screen UI, so you can see and test the whole screen before the agent loop exists.

### Changed

- Bare `pk` and `pk __tui-demo` now refuse to start when stdin or stdout is not a terminal, or `TERM` is `dumb`. They print `pk: interactive mode needs a terminal.` and suggest `pk -p "<prompt>"`, then exit with code 2. Bare `pk` in a real terminal still says interactive mode is not built yet.
- `bun run check` now also runs `bun run schemas --check`, which fails when `schemas/settings.schema.json` no longer matches the settings schema.
- `atomicWriteFile` and `appendJsonl` accept a file mode and a folder mode for the paths they create. `appendJsonl` now starts a new line when the file ends in a torn line from a crash, so a new record never glues onto it.
