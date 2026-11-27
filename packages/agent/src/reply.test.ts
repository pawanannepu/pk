import { describe, expect, test } from "bun:test";
import type { ProviderStreamEvent } from "@pk/schema";
import { EMPTY_FOLD, foldEvent, type ReplyFold, replyBlocks } from "./reply.ts";
import { callId } from "./test-support.ts";

const origin = {
	api: "openai_chat",
	model: { provider: "fake", model: "m" },
} as const;

const fold = (events: readonly ProviderStreamEvent[]): ReplyFold =>
	events.reduce(foldEvent, EMPTY_FOLD);

const blocks = (events: readonly ProviderStreamEvent[]) =>
	replyBlocks(fold(events), origin);

describe("the reply fold (spec 0005 AC-8)", () => {
	test("text deltas in a row merge into one text block", () => {
		expect(
			blocks([
				{ type: "text_delta", text: "hel" },
				{ type: "text_delta", text: "lo" },
			]),
		).toEqual([{ type: "text", text: "hello" }]);
	});

	test("text split by a call becomes two text blocks around the call, in arrival order", () => {
		expect(
			blocks([
				{ type: "text_delta", text: "before" },
				{ type: "tool_call_start", callId: callId(1), name: "read_file" },
				{ type: "text_delta", text: "after" },
				{ type: "tool_call_end", callId: callId(1), input: { path: "a" } },
			]),
		).toEqual([
			{ type: "text", text: "before" },
			{
				type: "tool_call",
				id: callId(1),
				name: "read_file",
				input: { path: "a" },
			},
			{ type: "text", text: "after" },
		]);
	});

	test("a call keeps the place of its start even when calls end out of order", () => {
		const out = blocks([
			{ type: "tool_call_start", callId: callId(1), name: "a" },
			{ type: "tool_call_start", callId: callId(2), name: "b" },
			{ type: "tool_call_end", callId: callId(2), input: {} },
			{ type: "tool_call_end", callId: callId(1), input: {} },
		]);
		expect(out.map((b) => (b.type === "tool_call" ? b.name : b.type))).toEqual([
			"a",
			"b",
		]);
	});

	test("a call that started but never ended is dropped", () => {
		expect(
			blocks([
				{ type: "text_delta", text: "hi" },
				{ type: "tool_call_start", callId: callId(1), name: "read_file" },
			]),
		).toEqual([{ type: "text", text: "hi" }]);
	});

	test("an inputError on the end is kept on the call block", () => {
		const [call] = blocks([
			{ type: "tool_call_start", callId: callId(1), name: "read_file" },
			{
				type: "tool_call_end",
				callId: callId(1),
				input: {},
				inputError: "bad json",
			},
		]);
		expect(call).toMatchObject({ type: "tool_call", inputError: "bad json" });
	});

	test("a call with no inputError has no inputError key at all", () => {
		const [call] = blocks([
			{ type: "tool_call_start", callId: callId(1), name: "read_file" },
			{ type: "tool_call_end", callId: callId(1), input: {} },
		]);
		expect(call !== undefined && "inputError" in call).toBe(false);
	});

	test("a reasoning replay closes the block and carries the provider's api and the model", () => {
		expect(
			blocks([
				{ type: "reasoning_delta", text: "think" },
				{ type: "reasoning_delta", text: "ing" },
				{ type: "reasoning_replay", data: "tok1" },
				{ type: "reasoning_delta", text: "more" },
			]),
		).toEqual([
			{
				type: "reasoning",
				text: "thinking",
				replay: { ...origin, data: "tok1" },
			},
			{ type: "reasoning", text: "more" },
		]);
	});

	test("a replay with no open reasoning block starts an empty one", () => {
		expect(
			blocks([
				{ type: "text_delta", text: "x" },
				{ type: "reasoning_replay", data: "tok" },
			]),
		).toEqual([
			{ type: "text", text: "x" },
			{ type: "reasoning", text: "", replay: { ...origin, data: "tok" } },
		]);
	});

	test("usage and stop are recorded, and tool_call_delta changes nothing", () => {
		const usage = {
			inputTokens: 1,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			outputTokens: 2,
		};
		const before = fold([
			{ type: "tool_call_start", callId: callId(1), name: "a" },
		]);
		expect(
			foldEvent(before, {
				type: "tool_call_delta",
				callId: callId(1),
				argsText: '{"pa',
			}),
		).toBe(before);
		const f = fold([
			{ type: "usage", usage, providerCostMicroUsd: 7 },
			{ type: "stop", reason: "max_tokens" },
		]);
		expect(f.usage).toEqual({ usage, providerCostMicroUsd: 7 });
		expect(f.stop).toBe("max_tokens");
	});

	test("folding never changes the fold it was given", () => {
		const first = fold([{ type: "text_delta", text: "a" }]);
		foldEvent(first, { type: "text_delta", text: "b" });
		expect(replyBlocks(first, origin)).toEqual([{ type: "text", text: "a" }]);
	});

	test("no events give no blocks", () => {
		expect(blocks([])).toEqual([]);
	});
});
