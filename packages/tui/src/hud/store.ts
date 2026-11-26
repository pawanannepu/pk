import type { AgentEvent } from "@pk/schema";
import { type Accessor, batch, createSignal } from "solid-js";
import { FLUSH_INTERVAL_MS } from "../hud-constants.ts";
import type { TimerHandle, TuiClock } from "../session.ts";
import { reduceHud } from "./reduce.ts";
import type { HudAction, HudState } from "./state.ts";

/** The screen's state, fed in batches (AC-25). */
export interface HudStore {
	readonly state: Accessor<HudState>;
	/** Queues an event; the queue is applied at most every `FLUSH_INTERVAL_MS`. */
	enqueue(action: HudAction): void;
	/** Applies any queued events, then this action, now. For the screen's own actions (Enter, y/a/n). */
	dispatch(action: HudAction): void;
	/** How many times state was set, for the batching test. */
	flushes(): number;
	/** Clears the pending flush timer. */
	dispose(): void;
}

/** Builds the store. The queue lives here, at the edge; `reduceHud` stays pure. */
export function createHudStore(initial: HudState, clock: TuiClock): HudStore {
	const [state, setState] = createSignal(initial);
	let queue: HudAction[] = [];
	let timer: TimerHandle | undefined;
	let lastFlush = Number.NEGATIVE_INFINITY;
	let count = 0;

	const apply = (actions: readonly HudAction[]): void => {
		if (actions.length === 0) return;
		count += 1;
		batch(() => setState((current) => actions.reduce(reduceHud, current)));
	};

	const flush = (): void => {
		timer = undefined;
		lastFlush = clock.now();
		const actions = queue;
		queue = [];
		apply(actions);
	};

	return {
		state,
		enqueue(action) {
			queue.push(action);
			if (timer !== undefined) return;
			const wait = Math.max(0, lastFlush + FLUSH_INTERVAL_MS - clock.now());
			timer = clock.setTimeout(flush, wait);
		},
		dispatch(action) {
			if (timer !== undefined) clock.clearTimeout(timer);
			timer = undefined;
			const actions = [...queue, action];
			queue = [];
			lastFlush = clock.now();
			apply(actions);
		},
		flushes: () => count,
		dispose() {
			if (timer !== undefined) clock.clearTimeout(timer);
			timer = undefined;
			queue = [];
		},
	};
}

/**
 * Reads the session's events into the store until the stream ends. An end becomes `ui_stream_end`
 * and a throw becomes `ui_stream_failed`, so the screen never crashes on a broken session (AC-14).
 */
export async function pumpEvents(
	events: AsyncIterable<AgentEvent>,
	enqueue: (action: HudAction) => void,
	isStopped: () => boolean = () => false,
): Promise<void> {
	try {
		for await (const event of events) {
			if (isStopped()) return;
			enqueue(event);
		}
		if (!isStopped()) enqueue({ type: "ui_stream_end" });
	} catch (error) {
		if (isStopped()) return;
		enqueue({
			type: "ui_stream_failed",
			message: error instanceof Error ? error.message : String(error),
		});
	}
}
