import { isPkError, type Logger, redact } from "@pk/env";
import { decide } from "@pk/permissions";
import {
	isProviderError,
	type Provider,
	type RetryInfo,
	retryNoticeText,
} from "@pk/provider";
import {
	type AgentEvent,
	type AssistantContentBlock,
	type AssistantMessage,
	type CallId,
	MAIN_AGENT_ID,
	type Message,
	type MessageId,
	type ModelRef,
	type NewId,
	type PermissionAnswer,
	type ProviderStreamEvent,
	type RequestId,
	repairConversation,
	type StopReason,
	type ToolCallBlock,
	type ToolName,
	type ToolResultBlock,
	type TurnEndReason,
	type TurnError,
	type TurnId,
	toolCallsOf,
} from "@pk/schema";
import type { FileStamp, FileSystem, Tool, ToolOutcome } from "@pk/tools";
import { type Channel, createChannel } from "./channel.ts";
import { AgentError } from "./errors.ts";
import { EMPTY_FOLD, foldEvent, type ReplyFold, replyBlocks } from "./reply.ts";
import {
	deniedText,
	errorOutcome,
	INTERNAL_ERROR_TEXT,
	INTERRUPTED_BEFORE_TEXT,
	INTERRUPTED_DURING_TEXT,
	inputErrorText,
	REPLY_FAILED_TEXT,
	resultBlock,
	unexpectedText,
	unknownToolText,
} from "./results.ts";
import { placeholderSystemPrompt } from "./system-prompt.ts";

/** Everything a session needs, wired by `cli` with plain arguments. */
export interface AgentDeps {
	/** Already wrapped in `withRetry` (and `withTimeouts` for real adapters) by the registry. */
	readonly provider: Provider;
	readonly model: ModelRef;
	/** Offered to the model in this order. Names must be unique. */
	readonly tools: readonly Tool[];
	readonly fs: FileSystem;
	/** The project root, as a real path. */
	readonly projectRoot: string;
	/** `YYYY-MM-DD`, fixed for the session. */
	readonly today: string;
	/** Model calls per prompt before the turn ends `turn_limit`. */
	readonly maxTurns: number;
	readonly newId: NewId;
	/** Epoch milliseconds. */
	readonly now: () => number;
	readonly logger: Logger;
}

/**
 * One conversation with the model. Satisfies the screen's `TuiSession` port, plus `close()`, and a
 * read only view of its conversation and read ledger.
 */
export interface AgentSession {
	/** Every event, in order, for exactly one reader. Ends after `close()`. */
	readonly events: AsyncIterable<AgentEvent>;
	/** Runs your prompt as a turn, or queues it while a turn runs. Empty prompts are ignored. */
	submit(text: string): void;
	/** Answers the pending permission request. A stale or unknown `requestId` is ignored. */
	respond(requestId: RequestId, answer: PermissionAnswer): void;
	/** Stops the running turn and drops the queue. Does nothing while idle. */
	interrupt(): void;
	/** Ends the running turn, drops the queue silently and ends `events`. Safe to call twice. */
	close(): Promise<void>;
	/** The conversation so far. */
	readonly conversation: readonly Message[];
	/** Real path to the latest `FileStamp` of each file read this session. */
	readonly ledger: ReadonlyMap<string, FileStamp>;
}

/** An `AgentEvent` without its envelope, which `emit` adds. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
	? Omit<T, K>
	: never;
type EventBody = DistributiveOmit<AgentEvent, "seq" | "at" | "agentId">;

/** How a turn ended. */
interface TurnEnd {
	readonly reason: TurnEndReason;
	readonly error?: TurnError;
}

/** The reply being streamed: its id and the calls whose `tool_call_start` was emitted. */
interface Streaming {
	readonly messageId: MessageId;
	readonly started: readonly CallId[];
}

