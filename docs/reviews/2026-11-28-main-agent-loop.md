# Review, main (agent loop and read_file tool), 2026-11-28

**Reviewed by**: Sonnet 5.5 (fresh reviewer, did not write the code)
**Scope**: 56 files (bun.lock ignored), uncommitted on main
**Verdict**: Approve with nits

## Summary
This change adds the agent session (the loop, queue, interrupt, permission wait, close), the `Tool` interface and `defineTool`, `read_file` with path scoping, the pure `decide` seam, the `cli` wiring (`prepareSession`, `closeWithin`) and a PTY e2e. It follows spec 0005 closely. I traced the abort races, the permission wait, the queue hand-off in `finishTurn`, close, and the path-scope logic, and I probed `resolveInProject` against real symlinks (escape, dangling, loop) and a null byte. I found no blockers and no majors. The findings are edge cases: raw Node errors surfacing as "failed unexpectedly", a dangling-symlink gap that matters once write tools land, and a few asymmetries in how abort is handled.

## Minor

### 🟡 Model-reachable fs errors surface as "failed unexpectedly" and log at error level, `packages/tools/src/path-scope.ts:55`
**Problem**: `realOrNearest` rethrows any error whose code is not `ENOENT`, `ENOTDIR`, `EACCES` or `EPERM`. I ran `resolveInProject` on a symlink loop (`ELOOP`), a path with a NUL byte (`ERR_INVALID_ARG_VALUE`) and `/dev/stdin` (`EBADF`, which is inside the "outside project" case only because it is checked after realpath). Each throws a plain Node error. `session.ts:331` then logs it with a stack at error level and sends the model `read_file failed unexpectedly: <node message>`. The ELOOP case is asserted in `path-scope.test.ts:157` as intended, but the NUL byte is just model input, not a pk bug.
**Why it matters**: The turn continues, so nothing breaks. But a model that sends a bad path fills the log with "internal error" entries, and the model gets a message that tells it nothing about how to fix the call. `fsFailure` in `read-file.ts:115` has the same shape for `stat` and `readFile` (for example `EISDIR`, `EMFILE`).
**Suggested fix**: Map `ELOOP` to a `ToolError` ("too many symbolic links"), reject a path containing NUL in the input schema or in `resolveInProject`, and keep the generic rethrow only for truly unknown codes.

