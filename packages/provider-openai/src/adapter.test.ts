import { describe, expect, test } from "bun:test";
import { ProviderError } from "@pk/provider";
import {
	CallId,
	checkStreamOrder,
	type ModelRequest,
	type ProviderStreamEvent,
} from "@pk/schema";
import { createOpenAIProvider } from "./adapter.ts";
import {
	counterIds,
	fixture,
	fixtureFetch,
	type Reply,
	settle,
} from "./test-support.ts";

const KEY = "sk-test-0123456789abcdef0123";
const REQUEST: ModelRequest = {
	model: { provider: "openai", model: "gpt-x" },
	system: "be brief",
	messages: [],
	tools: [],
};

function adapter(
	reply: Reply,
	id = "openai",
	baseURL = "https://api.openai.com/v1",
) {
	const { fetch, seen } = fixtureFetch(reply);
	const provider = createOpenAIProvider({
		id,
		baseURL,
		apiKey: () => KEY,
		keyHint: "OPENAI_API_KEY is set and valid",
		newId: counterIds(),
		fetch,
	});
	return { provider, seen };
}

async function play(name: string, id?: string) {
	const { provider, seen } = adapter({ sse: fixture(name) }, id);
	const out = await settle(
		provider.stream(REQUEST, { signal: new AbortController().signal }),
	);
	return { ...out, seen };
}

const call = (n: number) =>
	CallId.parse(`call_01JDX8Z3QK5V7W9Y0A2B4C6D${String(n).padStart(2, "0")}`);
const withoutUsage = (events: ProviderStreamEvent[]) =>
	events.filter((e) => e.type !== "usage");

describe("text and the request (AC-1, AC-3, AC-13)", () => {
	test("a text reply streams, reports usage and stops end_turn", async () => {
		const { events, error, seen } = await play("openai-text");
		expect(error).toBeUndefined();
		expect(events).toEqual([
			{ type: "text_delta", text: "Hello" },
			{ type: "text_delta", text: ", world." },
			{
				type: "usage",
				usage: {
					inputTokens: 10,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					outputTokens: 3,
				},
			},
			{ type: "stop", reason: "end_turn" },
		]);
		expect(checkStreamOrder(events)).toEqual([]);
		const [request] = seen;
		expect(request?.url).toBe("https://api.openai.com/v1/chat/completions");
		expect(request?.headers.get("authorization")).toBe(`Bearer ${KEY}`);
		expect(Object.keys(request?.body ?? {}).sort()).toEqual([
			"messages",
			"model",
			"stream",
			"stream_options",
		]);
		expect(request?.body.stream_options).toEqual({ include_usage: true });
	});

	test("never sends org, project or custom headers from the environment", async () => {
		const saved = { ...process.env };
		process.env.OPENAI_ORG_ID = "org-leak";
		process.env.OPENAI_PROJECT_ID = "proj-leak";
		process.env.OPENAI_BASE_URL = "https://evil.example/v1";
		process.env.OPENAI_CUSTOM_HEADERS = "X-Leak: yes\nCookie: c=1";
		process.env.OPENAI_LOG = "debug";
		try {
			const { seen } = await play("openai-text");
			const headers = seen[0]?.headers;
			const names = [...(headers?.keys() ?? [])];
			expect(
				names.filter(
					(n) =>
						!/^(authorization|content-type|accept|user-agent|x-stainless-.*)$/.test(
							n,
						),
				),
			).toEqual([]);
			expect(headers?.get("openai-organization")).toBeNull();
			expect(seen[0]?.url).toStartWith("https://api.openai.com/v1");
		} finally {
			for (const name of [
				"OPENAI_ORG_ID",
				"OPENAI_PROJECT_ID",
				"OPENAI_BASE_URL",
				"OPENAI_CUSTOM_HEADERS",
				"OPENAI_LOG",
			]) {
				if (saved[name] === undefined) delete process.env[name];
				else process.env[name] = saved[name];
			}
		}
	});
});

