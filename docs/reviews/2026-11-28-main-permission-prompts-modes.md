# Review, main (uncommitted), 2026-11-28

**Reviewed by**: Sonnet 5.5 (author on unknown model; reviewed without a separate model)
**Scope**: 47 files (bun.lock excluded) plus untracked spec and test files, uncommitted vs main
**Verdict**: Approve with nits

## Summary
Implements spec 0006: the AC-1 decision table in `decide`, `resolveStartMode`, session owned mode with `setMode` and pending re-decision, the plain-deny stop path, `permissionKey`/`sessionKey` typing, the TUI note field, Shift+Tab cycle, skip all line and e2e PTY cases. `bun run check` passes (lint, typecheck, boundaries, schemas, 689 tests). I traced the loop paths (abort vs `setMode` vs `respond`, deny order vs `turn_limit`, NOT_RUN for later calls, pending cleared before resolve) and found them matching the spec. Only documentation drift and small test or comment gaps remain.

## Minor
### 🟡 Nested AGENTS.md files not updated for spec 0006, `packages/permissions/AGENTS.md:5`
**Problem**: The overview still says `decide` allows `read` kind and `sessionAllows` and that "modes and rules arrive with #7 and #10". Modes, `resolveStartMode` (`src/start-mode.ts`), block decisions and key based session allows now exist. `packages/tools/AGENTS.md` does not mention `permissionKey` or the `execute` `sessionKey` rule, `packages/agent/AGENTS.md` does not mention `setMode`, `mode_change` or the plain deny stop, and `packages/tui/AGENTS.md` (not touched) does not list Shift+Tab or the note field. None of the four link spec 0006.
**Why it matters**: These files are the AI context later features read first; the stale line contradicts the code.
**Suggested fix**: Run /sync (or hand edit) to update the overviews and related specs lists, and flip spec 0006 Status when it ships.

### 🟡 No screen level test for interrupt while the note field is open, `packages/tui/src/modes.test.tsx`
**Problem**: Spec 0006 critical scenarios list "abort while the note field is open ends `interrupted` and drops the note". The agent level interrupt is tested (`agent/src/modes.test.ts:391`) and the reducer drops the panel on `turn_end` (`hud/reduce.ts:419`), but no TUI test opens the note, types, delivers `turn_end`, and asserts the field closes and the typed note is gone (the `createEffect` reset in `shell.tsx` relies on `head()?.requestId` changing).
**Why it matters**: A stale draft or open field leaking into the next request is the behavior AC-6 and AC-14 promise against, and it is only covered by inference.
**Suggested fix**: Add a shell test: open the note, type, emit an interrupted `turn_end`, then raise a new request and check it starts on the keys row with an empty draft.

### 🟡 `permissionKey` runs outside any guard in the loop, `packages/agent/src/session.ts:339`
**Problem**: `tool.permissionKey(validated.input)` calls the tool author's `sessionKey`. A throwing `sessionKey` escapes `runCall` and ends the turn as `agent.internal` with the call unanswered until `fail` closes it.
**Why it matters**: Low likelihood (#9 is the first real user), but a shell tool bug would kill the turn instead of failing that one call.
**Suggested fix**: Either wrap it so a throw gives the `invalidPermissionKey` style fallback (which never widens an allow), or state in the `ToolSpec.sessionKey` doc that it must not throw. Add a test either way.

## Nits
- ⚪ `packages/tui/src/ui/transcript.tsx:156`, the doc comment "The right side of a tool line..." now sits above `outcomeWord`'s own doc comment instead of above `toolRight`; move it back.
- ⚪ `packages/cli/src/program.ts:166`, `program.opts<RootFlags>()` is a type assertion over commander's output rather than a Zod parse; commander `choices` validates `--mode`, so this is safe, but it is the one `as`-style trust boundary in the change.
- ⚪ `packages/cli/src/program.ts:254`, spec AC-7 says `__tui-demo` and `__tui-smoke` "neither accept nor read" the flags; the implementation accepts them as root options and then refuses with exit 2 (`refuseModeFlags`). Arguably clearer for users, but it is a small deviation from the spec text; note it in the spec or follow-up.
- ⚪ `packages/tui/src/shell.tsx:213`, `onNotePaste` only checks the draft length, not an active selection in the input, so a paste over a selection can be shortened more than needed; harmless.

## Strengths
- `decide` is a small pure table with exhaustive `switch`es and `never` checks at both levels, falling through to `ask`; the plan block precedes session allows as required.
- The loop handles the racy paths correctly: `pending` is cleared before `resolve`, abort wins over `setMode` and `respond`, the end reason order is interrupted, denied, turn_limit, and later calls after a plain deny are not validated or decided.
- The `ToolSpec` union makes `sessionKey` required for `execute` and forbidden otherwise at compile time, with `@ts-expect-error` tests; `invalidPermissionKey` cannot widen an allow.
- `skip_all` is guarded in three places (flag resolution, `createAgentSession` throws `agent.invalid_mode`, `setMode` ignores it), and the e2e script covers the AC-15 PTY cases against the binary.

## Test coverage
Strong. All AC-1 cells, session allow keys (including exact command), plan block, plain deny and note deny, start notices, `agent.invalid_mode`, live `setMode` re-decision (allow, block, keep waiting), interrupt after pending, `resolveStartMode` branches, `nextMode`, note draft cleanup, the HUD reducer (`outcome`, skip all line, hero, panel drop), Shift+Tab cycle and guard, the note field keys, and cli flag handling are tested. The one gap is the screen level interrupt with the note open (see Minor), and a throwing `sessionKey`.