### 🟡 A dangling symlink reports "does not exist" and is treated as inside the project, `packages/tools/src/path-scope.ts:33`
**Problem**: `realpath` on a dangling symlink fails with `ENOENT`, so the loop walks up to the parent and returns `real = <real parent>/<link name>`, `exists: false`. I confirmed this with `proj/dangling -> /outside/nothere`. The link itself is never inspected.
**Why it matters**: For `read_file` this is safe (it answers "does not exist"). The helper is exported and the doc says every file tool uses it. A write or edit tool (#8) that trusts `exists: false` and a "real" path inside the root would write through the link to a path outside the project.
**Suggested fix**: When the final component is missing, `lstat` it (add `lstat` to the port) or `readlink` it, and either resolve the link target and re-check scope, or refuse. Add a test for it now so #8 inherits the behavior.

### 🟡 An interrupt mid stream leaves started but unfinished calls without a `tool_result` event, `packages/agent/src/session.ts:466`
**Problem**: On abort the code closes only `toolCallsOf(reply)`, which excludes calls that got `tool_call_start` but no `tool_call_end` (`replyBlocks` drops them). The error path (`fail`, line 521) does emit a result for every started call, so the two paths disagree. If nothing finished, `blocks.length === 0` and no results are emitted at all.
**Why it matters**: Interrupting while the model is writing a call's arguments is common. The screen copes (`onTurnEnd` marks pending calls "interrupted"), so the user sees a sensible result, but other event readers (headless, later the session log) see a start with no result.
**Suggested fix**: Emit the same `REPLY_FAILED_TEXT`-style result events for every started call that did not make it into the saved reply, as `fail` does, and add a test next to the "interrupt mid stream keeps the partial reply" test.

### 🟡 The provider stream is not raced against abort the way tool runs are, `packages/agent/src/session.ts:454`
**Problem**: Tool runs go through `settle`, so an interrupt always ends them. The `for await` over `provider.stream` checks `signal.aborted` only after an event arrives. If an adapter is stuck without producing events and ignores the signal, the turn never ends and `interrupt()` has no visible effect.
**Why it matters**: `withTimeouts` and the adapter both take the signal, so this should not happen with the shipped providers. It is a single point where "abort ends the turn" depends on every provider being well behaved. `closeWithin` bounds exit at 1 s, which helps quit but not Esc.
**Suggested fix**: Race `iterator.next()` against the abort signal (the same `settle` idea), or note in the provider contract that a stream must end promptly on abort and test it for the OpenAI adapter.

### 🟡 `read_file` stats, then reads, with no bound on the read and no use of the signal, `packages/tools/src/read-file.ts:148`
**Problem**: The 10 MB cap is checked on `stat.size`, then `fs.readFile` reads the whole file. A file that grows between the two calls (a live log) is read past the cap, and `size` in the stamp can disagree with the bytes decoded. The tool never looks at `ctx.signal`; the loop discards the result after abort (tested), but the read and decode still run to the end.
**Why it matters**: Small in practice (single user, local files). The AGENTS rule is that every tool run takes the turn's signal; here it is honored only by the loop's race.
**Suggested fix**: After the read, re-check `bytes.length` against the cap, and check `ctx.signal.aborted` before the decode and format steps. A port that reads at most N bytes would be better still.

### 🟡 A throw while starting the next queued turn can wedge the session and leaves an unhandled rejection, `packages/agent/src/session.ts:564`
**Problem**: `finishTurn` runs in the `finally` of `runTurn` and calls `startTurn`, which calls `deps.newId`, `emit`, `append`. If any of those throws, `runTurn`'s promise rejects (nobody awaits `turnDone` except `close`), and `running` has already been set by `startTurn` for the turn that never started.
**Why it matters**: Unlikely with the shipped `newId` and channel. When it happens, every later `submit` queues forever and the process may exit on the unhandled rejection.
**Suggested fix**: Set `running` only after the setup that can throw, or wrap `finishTurn` in a guard that logs and clears `running`. Also give `turnDone` a `.catch` that logs.

### 🟡 `realpathSync` on the working directory is outside any error handling, `packages/cli/src/program.ts:172`
**Problem**: `realpathSync(findProjectRoot(...))` runs inside the `start` callback. If the working directory was deleted or is unreadable it throws a plain `Error`. `runScreen` only prints `pk: <message>` for `PkError`, so this rethrows and ends in the process guard or an uncaught crash.
**Why it matters**: Rare, but it is the one setup step in AC-16 that is not mapped to `pk: <message>` and exit 1.
**Suggested fix**: Catch it in the wrapper and throw a `PkError` ("pk could not read the working directory") or print it directly with `EXIT.failure`.

## Nits
- ⚪ `packages/tools/src/read-file.ts:100`, `Buffer.byteLength` uses a Node global in a package whose AGENTS note says core is runtime neutral. `new TextEncoder().encode(s).length` avoids it.
- ⚪ `packages/agent/src/session.ts:312`, `tool.execute(...)` is called as an argument to `settle`, so a custom `Tool` that throws synchronously (rather than rejecting) skips the `threw` branch and ends the turn with `agent.internal`. `defineTool` is async so the shipped tools are fine; wrapping the call in an async arrow makes the contract robust.
- ⚪ `packages/agent/src/session.ts:512`, `maxTurns` is checked only after tools run, so with `maxTurns: 1` a model that ends without calls is fine but one with calls still runs them before `turn_limit`. This matches the spec; a comment would help the next reader.
- ⚪ `packages/tools/src/read-file.ts:61`, lines split on `\n` only, so a file with old Mac `\r` endings is one line cut at 2000 characters. Probably fine; worth a line in the tool description or spec.
- ⚪ `packages/agent/src/results.ts:65`, the `details` parse uses `JsonValue.safeParse` and silently drops details on failure. A `log.debug` would help when a tool returns details the screen never shows.

## Strengths
- The abort and race handling is careful and tested: `settle` discards a late tool outcome and its stamps, `waitForAnswer` unregisters on abort, and `finishTurn` emits `turn_end`, clears state and starts the next prompt in one synchronous step, so no other call can sneak in between.
- `path-scope.ts` checks the real path against the real root after resolving symlinks, with the lexical `..` check only as an early refusal. I confirmed an escape link, `..`, `sub/../../x` and absolute outside paths are all refused, and the `..foo` directory name edge is handled by `escapes`.
- Pure pieces (`foldEvent`, `replyBlocks`, `formatWindow`, `decide`, `foldStamps`) are separated from the shell, all exhaustive with `never` checks, and Zod parses every tool input on both entries.
- The error flow never leaks internals: unexpected errors get a fixed `agent.internal` text on the screen, the raw error and stack go to the log, and all error results are redacted then cut.
- The PTY e2e drives the real compiled binary through the fake provider, a real `read_file` call and Ctrl+C exit 130 with the terminal restored.

## Test coverage
Strong. `session.test.ts` has about 35 tests covering the happy path, turn limit, bad calls, redaction and cutting, retries, mid stream failure, internal errors, empty and cut replies, usage, queue order, interrupt in the same tick, interrupt during a permission wait, late tool outcomes, close, the second reader, `allow_session`, deny with a note, stale answers and the ledger. `read-file.test.ts` and `path-scope.test.ts` use both an in memory fs and real files with symlinks. Gaps, all minor: no test for an interrupt while a call's arguments are still streaming (finding above), no test for a NUL byte, symlink loop or dangling link reaching `read_file` through the real `nodeFileSystem`, no test for `nodeFileSystem` itself in `session-setup.test.ts` beyond wiring, and nothing exercises a throw inside `finishTurn`.
