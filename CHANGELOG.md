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
