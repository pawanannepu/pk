import type { Logger } from "@pk/env";
import type { ProviderStreamEvent } from "@pk/schema";
import {
	isProviderError,
	type ProviderError,
	withMessageSuffix,
} from "./errors.ts";
import {
	ABORTED_STOP,
	DEFAULT_RETRY_POLICY,
	type Provider,
	type RetryInfo,
	type RetryPolicy,
	type Sleep,
	type StreamOptions,
} from "./types.ts";

/** What `retryDelay` decided: wait this long, or stop retrying because the server asked for too long. */
export type RetryDecision =
	| { readonly kind: "wait"; readonly delayMs: number }
	| {
			readonly kind: "give_up";
			readonly reason: "retry_after_too_long";
			readonly requestedMs: number;
	  };

/** The server's requested wait in ms, or `undefined` when it sent none (or nothing parseable). */
function requestedWaitMs(
	error: ProviderError,
	now: () => number,
): number | undefined {
	if (error.retryAfterMs !== undefined && Number.isFinite(error.retryAfterMs)) {
		return Math.max(0, error.retryAfterMs);
	}
	if (error.retryAfterDate !== undefined) {
		const at = Date.parse(error.retryAfterDate);
		if (Number.isFinite(at)) return Math.max(0, at - now());
	}
	return undefined;
}

/**
 * How long to wait before retry `retry` (from 1): the server's requested time when there is one
 * (over `maxRetryAfterMs` gives up), else full jitter `max(minDelayMs, random() × min(maxDelayMs,
 * baseDelayMs × 2^(retry−1)))`. Pure: the clock and randomness are passed in.
 */
export function retryDelay(
	error: ProviderError,
	retry: number,
	policy: RetryPolicy,
	random: () => number,
	now: () => number,
): RetryDecision {
	const requested = requestedWaitMs(error, now);
	if (requested !== undefined) {
		return requested > policy.maxRetryAfterMs
			? {
					kind: "give_up",
					reason: "retry_after_too_long",
					requestedMs: requested,
				}
			: { kind: "wait", delayMs: requested };
	}
	const cap = Math.min(
		policy.maxDelayMs,
		policy.baseDelayMs * 2 ** (retry - 1),
	);
	return {
		kind: "wait",
		delayMs: Math.max(policy.minDelayMs, Math.round(random() * cap)),
	};
}

/** The short reason a retry notice starts with, by error code. */
function shortReason(error: ProviderError): string {
	const id = error.providerId;
	switch (error.code) {
		case "provider.rate_limited":
			return `Rate limited by ${id}`;
		case "provider.overloaded":
			return `${id} is overloaded`;
		case "provider.server":
			return `${id} had a server error`;
		case "provider.timeout":
			return `${id} timed out`;
		case "provider.network":
			return `Could not reach ${id}`;
		default:
			return `${id} failed`;
	}
}

/** The text of a retry notice, such as `Rate limited by groq, retrying in 4s (2 of 4)`. */
export function retryNoticeText(info: RetryInfo): string {
	return `${shortReason(info.error)}, retrying in ${Math.ceil(info.delayMs / 1000)}s (${info.retry} of ${info.maxRetries})`;
}

/** What `withRetry` needs. `now` is epoch milliseconds. */
export interface RetryDeps {
	readonly sleep: Sleep;
	readonly random: () => number;
	readonly now: () => number;
	readonly logger: Logger;
	readonly policy?: RetryPolicy;
}

function statusField(error: ProviderError): { status?: number } {
	return error.status === undefined ? {} : { status: error.status };
}

/**
 * Wraps a provider so a call is retried when the error is retryable and no event of that call was
 * yielded yet. Waits per `retryDelay`, calls `onRetry` before each wait, and ends with
 * `stop { reason: "aborted" }` on an abort during a wait. Logs metadata only, never prompts or output.
 */
export function withRetry(provider: Provider, deps: RetryDeps): Provider {
	const policy = deps.policy ?? DEFAULT_RETRY_POLICY;
	const log = deps.logger;

	async function* run(
		request: Parameters<Provider["stream"]>[0],
		options: StreamOptions,
	): AsyncGenerator<ProviderStreamEvent> {
		const { signal } = options;
		const base = { provider: provider.id, model: request.model.model };
		for (let attempt = 1; ; attempt++) {
			if (signal.aborted) {
				yield ABORTED_STOP;
				return;
			}
			const startedAt = deps.now();
			let firstEventMs: number | undefined;
			let failure: unknown;
			try {
				for await (const event of provider.stream(request, { signal })) {
					firstEventMs ??= deps.now() - startedAt;
					yield event;
				}
				return;
			} catch (error) {
				failure = error;
			} finally {
				log.debug("provider attempt", {
					...base,
					attempt,
					firstEventMs,
					totalMs: deps.now() - startedAt,
				});
			}

			if (!isProviderError(failure)) throw failure;
			const error = failure;
			if (firstEventMs !== undefined) {
				log.error("provider call failed", {
					provider: provider.id,
					code: error.code,
					...statusField(error),
				});
				throw error;
			}
			const giveUp = (final: ProviderError): ProviderError => {
				log.error("provider call failed", {
					provider: provider.id,
					code: final.code,
					...statusField(final),
				});
				return final;
			};
			if (!error.retryable) throw giveUp(error);
			if (attempt > policy.maxRetries) {
				throw giveUp(
					withMessageSuffix(error, ` (gave up after ${attempt} attempts)`),
				);
			}
			const decision = retryDelay(
				error,
				attempt,
				policy,
				deps.random,
				deps.now,
			);
			if (decision.kind === "give_up") {
				throw giveUp(
					withMessageSuffix(
						error,
						` Retry after ${Math.ceil(decision.requestedMs / 1000)}s.`,
					),
				);
			}
			log.warn("provider retry", {
				provider: provider.id,
				code: error.code,
				...statusField(error),
				retry: attempt,
				delayMs: decision.delayMs,
			});
			try {
				options.onRetry?.({
					retry: attempt,
					maxRetries: policy.maxRetries,
					delayMs: decision.delayMs,
					error,
				});
			} catch {
				// A notice failing must never change the call.
			}
			await deps.sleep(decision.delayMs, signal);
		}
	}

	return {
		id: provider.id,
		api: provider.api,
		stream: (request, options) => run(request, options),
	};
}