/** What a race between a tool run and the turn's abort came to. */
type Settled<T> =
	| { readonly kind: "done"; readonly value: T }
	| { readonly kind: "threw"; readonly error: unknown }
	| { readonly kind: "aborted" };

/** Resolves with the promise's outcome, or `aborted` if the signal aborts first. */
function settle<T>(
	promise: Promise<T>,
	signal: AbortSignal,
): Promise<Settled<T>> {
	return new Promise((resolve) => {
		const onAbort = () => resolve({ kind: "aborted" });
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
		void promise.then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve({ kind: "done", value });
			},
			(error: unknown) => {
				signal.removeEventListener("abort", onAbort);
				resolve({ kind: "threw", error });
			},
		);
	});
}

/** The ledger with `stamps` folded in, last read wins. Pure. */
export function foldStamps(
	ledger: ReadonlyMap<string, FileStamp>,
	stamps: readonly FileStamp[],
): ReadonlyMap<string, FileStamp> {
	if (stamps.length === 0) return ledger;
	return new Map([
		...ledger,
		...stamps.map((s): [string, FileStamp] => [s.path, s]),
	]);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string | undefined {
	return error instanceof Error ? error.stack : undefined;
}

/**
 * Builds a session (spec 0005). Each turn streams the conversation to the model, runs the calls in
 * the reply one at a time (asking `decide` first), sends the results back, and repeats until the
 * model is done, you interrupt, or `maxTurns` model calls were made. Building replies and results
 * are pure functions; this is the shell around them. Throws `agent.duplicate_tool` for a wiring bug.
 */
export function createAgentSession(deps: AgentDeps): AgentSession {
	const toolNames = deps.tools.map((t) => t.definition.name);
	const duplicate = toolNames.find((name, i) => toolNames.indexOf(name) !== i);
	if (duplicate !== undefined) {
		throw new AgentError(
			"agent.duplicate_tool",
			`Two tools are named "${duplicate}". Tool names must be unique.`,
		);
	}
	const toolsByName: ReadonlyMap<string, Tool> = new Map(
		deps.tools.map((t) => [t.definition.name, t]),
	);
	const definitions = deps.tools.map((t) => t.definition);
	const system = placeholderSystemPrompt({
		projectRoot: deps.projectRoot,
		today: deps.today,
		toolNames,
	});
	const origin = { api: deps.provider.api, model: deps.model };
	const log = deps.logger;
	const channel: Channel<AgentEvent> = createChannel();

	// Session state. Every field is replaced, never changed in place.
	let seq = 0;
	let conversation: readonly Message[] = [];
	let queue: readonly string[] = [];
	let ledger: ReadonlyMap<string, FileStamp> = new Map();
	let sessionAllows: ReadonlySet<ToolName> = new Set();
	let running:
		| { readonly turnId: TurnId; readonly controller: AbortController }
		| undefined;
	let pending:
		| {
				readonly requestId: RequestId;
				readonly resolve: (answer: PermissionAnswer) => void;
		  }
		| undefined;
	let turnDone: Promise<void> = Promise.resolve();
	let closed = false;
	let closing: Promise<void> | undefined;

	const iso = (): string => new Date(deps.now()).toISOString();

	const emit = (body: EventBody): void => {
		const event: AgentEvent = {
			...body,
			seq,
			at: iso(),
			agentId: MAIN_AGENT_ID,
		};
		seq += 1;
		channel.push(event);
	};

	const append = (message: Message): void => {
		conversation = [...conversation, message];
		emit({ type: "message", message });
	};

	/** Emits each result's `tool_result` event, then the one results message. */
	const appendResults = (results: readonly ToolResultBlock[]): void => {
		if (results.length === 0) return;
		append({
			id: deps.newId("msg"),
			role: "user",
			at: iso(),
			content: results,
		});
	};

	const onRetry = (info: RetryInfo): void =>
		emit({
			type: "notice",
			level: "warning",
			code: "provider.retrying",
			text: retryNoticeText(info),
		});

	/** Waits for `respond` with this id, or `undefined` when the turn aborts first. */
	const waitForAnswer = (
		requestId: RequestId,
		signal: AbortSignal,
	): Promise<PermissionAnswer | undefined> =>
		new Promise((resolve) => {
			if (signal.aborted) {
				resolve(undefined);
				return;
			}
			const onAbort = () => {
				if (pending?.requestId === requestId) pending = undefined;
				resolve(undefined);
			};
			signal.addEventListener("abort", onAbort, { once: true });
			pending = {
				requestId,
				resolve: (answer) => {
					signal.removeEventListener("abort", onAbort);
					resolve(answer);
				},
			};
		});

	/** Runs one call to its result: checks, permission, the raced run, and the ledger fold. */
	const runCall = async (
		turnId: TurnId,
		call: ToolCallBlock,
		signal: AbortSignal,
	): Promise<{ result: ToolResultBlock; durationMs: number }> => {
		const finish = (outcome: ToolOutcome, durationMs = 0) => ({
			result: resultBlock(call.id, outcome),
			durationMs,
		});
		if (signal.aborted) return finish(errorOutcome(INTERRUPTED_BEFORE_TEXT));
		const tool = toolsByName.get(call.name);
		if (tool === undefined) {
			return finish(errorOutcome(unknownToolText(call.name, toolNames)));
		}
		if (call.inputError !== undefined) {
			return finish(errorOutcome(inputErrorText(call.inputError)));
		}
		const validated = tool.validate(call.input);
		if (!validated.ok) return finish(validated.outcome);

		const kind = tool.definition.kind;
		const decision = decide({ tool: call.name, kind }, { sessionAllows });
		if (decision.decision === "ask") {
			const requestId = deps.newId("req");
			emit({ type: "permission_request", requestId, call, kind });
			const answer = await waitForAnswer(requestId, signal);
			if (answer === undefined || signal.aborted) {
				return finish(errorOutcome(INTERRUPTED_BEFORE_TEXT));
			}
			switch (answer.decision) {
				case "deny":
					return finish(errorOutcome(deniedText(answer)));
				case "allow_session":
					sessionAllows = new Set([...sessionAllows, call.name]);
					break;
				case "allow_once":
					break;
				default: {
					const _exhaustive: never = answer;
					return _exhaustive;
				}
			}
		}

		emit({ type: "tool_run_start", callId: call.id });
		const startedAt = deps.now();
		const settled = await settle(
			tool.execute(validated.input, {
				signal,
				projectRoot: deps.projectRoot,
				fs: deps.fs,
				ledger,
			}),
			signal,
		);
		const durationMs = Math.max(0, Math.floor(deps.now() - startedAt));
		log.debug("tool run", {
			turnId,
			tool: call.name,
			callId: call.id,
			durationMs,
		});
		switch (settled.kind) {
			case "aborted":
				return finish(errorOutcome(INTERRUPTED_DURING_TEXT), durationMs);
			case "threw": {
				const { error } = settled;
				if (isPkError(error)) {
					return finish(errorOutcome(error.message), durationMs);
				}
				log.error("tool failed unexpectedly", {
					turnId,
					tool: call.name,
					error: errorMessage(error),
					stack: errorStack(error),
				});
				return finish(
					errorOutcome(unexpectedText(call.name, errorMessage(error))),
					durationMs,
				);
			}
			case "done": {
				const outcome = settled.value;
				if (!outcome.isError) ledger = foldStamps(ledger, outcome.stamps ?? []);
				return finish(outcome, durationMs);
			}
			default: {
				const _exhaustive: never = settled;
				return _exhaustive;
			}
		}
	};

	const assistant = (
		id: MessageId,
		stopReason: StopReason,
		content: readonly AssistantContentBlock[],
	): AssistantMessage => ({
		id,
		role: "assistant",
		at: iso(),
		model: deps.model,
		stopReason,
		content,
	});

	const emitUsage = (usage: NonNullable<ReplyFold["usage"]>): void =>
		emit({
			type: "usage",
			model: deps.model,
			usage: usage.usage,
			cost:
				usage.providerCostMicroUsd === undefined
					? { source: "unknown" }
					: { source: "provider", microUsd: usage.providerCostMicroUsd },
		});

	/** Emits the screen event for one stream event, if it has one. Returns the started calls. */
	const emitStreamEvent = (
		event: ProviderStreamEvent,
		streaming: Streaming,
	): Streaming => {
		const { messageId } = streaming;
		switch (event.type) {
			case "text_delta":
				emit({ type: "text_delta", messageId, text: event.text });
				return streaming;
			case "reasoning_delta":
				emit({ type: "reasoning_delta", messageId, text: event.text });
				return streaming;
			case "tool_call_start":
				emit({
					type: "tool_call_start",
					messageId,
					callId: event.callId,
					name: event.name,
				});
				return { ...streaming, started: [...streaming.started, event.callId] };
			case "reasoning_replay":
			case "tool_call_delta":
			case "tool_call_end":
			case "usage":
			case "stop":
				return streaming;
			default: {
				const _exhaustive: never = event;
				return _exhaustive;
			}
		}
	};

	/** Every synthetic result for these calls, each emitted, then the results message. */
	const closeCalls = (calls: readonly ToolCallBlock[], text: string): void => {
		const results = calls.map((call) =>
			resultBlock(call.id, errorOutcome(text)),
		);
		for (const result of results)
			emit({ type: "tool_result", result, durationMs: 0 });
		appendResults(results);
	};

	const runTurn = async (
		turnId: TurnId,
		signal: AbortSignal,
	): Promise<void> => {
		let modelCalls = 0;
		let streaming: Streaming | undefined;
		let results: readonly ToolResultBlock[] | undefined;
		let end: TurnEnd = {
			reason: "error",
			error: { code: "agent.internal", message: INTERNAL_ERROR_TEXT },
		};

		const loop = async (): Promise<TurnEnd> => {
			// Lets an interrupt() in the same tick as submit() land before any model call.
			await Promise.resolve();
			for (;;) {
				if (signal.aborted) return { reason: "interrupted" };
				modelCalls += 1;
				const messageId = deps.newId("msg");
				streaming = { messageId, started: [] };
				let fold = EMPTY_FOLD;
				const request = {
					model: deps.model,
					system,
					messages: conversation,
					tools: definitions,
				};
				for await (const event of deps.provider.stream(request, {
					signal,
					onRetry,
				})) {
					if (signal.aborted) break;
					fold = foldEvent(fold, event);
					streaming = emitStreamEvent(event, streaming);
				}
				streaming = undefined;
				if (fold.usage !== undefined) emitUsage(fold.usage);
				const blocks = replyBlocks(fold, origin);

				if (signal.aborted || fold.stop === "aborted") {
					if (blocks.length > 0) {
						const reply = assistant(messageId, "aborted", blocks);
						append(reply);
						closeCalls(toolCallsOf(reply), INTERRUPTED_BEFORE_TEXT);
					}
					return { reason: "interrupted" };
				}
				if (blocks.length === 0) {
					emit({
						type: "notice",
						level: "warning",
						code: "agent.empty_reply",
						text: "The model sent an empty reply.",
					});
					return { reason: "done" };
				}
				const stopReason = fold.stop ?? "other";
				const reply = assistant(messageId, stopReason, blocks);
				append(reply);
				const calls = toolCallsOf(reply);
				if (calls.length === 0) {
					if (stopReason === "max_tokens") {
						emit({
							type: "notice",
							level: "warning",
							code: "agent.output_cut",
							text: "The reply hit the output limit. Ask pk to continue.",
						});
					}
					return { reason: "done" };
				}

				results = [];
				for (const call of calls) {
					const ran = await runCall(turnId, call, signal);
					results = [...results, ran.result];
					emit({
						type: "tool_result",
						result: ran.result,
						durationMs: ran.durationMs,
					});
				}
				appendResults(results);
				results = undefined;
				if (signal.aborted) return { reason: "interrupted" };
				if (modelCalls >= deps.maxTurns) {
					log.info(`turn limit ${deps.maxTurns} reached`, { turnId });
					return { reason: "turn_limit" };
				}
			}
		};

		/** Closes what the failure left open and picks the turn's end. */
		const fail = (thrown: unknown): TurnEnd => {
			for (const callId of streaming?.started ?? []) {
				emit({
					type: "tool_result",
					result: resultBlock(callId, errorOutcome(REPLY_FAILED_TEXT)),
					durationMs: 0,
				});
			}
			if (results !== undefined) appendResults(results);
			conversation = repairConversation(conversation, {
				newId: deps.newId,
				closePendingTail: true,
			}).messages;
			if (signal.aborted) return { reason: "interrupted" };
			if (isProviderError(thrown)) {
				log.info("turn failed", { turnId, code: thrown.code });
				return {
					reason: "error",
					error: { code: thrown.code, message: redact(thrown.message) },
				};
			}
			log.error("turn failed with an internal error", {
				turnId,
				error: errorMessage(thrown),
				stack: errorStack(thrown),
			});
			return {
				reason: "error",
				error: { code: "agent.internal", message: INTERNAL_ERROR_TEXT },
			};
		};

		try {
			end = await loop();
		} catch (thrown) {
			try {
				end = fail(thrown);
			} catch (again) {
				log.error("could not close a failed turn", {
					turnId,
					error: errorMessage(again),
				});
			}
		} finally {
			finishTurn(turnId, end);
		}
	};

	/** Emits `turn_end`, clears the turn and starts the next queued prompt, in one synchronous step. */
	const finishTurn = (turnId: TurnId, end: TurnEnd): void => {
		emit({
			type: "turn_end",
			turnId,
			reason: end.reason,
			...(end.error === undefined ? {} : { error: end.error }),
		});
		log.info("turn end", { turnId, reason: end.reason, code: end.error?.code });
		running = undefined;
		pending = undefined;
		const [next, ...rest] = queue;
		if (closed || next === undefined) return;
		queue = rest;
		startTurn(next);
	};

	const startTurn = (text: string): void => {
		const turnId = deps.newId("turn");
		const controller = new AbortController();
		running = { turnId, controller };
		emit({ type: "turn_start", turnId });
		append({
			id: deps.newId("msg"),
			role: "user",
			at: iso(),
			content: [{ type: "text", text }],
		});
		log.info("turn start", { turnId });
		turnDone = runTurn(turnId, controller.signal);
	};

	return {
		events: channel.iterable,
		submit(text) {
			if (closed || text.trim() === "") return;
			if (running !== undefined) {
				queue = [...queue, text];
				return;
			}
			startTurn(text);
		},
		respond(requestId, answer) {
			const waiting = pending;
			if (waiting === undefined || waiting.requestId !== requestId) {
				log.debug("permission answer ignored", { requestId });
				return;
			}
			pending = undefined;
			waiting.resolve(answer);
		},
		interrupt() {
			if (running === undefined) return;
			const dropped = queue.length;
			queue = [];
			running.controller.abort();
			if (dropped > 0) {
				emit({
					type: "notice",
					level: "info",
					code: "agent.queue_cleared",
					text: `Dropped ${dropped} queued message(s).`,
				});
			}
		},
		close() {
			if (closing !== undefined) return closing;
			closed = true;
			queue = [];
			const turn = running;
			closing = (async () => {
				if (turn !== undefined) {
					turn.controller.abort();
					await turnDone;
				}
				channel.end();
			})();
			return closing;
		},
		get conversation() {
			return conversation;
		},
		get ledger() {
			return ledger;
		},
	};
}