describe("the same reply from four servers (AC-2, AC-11)", () => {
	test("OpenAI, OpenRouter, Ollama and Groq give the same events apart from usage", async () => {
		const results = await Promise.all(
			(["openai", "openrouter", "ollama", "groq"] as const).map((server) =>
				play(`${server}-same-reply`, server),
			),
		);
		const [openai, ...others] = results;
		expect(openai?.error).toBeUndefined();
		// Servers split text and arguments differently; compare the joined content.
		const joined = (events: ProviderStreamEvent[]): unknown[] => {
			const out: ProviderStreamEvent[] = [];
			for (const event of withoutUsage(events)) {
				const last = out.at(-1);
				if (event.type === "text_delta" && last?.type === "text_delta") {
					out[out.length - 1] = {
						type: "text_delta",
						text: last.text + event.text,
					};
				} else if (
					event.type === "tool_call_delta" &&
					last?.type === "tool_call_delta"
				) {
					out[out.length - 1] = {
						...last,
						argsText: last.argsText + event.argsText,
					};
				} else {
					out.push(event);
				}
			}
			return out;
		};
		const expected: unknown[] = [
			{ type: "text_delta", text: "I'll read it." },
			{ type: "tool_call_start", callId: call(1), name: "read_file" },
			{
				type: "tool_call_delta",
				callId: call(1),
				argsText: expect.any(String),
			},
			{ type: "tool_call_end", callId: call(1), input: { path: "README.md" } },
			{ type: "stop", reason: "tool_use" },
		];
		for (const result of results) {
			expect(result.error).toBeUndefined();
			expect(joined(result.events)).toEqual(expected);
			expect(checkStreamOrder(result.events)).toEqual([]);
			expect(result.events.filter((e) => e.type === "usage")).toHaveLength(1);
		}
		expect(others.map((r) => r.events.find((e) => e.type === "usage"))).toEqual(
			[
				{
					type: "usage",
					usage: {
						inputTokens: 120,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						outputTokens: 30,
					},
					providerCostMicroUsd: 420,
				},
				{
					type: "usage",
					usage: {
						inputTokens: 120,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						outputTokens: 30,
					},
				},
				{
					type: "usage",
					usage: {
						inputTokens: 120,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						outputTokens: 30,
					},
				},
			],
		);
	});
});

