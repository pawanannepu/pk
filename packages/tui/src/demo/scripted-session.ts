import {
	type AgentEvent,
	MAIN_AGENT_ID,
	type PermissionAnswer,
	type RequestId,
} from "@pk/schema";
import type { TuiClock, TuiSession } from "../session.ts";
import {
	DEMO_TURN_IDS,
	type DemoEvent,
	type DemoStep,
	type DemoTurn,
	demoId,
} from "./script.ts";

/** Options for `createScriptedSession`. */
export interface ScriptedSessionOptions {
	readonly clock: TuiClock;
	/** Divides every `delayMs`. Default 1. */
	readonly speed?: number;
}

/** A push based async queue: one reader, ends once. */
function createChannel<T>(): {
	push(value: T): void;
	end(): void;
	iterable: AsyncIterable<T>;
} {
	const buffered: T[] = [];
	let waiting: ((result: IteratorResult<T>) => void) | undefined;
	let ended = false;
	return {
		push(value) {
			if (ended) return;
			if (waiting) {
				const resolve = waiting;
				waiting = undefined;
				resolve({ value, done: false });
			} else buffered.push(value);
		},
		end() {
			ended = true;
			if (waiting) {
				const resolve = waiting;
				waiting = undefined;
				resolve({ value: undefined, done: true });
			}
		},
		iterable: {
			[Symbol.asyncIterator]: () => ({
				next: () => {
					const value = buffered.shift();
					if (value !== undefined)
						return Promise.resolve({ value, done: false });
					if (ended) return Promise.resolve({ value: undefined, done: true });
					return new Promise<IteratorResult<T>>((resolve) => {
						waiting = resolve;
					});
				},
			}),
		},
	};
}

const isAllowed = (answer: PermissionAnswer): boolean =>
	answer.decision !== "deny";

/**
 * A `TuiSession` that plays a committed script instead of calling a model (spec 0003). The Nth
 * `submit` starts with `turn_start` and your message, then plays turn N (the last turn repeats). A
 * permission step waits for `respond` and plays the allowed or denied branch. Submits while a turn
 * runs are ignored. `interrupt` stops the turn and ends it as `interrupted`.
 */
export function createScriptedSession(
	script: readonly DemoTurn[],
	options: ScriptedSessionOptions,
): TuiSession {
	const { clock } = options;
	const speed =
		options.speed !== undefined && options.speed > 0 ? options.speed : 1;
	const channel = createChannel<AgentEvent>();
	const answers = new Map<RequestId, PermissionAnswer>();
	const waiters = new Map<RequestId, (answer: PermissionAnswer) => void>();
	let seq = 0;
	let submits = 0;
	let running: { cancelled: boolean; turnIndex: number } | undefined;

	const emit = (event: DemoEvent): void => {
		channel.push({
			...event,
			seq: seq++,
			at: new Date(clock.now()).toISOString(),
			agentId: MAIN_AGENT_ID,
		});
	};

	const sleep = (ms: number): Promise<void> =>
		ms <= 0
			? Promise.resolve()
			: new Promise((resolve) => {
					clock.setTimeout(resolve, ms / speed);
				});

	const answerOf = (requestId: RequestId): Promise<PermissionAnswer> => {
		const known = answers.get(requestId);
		if (known) return Promise.resolve(known);
		return new Promise((resolve) => waiters.set(requestId, resolve));
	};

	const play = async (
		steps: readonly DemoStep[],
		run: { cancelled: boolean },
	): Promise<void> => {
		for (const step of steps) {
			await sleep(step.delayMs);
			if (run.cancelled) return;
			if ("event" in step) {
				emit(step.event);
				continue;
			}
			const answer = await answerOf(step.awaitRequest);
			if (run.cancelled) return;
			await play(isAllowed(answer) ? step.allowed : step.denied, run);
		}
	};

	const turnIdOf = (index: number) =>
		DEMO_TURN_IDS[Math.min(index, DEMO_TURN_IDS.length - 1)] ??
		demoId("turn", index + 1);

	return {
		events: channel.iterable,
		submit(text) {
			if (running) return;
			const turnIndex = Math.min(submits, script.length - 1);
			submits += 1;
			const steps = script[turnIndex] ?? [];
			const run = { cancelled: false, turnIndex };
			running = run;
			emit({ type: "turn_start", turnId: turnIdOf(turnIndex) });
			emit({
				type: "message",
				message: {
					id: demoId("msg", 1000 + submits),
					at: new Date(clock.now()).toISOString(),
					role: "user",
					content: [{ type: "text", text }],
				},
			});
			void play(steps, run).finally(() => {
				if (running === run) running = undefined;
			});
		},
		respond(requestId, answer) {
			const waiter = waiters.get(requestId);
			if (waiter) {
				waiters.delete(requestId);
				waiter(answer);
			} else answers.set(requestId, answer);
		},
		interrupt() {
			const run = running;
			if (!run) return;
			run.cancelled = true;
			running = undefined;
			emit({
				type: "turn_end",
				turnId: turnIdOf(run.turnIndex),
				reason: "interrupted",
			});
		},
	};
}
