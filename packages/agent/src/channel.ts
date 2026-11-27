import { AgentError } from "./errors.ts";

/** An unbounded, single reader queue of values that ends once. */
export interface Channel<T> {
	/** Queues a value. Ignored after `end`. */
	push(value: T): void;
	/** Queues the end marker. The reader ends after every queued value. Safe to call twice. */
	end(): void;
	/** The one reader. A second `[Symbol.asyncIterator]()` throws `agent.events_taken`. */
	readonly iterable: AsyncIterable<T>;
}

/**
 * Builds a channel. This is the session's imperative shell: the buffer and the waiting reader are
 * local state, so values are pushed in place. A reader that stops early (`return()`) ends nothing:
 * values keep buffering.
 */
export function createChannel<T>(): Channel<T> {
	// Boxed, so a buffered value is never confused with an empty buffer.
	const buffer: { readonly value: T }[] = [];
	let ended = false;
	let taken = false;
	let waiting: ((result: IteratorResult<T, undefined>) => void) | undefined;

	const wake = (result: IteratorResult<T, undefined>): boolean => {
		const resolve = waiting;
		if (resolve === undefined) return false;
		waiting = undefined;
		resolve(result);
		return true;
	};

	return {
		push(value) {
			if (ended) return;
			if (!wake({ value, done: false })) buffer.push({ value });
		},
		end() {
			if (ended) return;
			ended = true;
			wake({ value: undefined, done: true });
		},
		iterable: {
			[Symbol.asyncIterator]() {
				if (taken) {
					throw new AgentError(
						"agent.events_taken",
						"session.events already has a reader. Read it once and share the events.",
					);
				}
				taken = true;
				let stopped = false;
				return {
					next(): Promise<IteratorResult<T, undefined>> {
						if (stopped)
							return Promise.resolve({ value: undefined, done: true });
						const item = buffer.shift();
						if (item !== undefined) {
							return Promise.resolve({ value: item.value, done: false });
						}
						if (ended) return Promise.resolve({ value: undefined, done: true });
						return new Promise((resolve) => {
							waiting = resolve;
						});
					},
					return(): Promise<IteratorResult<T, undefined>> {
						stopped = true;
						wake({ value: undefined, done: true });
						return Promise.resolve({ value: undefined, done: true });
					},
				};
			},
		},
	};
}
