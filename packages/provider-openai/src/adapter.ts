import { ABORTED_STOP, isProviderError, type Provider } from "@pk/provider";
import type {
	ModelRequest,
	NewId,
	ProviderId,
	ProviderStreamEvent,
} from "@pk/schema";
import OpenAI, { APIUserAbortError } from "openai";
import { ChatChunk } from "./chunk.ts";
import {
	type ErrorContext,
	SDK_TIMEOUT_MS,
	toProviderError,
} from "./errors.ts";
import { toChatRequest } from "./request.ts";
import { finish, INITIAL_STATE, mapChunk } from "./stream-map.ts";

/** A `fetch` the adapter can be given, so tests serve fixtures offline. */
export type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

/** How `cli` configures one OpenAI compatible provider, built from a settings entry. */
export interface OpenAIProviderConfig {
	readonly id: ProviderId;
	readonly baseURL: string;
	/** Resolves the key at the start of each call (it may throw `provider.missing_key`). */
	readonly apiKey: () => string;
	/** Finishes `Check that …` in an auth error, such as `GROQ_API_KEY is set and valid`. */
	readonly keyHint: string;
	readonly newId: NewId;
	readonly fetch?: FetchLike;
}

/** The headers a request may carry (spec 0004 AC-3): auth, content type, and the SDK's fixed client headers. */
function allowedHeader(name: string): boolean {
	const lower = name.toLowerCase();
	return (
		lower === "authorization" ||
		lower === "content-type" ||
		lower === "accept" ||
		lower === "user-agent" ||
		lower.startsWith("x-stainless-")
	);
}

const DONE_LINE = /(?:^|\n)data: ?\[DONE\][ \t]*\r?(?:\n|$)/;

/**
 * Wraps `fetch` so the request carries only allowed headers (the SDK would add any from
 * `OPENAI_CUSTOM_HEADERS`), and so the adapter learns whether the body held `data: [DONE]`, which the
 * SDK's stream hides. The scan keeps a short tail so a marker split across chunks is still seen.
 */
function guardedFetch(inner: FetchLike, onDone: () => void): FetchLike {
	return async (input, init) => {
		const headers = new Headers();
		new Headers(init?.headers).forEach((value, name) => {
			if (allowedHeader(name)) headers.set(name, value);
		});
		const response = await inner(input, { ...init, headers });
		if (!response.ok || response.body === null) return response;
		const decoder = new TextDecoder();
		let tail = "\n";
		const watch = new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				const text = tail + decoder.decode(chunk, { stream: true });
				if (DONE_LINE.test(text)) onDone();
				tail = text.slice(-32);
				controller.enqueue(chunk);
			},
		});
		return new Response(response.body.pipeThrough(watch), {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	};
}

/**
 * The OpenAI compatible chat adapter: one code path for OpenAI, OpenRouter, Groq, Ollama and any
 * server that speaks the chat completions format, set by `baseURL`, key and model only. Stateless
 * between calls, logs nothing, and never retries (the SDK runs with `maxRetries: 0`; `withRetry` owns
 * retries). Every failure is a `ProviderError`; an abort ends with `stop { reason: "aborted" }`.
 */
export function createOpenAIProvider(config: OpenAIProviderConfig): Provider {
	async function* run(
		request: ModelRequest,
		signal: AbortSignal,
	): AsyncGenerator<ProviderStreamEvent> {
		if (signal.aborted) {
			yield ABORTED_STOP;
			return;
		}
		const apiKey = config.apiKey();
		const ctx: ErrorContext = {
			providerId: config.id,
			baseURL: config.baseURL,
			model: request.model.model,
			keyHint: config.keyHint,
			apiKey,
		};
		let sawDone = false;
		const client = new OpenAI({
			apiKey,
			baseURL: config.baseURL,
			fetch: guardedFetch(config.fetch ?? globalThis.fetch, () => {
				sawDone = true;
			}),
			maxRetries: 0,
			timeout: SDK_TIMEOUT_MS,
			organization: null,
			project: null,
			// Never print through console, whatever OPENAI_LOG says: stdout and stderr belong to pk.
			logLevel: "off",
		});
		let cancel: (() => void) | undefined;
		try {
			const stream = await client.chat.completions.create(
				toChatRequest(request, { baseURL: config.baseURL }),
				{ signal },
			);
			cancel = () => stream.controller.abort();
			let state = INITIAL_STATE;
			for await (const raw of stream) {
				if (signal.aborted) break;
				const chunk = ChatChunk.safeParse(raw);
				if (!chunk.success) throw toProviderError({ kind: "bad_chunk" }, ctx);
				const step = mapChunk(state, chunk.data, config.newId);
				if (step.failure !== undefined)
					throw toProviderError(step.failure, ctx);
				state = step.state;
				for (const event of step.events) yield event;
			}
			if (signal.aborted) {
				yield ABORTED_STOP;
				return;
			}
			const done = finish(state, { sawDone });
			if ("failure" in done) throw toProviderError(done.failure, ctx);
			for (const event of done.events) yield event;
			cancel = undefined;
		} catch (error) {
			if (signal.aborted || error instanceof APIUserAbortError) {
				yield ABORTED_STOP;
				return;
			}
			throw isProviderError(error) ? error : toProviderError(error, ctx);
		} finally {
			// A consumer that stopped early (or an error) must not leave the request open.
			cancel?.();
		}
	}

	return {
		id: config.id,
		api: "openai_chat",
		stream: (request, options) => run(request, options.signal),
	};
}
