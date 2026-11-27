/**
 * Shared helpers for this package's tests: a fixture `fetch` that serves `src/fixtures/*.sse` offline
 * and records each request, and a deterministic `newId`. Not exported from `index.ts`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ID_SCHEMAS, type NewId, type ProviderStreamEvent } from "@pk/schema";
import type { FetchLike } from "./adapter.ts";

/** One request the fixture fetch received. */
export interface SeenRequest {
	readonly url: string;
	readonly headers: Headers;
	readonly body: Record<string, unknown>;
	readonly signal: AbortSignal | undefined;
}

/** A deterministic `newId`: the n-th id ends in n (two digits). */
export function counterIds(): NewId {
	let n = 0;
	return (prefix) => {
		n += 1;
		return ID_SCHEMAS[prefix].parse(
			`${prefix}_01JDX8Z3QK5V7W9Y0A2B4C6D${String(n).padStart(2, "0")}`,
		);
	};
}

/** The text of a fixture file. */
export const fixture = (name: string): string =>
	readFileSync(
		fileURLToPath(new URL(`./fixtures/${name}.sse`, import.meta.url)),
		"utf8",
	);

/** A body that sends `text` in `size` byte pieces, so markers split across reads. */
function piecewise(text: string, size: number): ReadableStream<Uint8Array> {
	const bytes = new TextEncoder().encode(text);
	let at = 0;
	return new ReadableStream({
		pull(controller) {
			if (at >= bytes.length) {
				controller.close();
				return;
			}
			controller.enqueue(bytes.slice(at, at + size));
			at += size;
		},
	});
}

/** What a fixture fetch replies with. */
export type Reply =
	| { readonly sse: string }
	| {
			readonly status: number;
			readonly body: string;
			readonly headers?: Record<string, string>;
	  }
	| { readonly body: ReadableStream<Uint8Array> }
	| { readonly throws: Error };

/** A fetch that answers every request with `reply` and records what it saw. */
export function fixtureFetch(reply: Reply): {
	fetch: FetchLike;
	seen: SeenRequest[];
} {
	const seen: SeenRequest[] = [];
	const fetch: FetchLike = async (input, init) => {
		const raw = typeof init?.body === "string" ? init.body : "{}";
		const parsed: unknown = JSON.parse(raw);
		seen.push({
			url: String(input instanceof Request ? input.url : input),
			headers: new Headers(init?.headers),
			body:
				typeof parsed === "object" && parsed !== null
					? Object.fromEntries(Object.entries(parsed))
					: {},
			signal: init?.signal ?? undefined,
		});
		if ("throws" in reply) throw reply.throws;
		if ("sse" in reply) {
			return new Response(piecewise(reply.sse, 7), {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			});
		}
		if ("status" in reply) {
			return new Response(reply.body, {
				status: reply.status,
				headers: { "content-type": "application/json", ...reply.headers },
			});
		}
		return new Response(reply.body, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
	};
	return { fetch, seen };
}

/** Reads a stream and returns its events plus the error it threw, if any. */
export async function settle(
	stream: AsyncIterable<ProviderStreamEvent>,
): Promise<{ events: ProviderStreamEvent[]; error: unknown }> {
	const events: ProviderStreamEvent[] = [];
	try {
		for await (const event of stream) events.push(event);
		return { events, error: undefined };
	} catch (error) {
		return { events, error };
	}
}
