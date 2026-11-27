import { z } from "zod";
import { ProviderStreamEvent } from "./provider.ts";

/**
 * The stable codes a provider failure carries (spec 0004, *Error mapping*). Shared by `ProviderError`
 * in `@pk/provider` and by `FakeScript`. They are pk's own strings, never vendor fields.
 */
export const ProviderErrorCode = z.enum([
	"provider.auth",
	"provider.missing_key",
	"provider.keychain_unavailable",
	"provider.quota_exceeded",
	"provider.rate_limited",
	"provider.overloaded",
	"provider.server",
	"provider.timeout",
	"provider.network",
	"provider.context_length",
	"provider.bad_request",
	"provider.not_found",
	"provider.stream_broken",
	"provider.unknown_provider",
	"provider.unsupported_api",
	"provider.no_model",
	"provider.fake_exhausted",
	"provider.fake_script_invalid",
]);
/** The stable codes a provider failure carries. */
export type ProviderErrorCode = z.infer<typeof ProviderErrorCode>;

/**
 * A failure a fake script throws. `retryable`, when left out, comes from the code's default in
 * `@pk/provider`, and `message` defaults to `Scripted <code>.`.
 */
export const FakeError = z
	.strictObject({
		code: ProviderErrorCode,
		message: z.string().optional(),
		status: z.number().int().optional(),
		retryAfterMs: z.number().int().min(0).optional(),
		retryable: z.boolean().optional(),
	})
	.readonly();
/** A failure a fake script throws. */
export type FakeError = z.infer<typeof FakeError>;

/**
 * One scripted model call: either events (each after `eventDelayMs`, default 0, then an optional
 * `thenError` thrown after the last one), or an `error` thrown before any event.
 */
export const FakeStep = z.union([
	z
		.strictObject({
			events: z.array(ProviderStreamEvent).readonly(),
			eventDelayMs: z.number().int().min(0).optional(),
			thenError: FakeError.optional(),
		})
		.readonly(),
	z.strictObject({ error: FakeError }).readonly(),
]);
/** One scripted model call. */
export type FakeStep = z.infer<typeof FakeStep>;

/**
 * A script for the fake provider: one step per `stream()` call, in order. Untrusted input (a file named
 * by `PK_FAKE_SCRIPT`), so it is always parsed, never cast. Call ids in it are literal `call_<ULID>` values.
 */
export const FakeScript = z
	.strictObject({
		v: z.literal(1),
		steps: z.array(FakeStep).min(1).readonly(),
	})
	.readonly();
/** A script for the fake provider. */
export type FakeScript = z.infer<typeof FakeScript>;
