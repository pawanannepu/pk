import { describe, expect, test } from "bun:test";
import { CallId } from "@pk/schema";
import { finish, INITIAL_STATE, mapChunk } from "./stream-map.ts";
import { counterIds } from "./test-support.ts";

const call = (n: number) =>
	CallId.parse(`call_01JDX8Z3QK5V7W9Y0A2B4C6D${String(n).padStart(2, "0")}`);
const tc = (fragment: Record<string, unknown>) => ({
	choices: [{ delta: { tool_calls: [fragment] } }],
});

describe("mapChunk grouping (AC-4)", () => {
	test("arguments before the name are held and sent right after the start", () => {
		const newId = counterIds();
		const a = mapChunk(
			INITIAL_STATE,
			tc({ index: 0, function: { arguments: '{"a":' } }),
			newId,
		);
		expect(a.events).toEqual([]);
		const b = mapChunk(
			a.state,
			tc({ index: 0, function: { name: "x", arguments: "1}" } }),
			newId,
		);
		expect(b.events).toEqual([
			{ type: "tool_call_start", callId: call(1), name: "x" },
			{ type: "tool_call_delta", callId: call(1), argsText: '{"a":' },
			{ type: "tool_call_delta", callId: call(1), argsText: "1}" },
		]);
		const end = finish(b.state, { sawDone: true });
		expect("events" in end && end.events[0]).toEqual({
			type: "tool_call_end",
			callId: call(1),
			input: { a: 1 },
		});
	});

	test("a new id, or a second name, under the same index starts a new call", () => {
		const newId = counterIds();
		const a = mapChunk(
			INITIAL_STATE,
			tc({ index: 0, id: "one", function: { name: "x" } }),
			newId,
		);
		const b = mapChunk(
			a.state,
			tc({ index: 0, id: "two", function: { name: "y" } }),
			newId,
		);
		const c = mapChunk(
			b.state,
			tc({ index: 0, function: { name: "z" } }),
			newId,
		);
		expect(
			[...a.events, ...b.events, ...c.events].map(
				(e) => e.type === "tool_call_start" && e.callId,
			),
		).toEqual([call(1), call(2), call(3)]);
	});

	test("a long invalid name is repaired and cut to 64 characters", () => {
		const out = mapChunk(
			INITIAL_STATE,
			tc({ index: 0, function: { name: `${"é".repeat(70)}` } }),
			counterIds(),
		);
		expect(out.events[0]).toEqual({
			type: "tool_call_start",
			callId: call(1),
			name: "_".repeat(64),
		});
	});

	test("usage: last one wins, input never below zero, bad cost ignored", () => {
		const s1 = mapChunk(
			INITIAL_STATE,
			{ usage: { prompt_tokens: 1, completion_tokens: 1 } },
			counterIds(),
		);
		const s2 = mapChunk(
			s1.state,
			{
				usage: {
					prompt_tokens: 5,
					prompt_tokens_details: { cached_tokens: 9 },
					completion_tokens: 2,
					cost: -1,
				},
			},
			counterIds(),
		);
		const s3 = mapChunk(
			s2.state,
			{ choices: [{ finish_reason: "weird" }] },
			counterIds(),
		);
		const end = finish(s3.state, { sawDone: true });
		expect("events" in end && end.events).toEqual([
			{
				type: "usage",
				usage: {
					inputTokens: 0,
					cacheReadTokens: 9,
					cacheWriteTokens: 0,
					outputTokens: 2,
				},
			},
			{ type: "stop", reason: "other" },
		]);
	});

	test("stop reasons", () => {
		const reasonFor = (finishReason: string) => {
			const s = mapChunk(
				INITIAL_STATE,
				{ choices: [{ finish_reason: finishReason }] },
				counterIds(),
			);
			const end = finish(s.state, { sawDone: false });
			return "events" in end ? end.events.at(-1) : end.failure;
		};
		expect(reasonFor("stop")).toEqual({ type: "stop", reason: "end_turn" });
		expect(reasonFor("length")).toEqual({ type: "stop", reason: "max_tokens" });
		expect(reasonFor("content_filter")).toEqual({
			type: "stop",
			reason: "refusal",
		});
		expect(reasonFor("function_call")).toEqual({
			type: "stop",
			reason: "tool_use",
		});
		expect(
			mapChunk(
				INITIAL_STATE,
				{ choices: [{ finish_reason: "error" }] },
				counterIds(),
			).failure,
		).toEqual({ kind: "finish_error" });
	});

	test("finish_reason tool_calls is tool_use even when no call started (AC-4)", () => {
		const s = mapChunk(
			INITIAL_STATE,
			{ choices: [{ finish_reason: "tool_calls" }] },
			counterIds(),
		);
		const end = finish(s.state, { sawDone: true });
		expect("events" in end && end.events).toEqual([
			{ type: "stop", reason: "tool_use" },
		]);
	});

	test("finish_reason length wins over a started call: the stop is max_tokens (AC-4)", () => {
		const newId = counterIds();
		const a = mapChunk(
			INITIAL_STATE,
			tc({ index: 0, function: { name: "x", arguments: "{}" } }),
			newId,
		);
		const b = mapChunk(
			a.state,
			{ choices: [{ finish_reason: "length" }] },
			newId,
		);
		const end = finish(b.state, { sawDone: true });
		expect("events" in end && end.events.at(-1)).toEqual({
			type: "stop",
			reason: "max_tokens",
		});
	});
});

