import { describe, expect, test } from "bun:test";
import { ProviderError } from "@pk/provider";
import { checkStreamOrder, type ModelRequest } from "@pk/schema";
import { createOpenAIProvider } from "./adapter.ts";
import {
	counterIds,
	fixtureFetch,
	type Reply,
	settle,
} from "./test-support.ts";

const KEY = "sk-or-v1-0123456789abcdef0123456789";
const REQUEST: ModelRequest = {
	model: { provider: "openrouter", model: "vendor/model-x" },
	system: "",
	messages: [],
	tools: [],
};

function adapter(reply: Reply, baseURL = "https://openrouter.ai/api/v1") {
	const { fetch, seen } = fixtureFetch(reply);
	let keyReads = 0;
	const provider = createOpenAIProvider({
		id: "openrouter",
		baseURL,
		apiKey: () => {
			keyReads += 1;
			return KEY;
		},
		keyHint: "OPENROUTER_API_KEY is set and valid",
		newId: counterIds(),
		fetch,
	});
	return { provider, seen, keyReads: () => keyReads };
}

/** A body the test feeds by hand, chunk by chunk. */
function manualBody() {
	let push: ((text: string) => void) | undefined;
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			push = (text) => controller.enqueue(new TextEncoder().encode(text));
		},
	});
	return { body, push: (text: string) => push?.(text) };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

async function failWith(
	reply: Reply,
	baseURL?: string,
): Promise<ProviderError> {
	const { provider } = adapter(reply, baseURL);
	const { error } = await settle(
		provider.stream(REQUEST, { signal: new AbortController().signal }),
	);
	expect(error).toBeInstanceOf(ProviderError);
	return error as ProviderError;
}

describe("abort (AC-5)", () => {
	test("an already aborted signal stops first, before the key is read or anything is sent", async () => {
		const { provider, seen, keyReads } = adapter({ sse: "" });
		const controller = new AbortController();
		controller.abort();
		const { events, error } = await settle(
			provider.stream(REQUEST, { signal: controller.signal }),
		);
		expect(error).toBeUndefined();
		expect(events).toEqual([{ type: "stop", reason: "aborted" }]);
		expect(keyReads()).toBe(0);
		expect(seen).toEqual([]);
	});

	test("an abort after the first tool call fragment drops the call, emits no usage, and cancels the request", async () => {
		const { body, push } = manualBody();
		const { provider, seen } = adapter({ body });
		const controller = new AbortController();
		const events: unknown[] = [];
		const running = (async () => {
			for await (const event of provider.stream(REQUEST, {
				signal: controller.signal,
			})) {
				events.push(event);
				if (event.type === "tool_call_start") controller.abort();
			}
		})();
		push(
			`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "read_file", arguments: '{"path":"a"}' } }] } }] })}\n\n`,
		);
		await running;
		expect(events.at(-1)).toEqual({ type: "stop", reason: "aborted" });
		expect(
			events.some(
				(e) =>
					typeof e === "object" &&
					e !== null &&
					"type" in e &&
					(e.type === "tool_call_end" || e.type === "usage"),
			),
		).toBe(false);
		expect(checkStreamOrder(events as never)).toEqual([]);
		expect(seen[0]?.signal?.aborted).toBe(true);
	});

	test("a consumer that stops reading early cancels the request", async () => {
		const { body, push } = manualBody();
		const { provider, seen } = adapter({ body });
		const running = (async () => {
			for await (const _event of provider.stream(REQUEST, {
				signal: new AbortController().signal,
			}))
				break;
		})();
		push(
			`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "hi" } }] })}\n\n`,
		);
		await running;
		await tick();
		expect(seen[0]?.signal?.aborted).toBe(true);
	});
});

