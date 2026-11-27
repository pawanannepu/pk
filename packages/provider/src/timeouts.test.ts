import { describe, expect, test } from "bun:test";
import { silentLogger } from "@pk/env";
import type { ProviderStreamEvent } from "@pk/schema";
import type { ProviderError } from "./errors.ts";
import { withRetry } from "./retry.ts";
import {
	manualTimers,
	REQUEST,
	recordingSleep,
	settle,
} from "./test-support.ts";
import { withTimeouts } from "./timeouts.ts";
import { ABORTED_STOP, type Provider } from "./types.ts";

/** Yields `before` events, then hangs until its signal aborts (like a silent server), then stops aborted. */
function hanging(
	before: ProviderStreamEvent[],
): Provider & { signals: AbortSignal[]; closed: () => number } {
	const signals: AbortSignal[] = [];
	let closed = 0;
	return {
		id: "groq",
		api: "openai_chat",
		signals,
		closed: () => closed,
		async *stream(_request, { signal }) {
			signals.push(signal);
			try {
				for (const event of before) yield event;
				await new Promise<void>((resolve) => {
					if (signal.aborted) resolve();
					signal.addEventListener("abort", () => resolve(), { once: true });
				});
				yield ABORTED_STOP;
			} finally {
				closed += 1;
			}
		},
	};
}

/** Lets pending promise callbacks run. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Counts listeners on a signal by wrapping add and remove. */
function countedSignal(): {
	controller: AbortController;
	listeners: () => number;
} {
	const controller = new AbortController();
	let count = 0;
	const add = controller.signal.addEventListener.bind(controller.signal);
	const remove = controller.signal.removeEventListener.bind(controller.signal);
	controller.signal.addEventListener = ((...args: Parameters<typeof add>) => {
		count += 1;
		add(...args);
	}) as typeof add;
	controller.signal.removeEventListener = ((
		...args: Parameters<typeof remove>
	) => {
		count -= 1;
		remove(...args);
	}) as typeof remove;
	return { controller, listeners: () => count };
}

describe("withTimeouts (AC-8)", () => {
	test("no first event within 300s is provider.timeout, and the inner call is aborted", async () => {
		const timers = manualTimers();
		const inner = hanging([]);
		const provider = withTimeouts(inner, { setTimer: timers.setTimer });
		const running = settle(
			provider.stream(REQUEST, { signal: new AbortController().signal }),
		);
		await tick();
		expect(timers.pending()).toEqual([300_000]);
		timers.fireAll();
		const out = await running;
		const error = out.error as ProviderError;
		expect([error.code, error.retryable, error.message]).toEqual([
			"provider.timeout",
			true,
			"groq sent nothing for 300s.",
		]);
		expect(out.events).toEqual([]);
		expect(inner.signals[0]?.aborted).toBe(true);
		expect(timers.pending()).toEqual([]);
	});

	test("a first event timeout is retried by withRetry; an idle timeout after an event surfaces", async () => {
		const timers = manualTimers();
		const { sleep } = recordingSleep();
		let attempt = 0;
		const inner: Provider = {
			id: "groq",
			api: "openai_chat",
			stream(request, options) {
				attempt += 1;
				return attempt === 1
					? hanging([]).stream(request, options)
					: hanging([{ type: "text_delta", text: "hi" }]).stream(
							request,
							options,
						);
			},
		};
		const provider = withRetry(
			withTimeouts(inner, { setTimer: timers.setTimer }),
			{
				sleep,
				random: () => 0.5,
				now: () => 0,
				logger: silentLogger,
			},
		);
		const running = settle(
			provider.stream(REQUEST, { signal: new AbortController().signal }),
		);
		await tick();
		timers.fireAll(); // first attempt: no first event
		await tick();
		await tick();
		timers.fireAll(); // second attempt: idle after "hi"
		const out = await running;
		expect(attempt).toBe(2);
		expect(out.events).toEqual([{ type: "text_delta", text: "hi" }]);
		expect((out.error as ProviderError).code).toBe("provider.timeout");
		expect((out.error as ProviderError).message).not.toContain("gave up");
	});

	test("a consumer that holds an event for a long time causes no timeout", async () => {
		const timers = manualTimers();
		const inner = hanging([{ type: "text_delta", text: "hi" }]);
		const provider = withTimeouts(inner, { setTimer: timers.setTimer });
		const controller = new AbortController();
		const it = provider
			.stream(REQUEST, { signal: controller.signal })
			[Symbol.asyncIterator]();
		const first = await it.next();
		expect(first.value).toEqual({ type: "text_delta", text: "hi" });
		expect(timers.pending()).toEqual([]); // nothing runs while we hold the event
		controller.abort();
		const next = await it.next();
		expect(next.value).toEqual({ type: "stop", reason: "aborted" });
	});

	test("a timer and a user abort in the same tick end with stop aborted, not a timeout", async () => {
		const timers = manualTimers();
		const provider = withTimeouts(hanging([]), { setTimer: timers.setTimer });
		const controller = new AbortController();
		const running = settle(
			provider.stream(REQUEST, { signal: controller.signal }),
		);
		await tick();
		timers.fireAll();
		controller.abort();
		const out = await running;
		expect(out.error).toBeUndefined();
		expect(out.events).toEqual([{ type: "stop", reason: "aborted" }]);
	});

	test("every exit leaves no timer and no signal listener", async () => {
		for (const exit of ["done", "break", "abort", "timeout"] as const) {
			const timers = manualTimers();
			const { controller, listeners } = countedSignal();
			const inner = hanging([{ type: "text_delta", text: "hi" }]);
			const provider = withTimeouts(inner, { setTimer: timers.setTimer });
			const stream = provider.stream(REQUEST, { signal: controller.signal });
			if (exit === "break") {
				for await (const _event of stream) break;
				expect(inner.closed()).toBe(1);
			} else {
				const running = settle(stream);
				await tick();
				if (exit === "abort" || exit === "done") controller.abort();
				else timers.fireAll();
				await running;
			}
			await tick();
			expect([exit, timers.pending()]).toEqual([exit, []]);
			expect([exit, listeners()]).toEqual([exit, 0]);
		}
	});
});
