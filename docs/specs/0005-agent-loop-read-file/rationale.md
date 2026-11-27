# 0005. Agent loop and read file tool: rationale

The decision record behind [index.md](index.md). `/develop` builds from the index; this file explains why.

## Context

pk has its foundations: the shapes every package shares (spec 0002), a full screen UI that already draws tool lines, permission prompts and error blocks from a scripted session (spec 0003), and a provider layer with one streaming method, one retry policy and an offline fake (spec 0004). What it lacks is the thing in the middle: the loop that sends a conversation to a model, runs the tools it asks for, and feeds the results back. Until that exists, `pk` prints "not built yet", and every later feature (permissions, edit tools, sessions, headless) has nothing real to plug into. The project builds by Tracer Bullet, so this slice has to touch every layer (terminal, loop, provider, permissions, tools, file system) in its thinnest real form, even where a layer does almost nothing yet.

Several forces pull on the design. The core must stay runtime neutral and functional: pure functions over readonly data, I/O passed in, no module singletons, `PkError` codes caught at the loop boundary. The event contract is already fixed: one ordered stream, exactly one `turn_end` per turn, questions as events answered by `respond`, and an abort that ends the stream rather than throwing. The `TuiSession` port was written for this session to satisfy as is. One `AbortSignal` must reach every provider call, tool run and permission wait. And the loop has to fail soft: a bad tool call, a flaky provider or a runaway model must never cost the user the session.

The first tool, reading a file, is the most frequent thing a coding agent does, so its output shape (line numbers, windowing, caps) decides how well models navigate code, and its safety rules decide whether pk is trustworthy before permission prompts exist. Feature #8 also needs to know what was read, and when, to refuse blind edits. Deciding that seam later means rewiring the tool context and the loop.