describe("server quirks (AC-4, AC-11)", () => {
	test("OpenAI parallel calls and cached tokens", async () => {
		const { events } = await play("openai-parallel-cached");
		expect(events.filter((e) => e.type === "tool_call_end")).toEqual([
			{ type: "tool_call_end", callId: call(1), input: { path: "a.ts" } },
			{ type: "tool_call_end", callId: call(2), input: { path: "b.ts" } },
		]);
		expect(events.at(-2)).toEqual({
			type: "usage",
			usage: {
				inputTokens: 600,
				cacheReadTokens: 400,
				cacheWriteTokens: 0,
				outputTokens: 50,
				reasoningTokens: 12,
			},
		});
		expect(events.at(-1)).toEqual({ type: "stop", reason: "tool_use" });
		expect(checkStreamOrder(events)).toEqual([]);
	});

	test("OpenRouter reasoning and cost", async () => {
		const { events } = await play("openrouter-reasoning-cost", "openrouter");
		expect(events).toEqual([
			{ type: "reasoning_delta", text: "Thinking" },
			{ type: "reasoning_delta", text: " more." },
			{ type: "text_delta", text: "Done." },
			{
				type: "usage",
				usage: {
					inputTokens: 5,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					outputTokens: 7,
				},
				providerCostMicroUsd: 13,
			},
			{ type: "stop", reason: "end_turn" },
		]);
	});

	test("an OpenRouter error inside the stream, and finish_reason error, are thrown", async () => {
		const mid = await play("openrouter-midstream-error", "openrouter");
		expect(mid.events).toEqual([{ type: "text_delta", text: "Partial" }]);
		const midError = mid.error as ProviderError;
		expect(midError).toBeInstanceOf(ProviderError);
		expect([midError.code, midError.status]).toEqual(["provider.server", 502]);
		expect(midError.message).toBe(
			"openrouter had a server error (502). Try again shortly. Server said: Upstream provider returned an error",
		);
		const fin = await play("openrouter-finish-error", "openrouter");
		expect((fin.error as ProviderError).code).toBe("provider.stream_broken");
		expect((fin.error as ProviderError).message).toBe(
			"The reply from openrouter broke off partway.",
		);
	});

	test("Ollama: reasoning field, two whole calls with no index or id, nulls, usage on every chunk", async () => {
		const { events, error } = await play("ollama-quirks", "ollama");
		expect(error).toBeUndefined();
		expect(events).toEqual([
			{ type: "reasoning_delta", text: "Let me look." },
			{ type: "tool_call_start", callId: call(1), name: "read_file" },
			{ type: "tool_call_delta", callId: call(1), argsText: '{"path":"a"}' },
			{ type: "tool_call_start", callId: call(2), name: "read_file" },
			{ type: "tool_call_delta", callId: call(2), argsText: '{"path":"b"}' },
			{ type: "tool_call_end", callId: call(1), input: { path: "a" } },
			{ type: "tool_call_end", callId: call(2), input: { path: "b" } },
			{
				type: "usage",
				usage: {
					inputTokens: 40,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					outputTokens: 9,
				},
			},
			{ type: "stop", reason: "tool_use" },
		]);
	});

	test("a body with no [DONE] and no finish reason is stream_broken; [DONE] alone is end_turn", async () => {
		const cut = await play("no-done");
		expect(cut.events.map((e) => e.type)).toEqual(["text_delta", "text_delta"]);
		expect((cut.error as ProviderError).code).toBe("provider.stream_broken");
		const done = await play("done-no-finish");
		expect(done.events.at(-1)).toEqual({ type: "stop", reason: "end_turn" });
	});

	test("finish_reason length marks every call cut off, even one that parses", async () => {
		const { events } = await play("length-cutoff");
		expect(events.slice(-2)).toEqual([
			{
				type: "tool_call_end",
				callId: call(1),
				input: {},
				inputError: "reply was cut off at the output limit",
			},
			{ type: "stop", reason: "max_tokens" },
		]);
	});

	test("bad arguments, a bad name, a call with no name, and blank arguments", async () => {
		const { events } = await play("bad-args");
		const ends = events.filter((e) => e.type === "tool_call_end");
		expect(ends[0]).toMatchObject({ callId: call(1), input: {} });
		expect(ends[0]?.type === "tool_call_end" && ends[0].inputError).toStartWith(
			"arguments are not valid JSON: ",
		);
		expect(ends[1]).toEqual({
			type: "tool_call_end",
			callId: call(2),
			input: {},
			inputError: "arguments must be a JSON object",
		});
		expect(ends[2]).toEqual({
			type: "tool_call_end",
			callId: call(4),
			input: {},
		});
		expect(ends[3]).toEqual({
			type: "tool_call_end",
			callId: call(3),
			input: {},
			inputError: "the server sent a tool call with no name",
		});
		expect(
			events.find((e) => e.type === "tool_call_start" && e.callId === call(2)),
		).toEqual({
			type: "tool_call_start",
			callId: call(2),
			name: "read_file_",
		});
		expect(
			events.find((e) => e.type === "tool_call_start" && e.callId === call(3)),
		).toEqual({
			type: "tool_call_start",
			callId: call(3),
			name: "unknown_tool",
		});
		expect(checkStreamOrder(events)).toEqual([]);
	});

	test("a chunk with a wrong type is stream_broken", async () => {
		const { events, error } = await play("bad-chunk");
		expect(events).toEqual([{ type: "text_delta", text: "x" }]);
		expect((error as ProviderError).code).toBe("provider.stream_broken");
	});
});
