/**
 * Shared helpers for this package's tests and for other packages' provider tests. Not exported from
 * `index.ts`; imported only by `*.test.ts` files.
 */
import {
	CallId,
	type ModelRequest,
	type ProviderStreamEvent,
} from "@pk/schema";
import type { Sleep } from "./types.ts";

/** A fixed, valid call id for `n` (two digits). */
export const callId = (n: number): CallId =>
	CallId.parse(`call_01JDX8Z3QK5V7W9Y0A2B4C6D${String(n).padStart(2, "0")}`);

/** A small request for model `fake/fake`. */
export const REQUEST: ModelRequest = {
	model: { provider: "fake", model: "fake" },
	system: "be brief",
	messages: [],
	tools: [],
};

/** Reads a stream to the end and returns its events. */
export async function collect(
	stream: AsyncIterable<ProviderStreamEvent>,
): Promise<ProviderStreamEvent[]> {
	const events: ProviderStreamEvent[] = [];
	for await (const event of stream) events.push(event);
	return events;
}

/** Reads a stream and returns its events plus the error it threw, if any. */
export async function settle(
	stream: AsyncIterable<ProviderStreamEvent>,
): Promise<{ events: ProviderStreamEvent[]; error: unknown }> {
	const events: ProviderStreamEvent[] = [];
	try {
		for await (const event of stream) events.push(event);
		return { events, error: undefined };
	} catch (error) {
		return { events, error };
	}
}

/** A `Sleep` that records each wait and resolves at once (or runs `during` first). */
export function recordingSleep(during?: (ms: number) => void): {
	sleep: Sleep;
	waits: number[];
} {
	const waits: number[] = [];
	return {
		waits,
		sleep: async (ms) => {
			waits.push(ms);
			during?.(ms);
		},
	};
}

/** A manual timer for `withTimeouts`: fire timers by hand and see which are still pending. */
export function manualTimers(): {
	setTimer: (ms: number, fire: () => void) => () => void;
	pending: () => number[];
	fireAll: () => void;
} {
	const timers = new Map<number, { ms: number; fire: () => void }>();
	let next = 0;
	return {
		setTimer: (ms, fire) => {
			const id = next++;
			timers.set(id, { ms, fire });
			return () => timers.delete(id);
		},
		pending: () => [...timers.values()].map((t) => t.ms),
		fireAll: () => {
			const all = [...timers.entries()];
			timers.clear();
			for (const [, timer] of all) timer.fire();
		},
	};
}
