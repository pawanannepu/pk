import { PkError } from "@pk/env";
import type { ProviderErrorCode, ProviderId } from "@pk/schema";

/**
 * Whether each code is retried by default: the *Retryable* column of spec 0004's *Error mapping*,
 * and the only copy of it. A fake script error with no `retryable` takes its value from here.
 */
export const DEFAULT_RETRYABLE: Readonly<Record<ProviderErrorCode, boolean>> = {
	"provider.auth": false,
	"provider.missing_key": false,
	"provider.keychain_unavailable": false,
	"provider.quota_exceeded": false,
	"provider.rate_limited": true,
	"provider.overloaded": true,
	"provider.server": true,
	"provider.timeout": true,
	"provider.network": true,
	"provider.context_length": false,
	"provider.bad_request": false,
	"provider.not_found": false,
	"provider.stream_broken": false,
	"provider.unknown_provider": false,
	"provider.unsupported_api": false,
	"provider.no_model": false,
	"provider.fake_exhausted": false,
	"provider.fake_script_invalid": false,
};

/** A sanitized summary of the error underneath, never the vendor error object itself (spec 0004 AC-6). */
export interface ProviderErrorCause {
	readonly name: string;
	readonly status?: number;
}

/** What makes a `ProviderError`. `retryable` defaults from `DEFAULT_RETRYABLE`. */
export interface ProviderErrorInit {
	readonly code: ProviderErrorCode;
	readonly message: string;
	readonly providerId: ProviderId;
	readonly retryable?: boolean;
	readonly status?: number;
	readonly retryAfterMs?: number;
	readonly retryAfterDate?: string;
	readonly cause?: ProviderErrorCause;
}

/**
 * A provider failure with a stable `code`, whether it may be retried, the provider it came from, and
 * the HTTP status and requested wait when known. Never mutated: `withMessageSuffix` makes a new one.
 */
export class ProviderError extends PkError {
	declare readonly code: ProviderErrorCode;
	readonly retryable: boolean;
	readonly providerId: ProviderId;
	readonly status: number | undefined;
	readonly retryAfterMs: number | undefined;
	/** A raw HTTP date `retry-after` header, resolved by `retryDelay` against the injected clock. */
	readonly retryAfterDate: string | undefined;

	constructor(init: ProviderErrorInit) {
		super(
			init.code,
			init.message,
			init.cause === undefined ? undefined : { cause: init.cause },
		);
		this.retryable = init.retryable ?? DEFAULT_RETRYABLE[init.code];
		this.providerId = init.providerId;
		this.status = init.status;
		this.retryAfterMs = init.retryAfterMs;
		this.retryAfterDate = init.retryAfterDate;
	}
}

/** True when `value` is a `ProviderError`. */
export function isProviderError(value: unknown): value is ProviderError {
	return value instanceof ProviderError;
}

/** A copy of `error` with `suffix` added to its message, keeping every other field. */
export function withMessageSuffix(
	error: ProviderError,
	suffix: string,
): ProviderError {
	return new ProviderError({
		code: error.code,
		message: `${error.message}${suffix}`,
		providerId: error.providerId,
		retryable: error.retryable,
		...(error.status === undefined ? {} : { status: error.status }),
		...(error.retryAfterMs === undefined
			? {}
			: { retryAfterMs: error.retryAfterMs }),
		...(error.retryAfterDate === undefined
			? {}
			: { retryAfterDate: error.retryAfterDate }),
		...(isCause(error.cause) ? { cause: error.cause } : {}),
	});
}

function isCause(value: unknown): value is ProviderErrorCause {
	return (
		typeof value === "object" &&
		value !== null &&
		"name" in value &&
		typeof value.name === "string"
	);
}