describe("mapChunk deltas (AC-4)", () => {
	test("reasoning_content wins over reasoning, and both come before the text of the same chunk", () => {
		const out = mapChunk(
			INITIAL_STATE,
			{
				choices: [
					{
						delta: {
							reasoning_content: "think",
							reasoning: "other",
							content: "answer",
						},
					},
				],
			},
			counterIds(),
		);
		expect(out.events).toEqual([
			{ type: "reasoning_delta", text: "think" },
			{ type: "text_delta", text: "answer" },
		]);
	});

	test("an empty reasoning_content falls back to reasoning", () => {
		const out = mapChunk(
			INITIAL_STATE,
			{ choices: [{ delta: { reasoning_content: "", reasoning: "r" } }] },
			counterIds(),
		);
		expect(out.events).toEqual([{ type: "reasoning_delta", text: "r" }]);
	});

	test("empty strings and nulls make no event", () => {
		const out = mapChunk(
			INITIAL_STATE,
			{
				choices: [
					{
						delta: {
							content: "",
							reasoning_content: null,
							reasoning: "",
							role: null,
							tool_calls: null,
						},
						finish_reason: null,
					},
				],
				usage: null,
			},
			counterIds(),
		);
		expect(out.events).toEqual([]);
		expect(out.failure).toBeUndefined();
	});

	test("with no index, fragments group by id, so two ids are two calls (AC-4)", () => {
		const newId = counterIds();
		const a = mapChunk(
			INITIAL_STATE,
			tc({ id: "a", function: { name: "x", arguments: '{"n":' } }),
			newId,
		);
		const b = mapChunk(
			a.state,
			tc({ id: "b", function: { name: "y", arguments: "{}" } }),
			newId,
		);
		const c = mapChunk(
			b.state,
			tc({ id: "a", function: { arguments: "1}" } }),
			newId,
		);
		expect(c.events).toEqual([
			{ type: "tool_call_delta", callId: call(1), argsText: "1}" },
		]);
		const end = finish(c.state, { sawDone: true });
		expect("events" in end && end.events.slice(0, 2)).toEqual([
			{ type: "tool_call_end", callId: call(1), input: { n: 1 } },
			{ type: "tool_call_end", callId: call(2), input: {} },
		]);
	});

	test("an error chunk is a failure and makes no event", () => {
		const out = mapChunk(
			INITIAL_STATE,
			{
				error: { message: "upstream broke" },
				choices: [{ delta: { content: "x" } }],
			},
			counterIds(),
		);
		expect(out.events).toEqual([]);
		expect(out.failure?.kind).toBe("error_chunk");
	});
});
