import type {
	ApiStyle,
	ModelRequest,
	ProviderId,
	ProviderStreamEvent,
} from "@pk/schema";
import type { ProviderError } from "./errors.ts";

/** What `onRetry` hears before each retry wait. `retry` counts from 1 up to `maxRetries`. */
export interface RetryInfo {
	readonly retry: number;
	readonly maxRetries: number;
	readonly delayMs: number;
	readonly error: ProviderError;
}

/** Per call options. The one `signal` reaches every request, wait and timer for this call. */
export interface StreamOptions {
	readonly signal: AbortSignal;
	/** Called once before each retry wait. Anything it throws is ignored. */
	readonly onRetry?: (info: RetryInfo) => void;
}

/**
 * A model provider: one streaming method that turns a pk `ModelRequest` into pk stream events.
 * Failures are thrown as `ProviderError`. An abort ends the stream with `stop { reason: "aborted" }`
 * and never throws. A stream that ends (rather than throws) passes `checkStreamOrder`.
 */
export interface Provider {
	readonly id: ProviderId;
	readonly api: ApiStyle;
	stream(
		request: ModelRequest,
		options: StreamOptions,
	): AsyncIterable<ProviderStreamEvent>;
}

/**
 * Waits `ms`, resolving early when `signal` aborts, and removes its listener either way. Shared by
 * the fake provider and `withRetry`; `cli` builds the real one from `setTimeout`.
 */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

/** How `withRetry` retries. */
export interface RetryPolicy {
	readonly maxRetries: number;
	readonly baseDelayMs: number;
	readonly minDelayMs: number;
	readonly maxDelayMs: number;
	/** A server requested wait above this stops retrying at once. Exactly this much is still waited. */
	readonly maxRetryAfterMs: number;
}

/** The default retry policy: 4 retries, full jitter from 1s doubling to 30s, 250ms floor, 60s cap on a requested wait. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
	maxRetries: 4,
	baseDelayMs: 1_000,
	minDelayMs: 250,
	maxDelayMs: 30_000,
	maxRetryAfterMs: 60_000,
};

/** How long `withTimeouts` waits for the first event, and between events after it. */
export interface TimeoutPolicy {
	readonly firstEventMs: number;
	readonly idleMs: number;
}

/** The default timeouts: 5 minutes for the first event and 5 minutes between events. */
export const DEFAULT_TIMEOUT_POLICY: TimeoutPolicy = {
	firstEventMs: 300_000,
	idleMs: 300_000,
};

/** Starts a timer that calls `fire` after `ms`, and returns a function that cancels it. */
export type SetTimer = (ms: number, fire: () => void) => () => void;

/** The aborted stop every layer yields when the call's signal aborts. */
export const ABORTED_STOP: ProviderStreamEvent = {
	type: "stop",
	reason: "aborted",
};
