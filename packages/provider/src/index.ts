/**
 * @pk/provider: the provider interface every adapter implements, `ProviderError` with its stable codes,
 * the one retry policy (`withRetry`), the timeout wrapper (`withTimeouts`), API key resolution, and the
 * scripted fake provider every offline test uses. Spec: docs/specs/0004-provider-layer-openai-adapter.
 *
 * Runtime neutral and vendor free: depends on `@pk/schema` and `@pk/env` only (spec 0001 module map).
 */

/** `ProviderError`, the sanitized cause it carries, `DEFAULT_RETRYABLE` per code, and helpers. */
export {
	DEFAULT_RETRYABLE,
	isProviderError,
	ProviderError,
	type ProviderErrorCause,
	type ProviderErrorInit,
	withMessageSuffix,
} from "./errors.ts";
/** The scripted fake provider and its script parser. */
export {
	createFakeProvider,
	type FakeProvider,
	type FakeProviderOptions,
	parseFakeScript,
} from "./fake.ts";
/** API key resolution at call time, and the placeholder for keyless local servers. */
export { NO_KEY_PLACEHOLDER, resolveApiKey } from "./keys.ts";
/** The retry wrapper, its pure delay rule and the retry notice text. */
export {
	type RetryDecision,
	type RetryDeps,
	retryDelay,
	retryNoticeText,
	withRetry,
} from "./retry.ts";
/** The first event and idle timeout wrapper. */
export { type TimeoutDeps, withTimeouts } from "./timeouts.ts";
/** The `Provider` interface, per call options, policies and the shared `Sleep` and `SetTimer` types. */
export {
	ABORTED_STOP,
	DEFAULT_RETRY_POLICY,
	DEFAULT_TIMEOUT_POLICY,
	type Provider,
	type RetryInfo,
	type RetryPolicy,
	type SetTimer,
	type Sleep,
	type StreamOptions,
	type TimeoutPolicy,
} from "./types.ts";
