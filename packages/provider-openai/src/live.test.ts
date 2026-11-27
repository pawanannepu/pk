/**
 * Live smoke test against a real OpenAI compatible endpoint (spec 0004 AC-11). Skipped unless
 * `PK_LIVE_TEST=1`, so `bun run check` and CI never touch the network. Set `PK_LIVE_BASE_URL`,
 * `PK_LIVE_MODEL` and `PK_LIVE_API_KEY` (leave the key out for a local server).
 */
import { describe, expect, test } from "bun:test";
import { createIdFactory } from "@pk/env";
import { NO_KEY_PLACEHOLDER } from "@pk/provider";
import {
	checkStreamOrder,
	MessageId,
	type ModelRequest,
	type ProviderStreamEvent,
} from "@pk/schema";
import { createOpenAIProvider } from "./adapter.ts";

const live = process.env.PK_LIVE_TEST === "1";
const baseURL = process.env.PK_LIVE_BASE_URL ?? "https://api.openai.com/v1";
const model = process.env.PK_LIVE_MODEL ?? "";
const apiKey = process.env.PK_LIVE_API_KEY ?? NO_KEY_PLACEHOLDER;

const provider = createOpenAIProvider({
	id: "live",
	baseURL,
	apiKey: () => apiKey,
	keyHint: "PK_LIVE_API_KEY is set and valid",
	newId: createIdFactory({
		now: () => Date.now(),
		randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
	}),
});

const ask = (text: string, withTool: boolean): ModelRequest => ({
	model: { provider: "live", model },
	system: "You are a terse test assistant.",
	messages: [
		{
			id: MessageId.parse("msg_01JDX8Z3QK5V7W9Y0A2B4C6D01"),
			at: new Date().toISOString(),
			role: "user",
			content: [{ type: "text", text }],
		},
	],
	tools: withTool
		? [
				{
					name: "read_file",
					description: "Read a file by path.",
					inputSchema: {
						type: "object",
						properties: { path: { type: "string" } },
						required: ["path"],
					},
					kind: "read",
				},
			]
		: [],
	maxOutputTokens: 200,
});

async function run(request: ModelRequest): Promise<ProviderStreamEvent[]> {
	const events: ProviderStreamEvent[] = [];
	for await (const event of provider.stream(request, {
		signal: AbortSignal.timeout(60_000),
	})) {
		events.push(event);
	}
	return events;
}

describe.skipIf(!live)("live endpoint (PK_LIVE_TEST=1)", () => {
	test("a text reply", async () => {
		const events = await run(ask("Reply with the single word: pong", false));
		expect(checkStreamOrder(events)).toEqual([]);
		expect(events.some((e) => e.type === "text_delta")).toBe(true);
		expect(events.at(-1)).toMatchObject({ type: "stop" });
	}, 60_000);

	test("one tool call", async () => {
		const events = await run(
			ask("Call read_file with path README.md. Do not answer in text.", true),
		);
		expect(checkStreamOrder(events)).toEqual([]);
		expect(events.find((e) => e.type === "tool_call_end")).toMatchObject({
			input: { path: "README.md" },
		});
		expect(events.at(-1)).toEqual({ type: "stop", reason: "tool_use" });
	}, 60_000);
});
