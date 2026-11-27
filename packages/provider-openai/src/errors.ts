import { redact } from "@pk/env";
import { ProviderError } from "@pk/provider";
import type { ProviderErrorCode, ProviderId } from "@pk/schema";
import {
	APIConnectionError,
	APIConnectionTimeoutError,
	APIError,
} from "openai";
import type { ChunkError } from "./chunk.ts";
import type { StreamFailure } from "./stream-map.ts";

/** What error messages need to name the provider, the model and the key, and to scrub the key. */
export interface ErrorContext {
	readonly providerId: ProviderId;
	readonly baseURL: string;
	readonly model: string;
	readonly keyHint: string;
	readonly apiKey: string;
}

/** The SDK's own request timeout, which `withTimeouts` makes unreachable in practice. */
export const SDK_TIMEOUT_MS = 86_400_000;
const MAX_SERVER_TEXT = 500;
const CONTEXT_TEXT =
	/context length|context window|maximum context|too many tokens/i;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Everything a row of the *Error mapping* table needs. */
interface Facts {
	readonly status: number | undefined;
	readonly code: string | undefined;
	readonly text: string | undefined;
	readonly retryAfter: { retryAfterMs?: number; retryAfterDate?: string };
	readonly cause: { name: string; status?: number } | undefined;
}

function messageFor(
	code: ProviderErrorCode,
	facts: Facts,
	ctx: ErrorContext,
): string {
	const id = ctx.providerId;
	const status = facts.status === undefined ? "" : ` (${facts.status})`;
	switch (code) {
		case "provider.auth":
			return `${id} rejected the API key${status}. Check that ${ctx.keyHint}.`;
		case "provider.quota_exceeded":
			return `${id} says this account is out of credit or quota.`;
		case "provider.rate_limited":
			return `Rate limited by ${id}. Wait a moment, or switch model.`;
		case "provider.overloaded":
			return `${id} is overloaded${status}. Try again shortly.`;
		case "provider.server":
			return `${id} had a server error${status}. Try again shortly.`;
		case "provider.timeout":
			return facts.status === undefined
				? `${id} sent nothing for ${Math.ceil(SDK_TIMEOUT_MS / 1000)}s.`
				: `${id} timed out${status}.`;
		case "provider.network":
			return `Could not reach ${id} at ${ctx.baseURL}. Check the URL and your connection.${isLocal(ctx.baseURL) ? " Is the local server running?" : ""}`;
		case "provider.context_length":
			return `The conversation is too long for ${ctx.model} at ${id}.`;
		case "provider.not_found":
			return `${id} has no model "${ctx.model}", or the base URL is wrong (${ctx.baseURL}).`;
		case "provider.bad_request":
			return `${id} rejected the request${status}.`;
		default:
			return `The reply from ${id} broke off partway.`;
	}
}

function isLocal(baseURL: string): boolean {
	try {
		return LOCAL_HOSTS.has(new URL(baseURL).hostname);
	} catch {
		return false;
	}
}

/** The code for an HTTP status (and the body's error code and text), per the *Error mapping* rows. */
function codeForStatus(
	status: number,
	code: string | undefined,
	text: string | undefined,
): ProviderErrorCode {
	if (status === 401 || status === 403) return "provider.auth";
	if (status === 402) return "provider.quota_exceeded";
	if (status === 429)
		return code === "insufficient_quota"
			? "provider.quota_exceeded"
			: "provider.rate_limited";
	if (code === "rate_limit_exceeded") return "provider.rate_limited";
	if (status === 503 || status === 529) return "provider.overloaded";
	if (status === 408 || status === 504 || status === 524)
		return "provider.timeout";
	if (status === 413) return "provider.context_length";
	if (status === 400 || status === 422) {
		return code === "context_length_exceeded" ||
			(text !== undefined && CONTEXT_TEXT.test(text))
			? "provider.context_length"
			: "provider.bad_request";
	}
	if (status === 404) return "provider.not_found";
	if (status === 409 || status >= 500) return "provider.server";
	return "provider.bad_request";
}

/** The code for an `error` payload inside a stream: a numeric code is a status, known strings map by row. */
function codeForStreamError(
	code: string | number | undefined,
	text: string | undefined,
): {
	readonly code: ProviderErrorCode;
	readonly status?: number;
} {
	if (typeof code === "number")
		return { code: codeForStatus(code, undefined, text), status: code };
	switch (code) {
		case "rate_limit_exceeded":
			return { code: "provider.rate_limited" };
		case "insufficient_quota":
			return { code: "provider.quota_exceeded" };
		case "context_length_exceeded":
			return { code: "provider.context_length" };
		default:
			return { code: "provider.stream_broken" };
	}
}

const asString = (value: unknown): string | undefined =>
	typeof value === "string" && value !== "" ? value : undefined;

