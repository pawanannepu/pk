import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { callId, MODEL } from "./fixtures.test-support.ts";
import {
	Cost,
	checkStreamOrder,
	ModelRequest,
	type ProviderStreamEvent,
	sumCosts,
	sumUsage,
	toolInputJsonSchema,
	Usage,
} from "./index.ts";

describe("Cost and its sums (AC-5)", () => {
	test("unknown has no amount; provider and catalog need a whole amount of zero or more", () => {
		expect(Cost.safeParse({ source: "unknown" }).success).toBe(true);
		expect(Cost.safeParse({ source: "unknown", microUsd: 0 }).success).toBe(
			false,
		);
		expect(Cost.safeParse({ source: "provider", microUsd: 0 }).success).toBe(
			true,
		);
		expect(Cost.safeParse({ source: "catalog", microUsd: 1500 }).success).toBe(
			true,
		);
		expect(Cost.safeParse({ source: "catalog" }).success).toBe(false);
		expect(Cost.safeParse({ source: "catalog", microUsd: 1.5 }).success).toBe(
			false,
		);
		expect(Cost.safeParse({ source: "provider", microUsd: -1 }).success).toBe(
			false,
		);
	});

	test("an unknown cost is counted, never added as zero", () => {
		expect(
			sumCosts([{ source: "catalog", microUsd: 1500 }, { source: "unknown" }]),
		).toEqual({
			knownMicroUsd: 1500,
			unknownCalls: 1,
		});
		expect(
			sumCosts([
				{ source: "provider", microUsd: 7 },
				{ source: "catalog", microUsd: 3 },
			]),
		).toEqual({
			knownMicroUsd: 10,
			unknownCalls: 0,
		});
	});

	test("sumUsage adds field by field and keeps reasoning only when some input has it", () => {
		expect(sumUsage([])).toEqual(Usage.parse({}));
		const a = Usage.parse({
			inputTokens: 1,
			cacheReadTokens: 2,
			cacheWriteTokens: 3,
			outputTokens: 4,
		});
		const b = Usage.parse({
			inputTokens: 10,
			outputTokens: 40,
			reasoningTokens: 5,
		});
		expect(sumUsage([a, a])).toEqual({
			inputTokens: 2,
			cacheReadTokens: 4,
			cacheWriteTokens: 6,
			outputTokens: 8,
		});
		expect(sumUsage([a, b])).toEqual({
			inputTokens: 11,
			cacheReadTokens: 2,
			cacheWriteTokens: 3,
			outputTokens: 44,
			reasoningTokens: 5,
		});
	});
});

describe("ModelRequest and tool definitions", () => {
	test("tool names are unique in one request", () => {
		const tool = {
			name: "read_file",
			description: "Read a file.",
			inputSchema: { type: "object" },
			kind: "read",
		};
		const request = {
			model: MODEL,
			system: "You are pk.",
			messages: [],
			tools: [tool],
		};
		expect(ModelRequest.safeParse(request).success).toBe(true);
		expect(
			ModelRequest.safeParse({ ...request, tools: [tool, tool] }).success,
		).toBe(false);
	});

	test("toolInputJsonSchema gives a JSON Schema object without the top level $schema (AC-15)", () => {
		const schema = toolInputJsonSchema(
			z.strictObject({ path: z.string(), limit: z.number().int().optional() }),
		);
		expect(schema).toEqual({
			type: "object",
			properties: {
				path: { type: "string" },
				limit: {
					type: "integer",
					minimum: -9007199254740991,
					maximum: 9007199254740991,
				},
			},
			required: ["path"],
			additionalProperties: false,
		});
	});
});

