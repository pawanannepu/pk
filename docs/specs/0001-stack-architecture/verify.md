# Verify: Stack & architecture · spec 0001 · updated 2026-11-21
_Steps derived from spec 0001's scaffold constraints and the scope's Done when (the spec has no numbered acceptance criteria, so each step names its source). `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] In a real terminal, run `bun run build`, then `./dist/pk-<os>-<arch> __tui-smoke --duration 5000`, and resize the window while it runs → the screen shows `pk <version> · tui smoke` and the size and resize count update; after 5 s it closes, your shell prompt is back on the main screen, the cursor is visible and typing echoes normally → First proof
- [ ] Same command, press Ctrl+C partway → pk exits at once with the terminal restored; `echo $?` prints `130` → Process behavior (terminal restore, exit codes)
- [ ] Same command, press Ctrl+Z → you get the shell back with a normal terminal; run `fg` → the screen redraws and closes on its timer → Process behavior (SIGTSTP)

## Commands
- [ ] `bun install --frozen-lockfile && bun run check` → lint, typecheck (every package, `scripts`, `tests`), boundary check and tests all pass → Done when (`check` passes on the empty workspace)
- [ ] `bun run test:e2e` → every check passes and it ends with `e2e passed` (passed on macOS arm64 on 2026-11-21) → Done when (`pk --version` from the compiled binary), First proof
- [ ] After the first push: the `ci` workflow is green on `ubuntu-22.04` and `macos-15` → CI
- [ ] After the first push: the `build` workflow is green on all four targets (`macos-15`, `macos-15-intel`, `ubuntu-22.04`, `ubuntu-22.04-arm`), and each job log shows binary size and startup → Done when (macOS and Linux), First proof, Follow up (size and startup per target)
- [ ] Plant a violation, for example `import "@opentui/core"` in `packages/agent/src/index.ts` → `bun run boundaries` fails naming the file; remove it again → Dependency rules
- [ ] Add `export const v = Bun.version` to any core package → `bun run typecheck` fails for that package; remove it again → Workspace conventions (core packages get Node types only)
- [ ] In an empty temp folder holding a `bunfig.toml` with a `preload` script and a `.env` setting `PK_HOME`, run the compiled binary → neither is loaded → Packaging (autoload off)
- [ ] `PK_HOME=$(mktemp -d) bun test` leaves your real `~/.pk` untouched → Tests (preload sets PK_HOME)

## Native library home (added 2026-11-21, after the spec's update)
_Each case is also an automated check in `bun run test:e2e`; these are the same checks done by hand._
- [ ] `D=$(mktemp -d); mkdir $D/ro && chmod 555 $D/ro`, then in a real terminal `PK_HOME=$D/home TMPDIR=$D/ro ./dist/pk-<os>-<arch> __tui-smoke` → exits 0; `ls -A $D/ro` is empty; `ls -la $D/home/native/*/` shows a folder with mode `drwx------` holding a `.bun-*` library file; the result line shows `BUN_TMPDIR=null PK_NATIVE_DIR=null PK_USER_BUN_TMPDIR=null` → First proof (1)
- [ ] Same, with `BUN_TMPDIR=/some/folder` set → the result line shows `BUN_TMPDIR="/some/folder"`, and nothing is written to `/some/folder` → First proof (1), restore
- [ ] Same, with `PK_NATIVE_DIR=<the target folder>` set and no `BUN_TMPDIR` → still exits 0 with the library in the private folder → First proof (2), loop guard
- [ ] `mkdir -p $D/h3/native && chmod 755 $D/h3/native`, run with `PK_HOME=$D/h3` → exits 1 with `run chmod 700 <folder>` naming the folder → First proof (3)
- [ ] Make `$D/h4/native` a symlink to another folder, run with `PK_HOME=$D/h4` → exits 1 saying it is a symlink; the link's target stays empty → First proof (4)
- [ ] `mkdir $D/open && chmod 777 $D/open`, run with `PK_HOME=$D/open/home` → exits 1 with `can be changed by other users; set PK_HOME` → First proof (5)
- [ ] `PK_HOME` reached through a symlinked parent folder → exits 0; the result line's `native=` is the resolved path (no link in it) → First proof (6)
- [ ] Two smokes started at the same moment on one fresh `PK_HOME` → both exit 0 → First proof (7)
- [ ] `PK_HOME=$D/v ./dist/pk-<os>-<arch> --version` → `$D/v` is never created (the native home runs only for paths that load the UI) → Process behavior (where it runs)
- [ ] After the first push: the `build` job log on `ubuntu-22.04` and `ubuntu-22.04-arm` shows all of the above passing → Follow up (Linux native library proof); record the outcome in the spec

## Resolved open item
- ~~The read only `TMPDIR` proof fails~~: resolved by the spec's *Native library location* update. The library now goes to `<cache>/native/<id>/` through a self exec. Proven on macOS arm64 by `bun run test:e2e`; Linux is proven by the `build` workflow after the first push.

## Acceptance-criteria coverage
- Done when, spec recorded: already met (spec 0001)
- Done when, `pk --version` builds and runs on macOS: e2e step (met on macOS arm64); on Linux and Intel macOS: build workflow step
- Done when, `check` passes: check step
- First proof (render, one resize, timer exit, terminal restore, PTY): UI steps, e2e step, build workflow step
- First proof (read only TMPDIR, native library home cases 1 to 7): native library home steps, e2e step, build workflow step (Linux)
- Process behavior (Ctrl+C exit 130, Ctrl+Z and resume): UI steps; also automated in the e2e step
- Smoke turn (`pk -p` with the scripted fake provider): not testable yet; the spec makes it conditional on the `headless` and `provider` stubs carrying it (#3, #5, #26)