/** The server's own error text from an SDK error, never its URL or request details. */
function serverText(error: APIError): string | undefined {
	const body: unknown = error.error;
	if (typeof body === "string") return asString(body);
	if (typeof body === "object" && body !== null && "message" in body) {
		const message = asString(body.message);
		if (message !== undefined) return message;
	}
	if (typeof body === "object" && body !== null) {
		// An empty object says nothing; anything else is quoted as the server sent it.
		return Object.keys(body).length === 0
			? undefined
			: asString(JSON.stringify(body));
	}
	if (error.status === undefined) return asString(error.message);
	const prefix = `${error.status} `;
	const message = error.message.startsWith(prefix)
		? error.message.slice(prefix.length)
		: undefined;
	return message === "status code (no body)" ? undefined : asString(message);
}

function retryAfterOf(headers: Headers | undefined): Facts["retryAfter"] {
	const ms = headers?.get("retry-after-ms");
	if (ms !== null && ms !== undefined && ms.trim() !== "") {
		const value = Number(ms);
		if (Number.isFinite(value)) return { retryAfterMs: Math.max(0, value) };
	}
	const after = headers?.get("retry-after");
	if (after === null || after === undefined || after.trim() === "") return {};
	const seconds = Number(after);
	if (Number.isFinite(seconds))
		return { retryAfterMs: Math.max(0, seconds * 1000) };
	return { retryAfterDate: after };
}

function build(
	code: ProviderErrorCode,
	facts: Facts,
	ctx: ErrorContext,
): ProviderError {
	const raw = facts.text?.trim();
	const said =
		raw === undefined || raw === "" || raw.startsWith("<")
			? ""
			: ` Server said: ${redact(raw, { secrets: [ctx.apiKey] }).slice(0, MAX_SERVER_TEXT)}`;
	return new ProviderError({
		code,
		message: `${messageFor(code, facts, ctx)}${said}`,
		providerId: ctx.providerId,
		...(facts.status === undefined ? {} : { status: facts.status }),
		...facts.retryAfter,
		...(facts.cause === undefined ? {} : { cause: facts.cause }),
	});
}

function fromChunkError(error: ChunkError, ctx: ErrorContext): ProviderError {
	const text = asString(error.message);
	const mapped = codeForStreamError(error.code ?? undefined, text);
	return build(
		mapped.code,
		{
			status: mapped.status,
			code: undefined,
			text,
			retryAfter: {},
			cause: { name: "StreamError" },
		},
		ctx,
	);
}

/**
 * Maps any failure of a call (an SDK error, a JSON `SyntaxError`, a mapper `StreamFailure`) to a
 * `ProviderError` per spec 0004's *Error mapping*. Server text is redacted with the key and cut to
 * 500 characters, HTML bodies are never echoed, and `cause` is only a sanitized `{ name, status? }`.
 */
export function toProviderError(
	failure: unknown,
	ctx: ErrorContext,
): ProviderError {
	const broken = (name: string): ProviderError =>
		build(
			"provider.stream_broken",
			{
				status: undefined,
				code: undefined,
				text: undefined,
				retryAfter: {},
				cause: { name },
			},
			ctx,
		);

	if (isStreamFailure(failure)) {
		switch (failure.kind) {
			case "error_chunk":
				return fromChunkError(failure.error, ctx);
			case "finish_error":
				return broken("FinishReasonError");
			case "bad_chunk":
				return broken("InvalidChunk");
			case "truncated":
				return broken("Truncated");
			default: {
				const _exhaustive: never = failure;
				return _exhaustive;
			}
		}
	}
	if (failure instanceof APIConnectionTimeoutError) {
		return build(
			"provider.timeout",
			{
				status: undefined,
				code: undefined,
				text: undefined,
				retryAfter: {},
				cause: { name: failure.constructor.name },
			},
			ctx,
		);
	}
	if (failure instanceof APIConnectionError) {
		return build(
			"provider.network",
			{
				status: undefined,
				code: undefined,
				text: undefined,
				retryAfter: {},
				cause: { name: failure.constructor.name },
			},
			ctx,
		);
	}
	if (failure instanceof APIError) {
		const text = serverText(failure);
		const name = failure.constructor.name;
		if (failure.status === undefined) {
			const body: unknown = failure.error;
			const code =
				typeof body === "object" &&
				body !== null &&
				"code" in body &&
				(typeof body.code === "string" || typeof body.code === "number")
					? body.code
					: undefined;
			const mapped = codeForStreamError(code, text);
			return build(
				mapped.code,
				{
					status: mapped.status,
					code: undefined,
					text,
					retryAfter: {},
					cause: { name },
				},
				ctx,
			);
		}
		const code = asString(failure.code);
		return build(
			codeForStatus(failure.status, code, text),
			{
				status: failure.status,
				code,
				text,
				retryAfter: retryAfterOf(failure.headers),
				cause: { name, status: failure.status },
			},
			ctx,
		);
	}
	if (failure instanceof SyntaxError) return broken("SyntaxError");
	return broken(failure instanceof Error ? failure.name : "UnknownError");
}

function isStreamFailure(value: unknown): value is StreamFailure {
	return (
		typeof value === "object" &&
		value !== null &&
		"kind" in value &&
		(value.kind === "error_chunk" ||
			value.kind === "finish_error" ||
			value.kind === "bad_chunk" ||
			value.kind === "truncated")
	);
}