describe("checkStreamOrder (AC-7)", () => {
	const a = callId(1);
	const b = callId(2);
	const usage = {
		type: "usage",
		usage: Usage.parse({ inputTokens: 1 }),
	} as const;

	test("a well formed stream has no issues", () => {
		const events: ProviderStreamEvent[] = [
			{ type: "reasoning_delta", text: "think" },
			{ type: "reasoning_replay", data: "sig" },
			{ type: "reasoning_delta", text: "more" },
			{ type: "text_delta", text: "hi" },
			{ type: "tool_call_start", callId: a, name: "read_file" },
			{ type: "tool_call_start", callId: b, name: "read_file" },
			{ type: "tool_call_delta", callId: a, argsText: '{"pa' },
			{ type: "text_delta", text: "!" },
			{ type: "tool_call_end", callId: a, input: { path: "a" } },
			{ type: "tool_call_end", callId: b, input: {}, inputError: "not JSON" },
			usage,
			{ type: "stop", reason: "tool_use" },
		];
		expect(checkStreamOrder(events)).toEqual([]);
	});

	test("reports every ordering problem", () => {
		const events: ProviderStreamEvent[] = [
			{ type: "tool_call_delta", callId: a, argsText: "x" },
			{ type: "tool_call_start", callId: b, name: "read_file" },
			{ type: "tool_call_start", callId: b, name: "read_file" },
			{ type: "tool_call_start", callId: a, name: "read_file" },
			{ type: "tool_call_end", callId: a, input: {} },
			{ type: "tool_call_end", callId: a, input: {} },
			usage,
			usage,
			{ type: "stop", reason: "end_turn" },
			{ type: "text_delta", text: "late" },
			{ type: "stop", reason: "end_turn" },
		];
		expect(checkStreamOrder(events).map((i) => [i.code, i.eventIndex])).toEqual(
			[
				["unknown_call", 0],
				["duplicate_call_start", 2],
				["after_call_end", 5],
				["multiple_usage", 7],
				["unfinished_call", 8],
				["after_stop", 9],
				["multiple_stop", 10],
			],
		);
	});

	test("a stream with no stop is reported at its end", () => {
		expect(checkStreamOrder([{ type: "text_delta", text: "hi" }])).toEqual([
			{ code: "no_stop", eventIndex: 1, message: "the stream has no stop" },
		]);
	});

	test("a call left open in a stream with no stop is reported at the end, after no_stop", () => {
		// covers: AC-7 (a cut off stream must still flag the open call, not only the missing stop)
		const events: ProviderStreamEvent[] = [
			{ type: "tool_call_start", callId: a, name: "read_file" },
			{ type: "tool_call_delta", callId: a, argsText: '{"pa' },
		];
		expect(
			checkStreamOrder(events).map((i) => [i.code, i.eventIndex, i.callId]),
		).toEqual([
			["no_stop", 2, undefined],
			["unfinished_call", 2, a],
		]);
	});

	test("an aborted stop allows an unfinished call; any other stop still reports it", () => {
		// covers: spec 0004 AC-5 (the amended spec 0002 AC-7)
		const open: ProviderStreamEvent[] = [
			{ type: "tool_call_start", callId: a, name: "read_file" },
			{ type: "tool_call_delta", callId: a, argsText: '{"pa' },
		];
		expect(
			checkStreamOrder([...open, { type: "stop", reason: "aborted" }]),
		).toEqual([]);
		expect(
			checkStreamOrder([...open, { type: "stop", reason: "end_turn" }]).map(
				(i) => i.code,
			),
		).toEqual(["unfinished_call"]);
	});

	test("after an aborted stop, late call events are still after_stop", () => {
		// covers: spec 0004 AC-5
		const events: ProviderStreamEvent[] = [
			{ type: "tool_call_start", callId: a, name: "read_file" },
			{ type: "stop", reason: "aborted" },
			{ type: "tool_call_end", callId: a, input: {} },
		];
		expect(checkStreamOrder(events).map((i) => i.code)).toEqual(["after_stop"]);
	});

	test("a delta after its call ended is after_call_end, not unknown_call", () => {
		// covers: AC-7
		const events: ProviderStreamEvent[] = [
			{ type: "tool_call_start", callId: a, name: "read_file" },
			{ type: "tool_call_end", callId: a, input: {} },
			{ type: "tool_call_delta", callId: a, argsText: "late" },
			{ type: "stop", reason: "tool_use" },
		];
		expect(checkStreamOrder(events)).toEqual([
			{
				code: "after_call_end",
				eventIndex: 2,
				callId: a,
				message: `tool_call_delta for ${a} after its tool_call_end`,
			},
		]);
	});

	test("an empty stream is only missing its stop", () => {
		// covers: AC-7
		expect(checkStreamOrder([]).map((i) => [i.code, i.eventIndex])).toEqual([
			["no_stop", 0],
		]);
	});
});