describe("error mapping (AC-6)", () => {
	test("401 names the key hint and redacts a key echoed by the server", async () => {
		const error = await failWith({
			status: 401,
			body: JSON.stringify({
				error: { message: `Invalid key ${KEY}`, code: 401 },
			}),
		});
		expect(error.code).toBe("provider.auth");
		expect(error.retryable).toBe(false);
		expect(error.message).toBe(
			"openrouter rejected the API key (401). Check that OPENROUTER_API_KEY is set and valid. Server said: Invalid key [REDACTED]",
		);
		expect(error.message).not.toContain(KEY);
		expect(error.cause).toEqual({ name: "AuthenticationError", status: 401 });
	});

	test("429 with retry-after seconds, retry-after-ms, or an HTTP date", async () => {
		const seconds = await failWith({
			status: 429,
			body: "{}",
			headers: { "retry-after": "7" },
		});
		expect([seconds.code, seconds.retryable, seconds.retryAfterMs]).toEqual([
			"provider.rate_limited",
			true,
			7000,
		]);
		expect(seconds.message).toBe(
			"Rate limited by openrouter. Wait a moment, or switch model.",
		);
		const ms = await failWith({
			status: 429,
			body: "{}",
			headers: { "retry-after-ms": "1500", "retry-after": "9" },
		});
		expect(ms.retryAfterMs).toBe(1500);
		const date = await failWith({
			status: 429,
			body: "{}",
			headers: { "retry-after": "Fri, 27 Nov 2026 10:00:05 GMT" },
		});
		expect([date.retryAfterMs, date.retryAfterDate]).toEqual([
			undefined,
			"Fri, 27 Nov 2026 10:00:05 GMT",
		]);
	});

	test("status rows", async () => {
		const cases: [number, string, string][] = [
			[402, "{}", "provider.quota_exceeded"],
			[
				429,
				JSON.stringify({
					error: { code: "insufficient_quota", message: "out" },
				}),
				"provider.quota_exceeded",
			],
			[503, "{}", "provider.overloaded"],
			[529, "{}", "provider.overloaded"],
			[500, "{}", "provider.server"],
			[409, "{}", "provider.server"],
			[521, "{}", "provider.server"],
			[504, "{}", "provider.timeout"],
			[408, "{}", "provider.timeout"],
			[413, "{}", "provider.context_length"],
			[
				400,
				JSON.stringify({
					error: {
						message: "This model's maximum context length is 8192 tokens",
					},
				}),
				"provider.context_length",
			],
			[
				400,
				JSON.stringify({
					error: { code: "context_length_exceeded", message: "x" },
				}),
				"provider.context_length",
			],
			[
				422,
				JSON.stringify({ error: { message: "bad field" } }),
				"provider.bad_request",
			],
			[404, "{}", "provider.not_found"],
			[418, "{}", "provider.bad_request"],
		];
		for (const [status, body, code] of cases) {
			const error = await failWith({ status, body });
			expect<unknown[]>([status, error.code, error.status]).toEqual([
				status,
				code,
				status,
			]);
		}
		const notFound = await failWith({ status: 404, body: "{}" });
		expect(notFound.message).toBe(
			'openrouter has no model "vendor/model-x", or the base URL is wrong (https://openrouter.ai/api/v1).',
		);
		const context = await failWith({ status: 413, body: "{}" });
		expect(context.message).toBe(
			"The conversation is too long for vendor/model-x at openrouter.",
		);
	});

	test("an HTML body is never echoed, and long server text is cut to 500 characters", async () => {
		const html = await failWith({
			status: 502,
			body: "  <html><body>Bad gateway</body></html>",
		});
		expect(html.message).toBe(
			"openrouter had a server error (502). Try again shortly.",
		);
		const long = await failWith({
			status: 400,
			body: JSON.stringify({ error: { message: "x".repeat(900) } }),
		});
		expect(long.message).toBe(
			`openrouter rejected the request (400). Server said: ${"x".repeat(500)}`,
		);
	});

	test("a refused connection is provider.network, with a hint for local servers", async () => {
		const local = await failWith(
			{
				throws: new TypeError(
					"Unable to connect. Is the computer able to access the url?",
				),
			},
			"http://localhost:11434/v1",
		);
		expect([local.code, local.retryable]).toEqual(["provider.network", true]);
		expect(local.message).toBe(
			"Could not reach openrouter at http://localhost:11434/v1. Check the URL and your connection. Is the local server running?",
		);
		const remote = await failWith({ throws: new TypeError("fetch failed") });
		expect(remote.message).not.toContain("local server");
		expect(remote.cause).toEqual({ name: "APIConnectionError" });
	});
});
