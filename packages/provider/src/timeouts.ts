import type { ModelRequest, ProviderStreamEvent } from "@pk/schema";
import { ProviderError } from "./errors.ts";
import {
	ABORTED_STOP,
	DEFAULT_TIMEOUT_POLICY,
	type Provider,
	type SetTimer,
	type StreamOptions,
	type TimeoutPolicy,
} from "./types.ts";

/** What `withTimeouts` needs. */
export interface TimeoutDeps {
	readonly setTimer: SetTimer;
	readonly policy?: TimeoutPolicy;
}

const TIMED_OUT = Symbol("timed out");
const ignore = (): void => {};

/**
 * Wraps a provider so a call fails with `provider.timeout` (retryable) when it yields no event within
 * `firstEventMs`, or goes `idleMs` without one after that. A timer runs only while waiting on the
 * inner stream, never while the consumer holds an event. A user abort always wins over a timeout.
 * On every exit the pending timer is cancelled and the signal listener removed.
 */
export function withTimeouts(provider: Provider, deps: TimeoutDeps): Provider {
	const policy = deps.policy ?? DEFAULT_TIMEOUT_POLICY;

	async function* run(
		request: ModelRequest,
		options: StreamOptions,
	): AsyncGenerator<ProviderStreamEvent> {
		const outer = options.signal;
		const child = new AbortController();
		const onAbort = (): void => child.abort(outer.reason);
		outer.addEventListener("abort", onAbort, { once: true });
		if (outer.aborted) child.abort(outer.reason);

		const inner = provider
			.stream(request, { signal: child.signal })
			[Symbol.asyncIterator]();
		let cancelTimer: (() => void) | undefined;
		let finished = false;
		let first = true;
		try {
			for (;;) {
				const limitMs = first ? policy.firstEventMs : policy.idleMs;
				const pending = inner.next();
				const timer = new Promise<typeof TIMED_OUT>((resolve) => {
					cancelTimer = deps.setTimer(limitMs, () => resolve(TIMED_OUT));
				});
				const result = await Promise.race([pending, timer]);
				cancelTimer?.();
				cancelTimer = undefined;

				if (result === TIMED_OUT) {
					// The inner next() settles once its abort lands; nobody reads it now.
					pending.catch(ignore);
					finished = true;
					child.abort();
					inner.return?.().catch(ignore);
					if (outer.aborted) {
						yield ABORTED_STOP;
						return;
					}
					throw new ProviderError({
						code: "provider.timeout",
						message: `${provider.id} sent nothing for ${Math.ceil(limitMs / 1000)}s.`,
						providerId: provider.id,
					});
				}
				if (result.done === true) {
					finished = true;
					return;
				}
				first = false;
				yield result.value;
			}
		} catch (error) {
			finished = true;
			throw error;
		} finally {
			cancelTimer?.();
			outer.removeEventListener("abort", onAbort);
			// The consumer stopped early: close the inner stream so its request is cancelled.
			if (!finished) await inner.return?.().catch(ignore);
		}
	}

	return {
		id: provider.id,
		api: provider.api,
		stream: (request, options) => run(request, options),
	};
}