Not deciding leaves `/develop` to invent the turn limit default, the synthetic texts the model sees for denied and interrupted calls (spec 0002 left these to #6), the event order the screen depends on, and how far a model can reach on disk.

## Options considered

### Option 1: one session object with an imperative shell around pure step functions (chosen)

`createAgentSession` returns an object holding readonly state that it replaces on each step. A turn is an `async` loop: build the request, `for await` over the provider stream folding events into a reply with a pure function, decide the next step with a pure function, run each call through `decide` and `Tool.execute`, append results, repeat. Events go out through a single reader channel. The abort controller, the queue and the pending permission resolver live in the shell.

**Pros**:
- The control flow reads top to bottom like the spec. `await` points are exactly where the signal is checked.
- The hard logic (reply assembly, next step choice, result wrapping, limit counting, ledger folding) is pure and unit tested with plain data.
- It satisfies `TuiSession` directly, and `headless` (#26) can drive the same object.

**Cons**:
- The shell holds mutable references (the current state, the controller, the resolver), so discipline is needed to keep every state change a replacement.
- Interleavings (interrupt during a permission wait, close during a stream) are tested through the shell, not proven by types.

### Option 2: a pure state machine with effects as data

Model the whole session as `reduce(state, input) → { state, effects }`, Elm style. Inputs are user actions and provider or tool results. Effects are commands ("call the model", "run this tool", "emit this event") that a small interpreter executes.

**Pros**:
- Every transition, including interrupt and close races, is a pure function, testable without async.
- Replay and persistence (#24) fall out naturally: the inputs are the log.

**Cons**:
- Streaming does not fit well: every delta becomes an input and a round trip through the reducer, and cancelling an in flight effect needs an effect id scheme.
- Much more machinery (input and effect unions, an interpreter, effect cancellation) before the first file is read, which is the opposite of a thin tracer bullet.
- It is harder for the next contributor to follow than an `async` loop.

### Option 3: an event emitter loop with callbacks

The session is an `EventEmitter`. The loop pushes events with `emit`, frontends subscribe, and permission prompts resolve through callbacks.

**Pros**:
- Familiar Node pattern, and multiple listeners for free (a persistence listener, a UI listener).
- No channel or single reader bookkeeping.

**Cons**:
- It breaks the fixed contract: spec 0001 says one reader of an `AsyncIterable`, with persistence as a tap inside `agent`, not a second listener.
- No backpressure, and listener errors surface far from their cause.
- A class with mutable listener lists goes against the functional rules.

## Rationale

Option 1 wins because it fits the two fixed contracts exactly (the single reader `AsyncIterable` from spec 0001 and the `TuiSession` port from spec 0003) while keeping the functional rule where it matters: the decisions are pure, and the side effects (stream, tool run, wait) sit at visible `await` points that share one signal. That is what makes the abort guarantees (AC-6) and the event order (AC-2) tractable. Option 2 would prove interleavings by construction, but it pays for that with a framework this slice does not need, and it handles streaming awkwardly. The tracer bullet wants the thinnest real thread. Option 3 contradicts an accepted decision.

The smaller calls follow from the same forces. Counting model calls for the turn limit bounds cost directly and is easy to explain, and 50 leaves room for real multi step work while stopping a runaway loop early. Calls run one at a time so events stay deterministic and permission prompts never overlap. Parallel reads are an optimisation to measure later. `read_file` stays inside the project root because permissions arrive a slice later, and least privilege says the default must be the narrow one. The `cat -n` format and the 2,000 line and 2,000 character caps are familiar shapes that models handle well, and the footer tells the model exactly how to read on. The ledger is recorded now, as stamps returned from the tool and folded by the loop, so tools stay pure toward the session and #8 only consumes it. The permission seam is wired now, tested with a tool that exists only in tests, because retrofitting a wait, an abort and a deny path into a finished loop is where #7 would otherwise spend its time.

Some calls were made during writing rather than asked:

- **Setup errors.** A missing model or an unknown provider fails before the screen opens, because the screen needs a model to draw and these are setup mistakes, not runtime failures. A missing or rejected key shows on the first turn, as chosen, because key resolution is lazy and the error block already exists. The runner up was letting the screen open with a placeholder model. It was rejected because it shows a wrong header.
- **Tool parsing inside tools.** `defineTool` keeps each tool's Zod schema inside `@pk/tools`, so `agent` never imports `zod`. The runner up was handing `agent` the raw schema, which would widen its boundary.
- **No `AppServices` yet.** Nothing in #6 needs it. Declaring an empty interface invites guesses.

## Cross check (2026-11-27)

An independent review on another model found 22 gaps. Five contradicted existing code:
- the screen recognises a denial only by the exact text `denied by user`;
- Ctrl+C exits 130, not 0, and quit had no point where the session closed;
- the screen already draws its own turn limit line;
- `findProjectRoot` takes `(cwd, home, exists)`;
- `ERROR_HINTS` has no `provider.missing_key`.

The rest were undecided details:
- events on the unusual paths;
- checking input before asking permission;
- empty replies;
- abort races and the synchronous turn boundary;
- `close()` on a reader that is not draining;
- the macOS `/tmp` symlink in the path check;
- a 4 MB worst case output, now capped at 100 KB;
- several value sources in `cli`.

The engineer chose to apply every recommended fix. Two soundness notes became #8 follow ups: discarding a late outcome is unsafe for writes, and "last read wins" loses coverage.

## Interview record

The engineer chose, stage by stage:

| Dimension | Choice |
|---|---|
| What counts toward `maxTurns` | model calls per prompt |
| Default `maxTurns` | 50 |
| Submit while a turn runs | queue, run in order |
| Entry points | interactive `pk` only, proven by `test:e2e` with `PK_FAKE_SCRIPT` |
| `read_file` path scope | project root only, outside paths refused until #7 |
| Output caps | 2,000 lines, 2,000 characters per line |
| Line format | `cat -n` style |
| Read ledger | record now |
| Permissions | minimal `decide` seam now |
| Several calls in one reply | one at a time, in order |
| File system access | passed in `FileSystem` port |
| Missing or bad API key | shown on the first turn |
| Provider fails mid reply | drop the partial reply from history |
| Queue on interrupt | cleared, with a notice |
| Placeholder system prompt | short neutral paragraph, versioned |
| Data model | confirmed as sketched |
| `allow_session` covers | that tool name |
| Relative paths resolve against | the project root |
| Large files | refused above 10 MB |
| `max_tokens` with no calls | end `done` with a warning notice |
| `maxOutputTokens` | left unset |
| References | none |
