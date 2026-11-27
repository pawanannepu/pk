import { describe, expect, test } from "bun:test";
import { CallId, type Message, MessageId, type ModelRequest } from "@pk/schema";
import { toChatRequest } from "./request.ts";

const AT = "2026-11-27T10:00:00.000Z";
const id = (n: number) =>
	`01JDX8Z3QK5V7W9Y0A2B4C6D${String(n).padStart(2, "0")}`;
const msg = (n: number) => MessageId.parse(`msg_${id(n)}`);
const call = (n: number) => CallId.parse(`call_${id(n)}`);
const PNG = "iVBORw0KGgo=";
const MODEL = { provider: "openai", model: "gpt-x" };

const request = (
	messages: Message[],
	extra: Partial<ModelRequest> = {},
): ModelRequest => ({
	model: MODEL,
	system: "You are pk.",
	messages,
	tools: [],
	...extra,
});

describe("toChatRequest (AC-3)", () => {
	test("system first, user runs merged, reasoning dropped, tool results split out with images after", () => {
		const body = toChatRequest(
			request([
				{
					id: msg(1),
					at: AT,
					role: "user",
					content: [{ type: "text", text: "Read a.ts" }],
				},
				{
					id: msg(2),
					at: AT,
					role: "user",
					content: [
						{ type: "text", text: "" },
						{ type: "text", text: "and b.ts" },
					],
				},
				{
					id: msg(3),
					at: AT,
					role: "assistant",
					model: MODEL,
					stopReason: "tool_use",
					content: [
						{ type: "reasoning", text: "secret thoughts" },
						{ type: "text", text: "Reading." },
						{
							type: "tool_call",
							id: call(1),
							name: "read_file",
							input: { path: "a.ts" },
						},
						{
							type: "tool_call",
							id: call(2),
							name: "shot",
							input: {},
							inputError: "bad",
						},
					],
				},
				{
					id: msg(4),
					at: AT,
					role: "user",
					content: [
						{
							type: "tool_result",
							callId: call(1),
							isError: true,
							content: [{ type: "text", text: "no such file" }],
						},
						{
							type: "tool_result",
							callId: call(2),
							isError: false,
							content: [{ type: "image", mediaType: "image/png", data: PNG }],
						},
						{ type: "text", text: "Now what?" },
					],
				},
			]),
			{ baseURL: "https://openrouter.ai/api/v1" },
		);
		expect(body.messages).toEqual([
			{ role: "system", content: "You are pk." },
			{ role: "user", content: "Read a.ts\n\nand b.ts" },
			{
				role: "assistant",
				content: "Reading.",
				tool_calls: [
					{
						id: call(1),
						type: "function",
						function: { name: "read_file", arguments: '{"path":"a.ts"}' },
					},
					{
						id: call(2),
						type: "function",
						function: { name: "shot", arguments: "{}" },
					},
				],
			},
			{ role: "tool", tool_call_id: call(1), content: "Error: no such file" },
			{
				role: "tool",
				tool_call_id: call(2),
				content: "[image output follows]",
			},
			{
				role: "user",
				content: [
					{ type: "text", text: `Image output of tool call ${call(2)}:` },
					{
						type: "image_url",
						image_url: { url: `data:image/png;base64,${PNG}` },
					},
					{ type: "text", text: "Now what?" },
				],
			},
		]);
		expect(JSON.stringify(body)).not.toContain("secret thoughts");
	});

	test("empty system and reasoning only assistant messages are left out; content null with only calls", () => {
		const body = toChatRequest(
			request(
				[
					{
						id: msg(1),
						at: AT,
						role: "user",
						content: [{ type: "text", text: "hi" }],
					},
					{
						id: msg(2),
						at: AT,
						role: "assistant",
						model: MODEL,
						stopReason: "end_turn",
						content: [{ type: "reasoning", text: "x" }],
					},
					{
						id: msg(3),
						at: AT,
						role: "user",
						content: [{ type: "text", text: "again" }],
					},
					{
						id: msg(4),
						at: AT,
						role: "assistant",
						model: MODEL,
						stopReason: "tool_use",
						content: [
							{ type: "tool_call", id: call(1), name: "ls", input: {} },
						],
					},
				],
				{ system: "" },
			),
			{ baseURL: "http://localhost:11434/v1" },
		);
		expect(body.messages).toEqual([
			{ role: "user", content: "hi\n\nagain" },
			{
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: call(1),
						type: "function",
						function: { name: "ls", arguments: "{}" },
					},
				],
			},
		]);
	});

	test("tools map without strict; the max tokens field depends on the host; nothing else is sent", () => {
		const tools = [
			{
				name: "read_file",
				description: "Read a file",
				inputSchema: { type: "object" },
				kind: "read" as const,
			},
		];
		const openai = toChatRequest(
			request([], { tools, maxOutputTokens: 1000 }),
			{ baseURL: "https://api.openai.com/v1" },
		);
		expect(openai.tools).toEqual([
			{
				type: "function",
				function: {
					name: "read_file",
					description: "Read a file",
					parameters: { type: "object" },
				},
			},
		]);
		expect(Object.keys(openai).sort()).toEqual(
			[
				"max_completion_tokens",
				"messages",
				"model",
				"stream",
				"stream_options",
				"tools",
			].sort(),
		);
		expect(openai.max_completion_tokens).toBe(1000);
		const groq = toChatRequest(request([], { maxOutputTokens: 1000 }), {
			baseURL: "https://api.groq.com/openai/v1",
		});
		expect(Object.keys(groq).sort()).toEqual(
			["max_tokens", "messages", "model", "stream", "stream_options"].sort(),
		);
		expect(
			toChatRequest(request([]), { baseURL: "https://api.openai.com/v1" })
				.model,
		).toBe("gpt-x");
	});

	test("a tool result's text blocks are joined with a newline (AC-3)", () => {
		const body = toChatRequest(
			request([
				{
					id: msg(1),
					at: AT,
					role: "user",
					content: [
						{
							type: "tool_result",
							callId: call(1),
							isError: false,
							content: [
								{ type: "text", text: "line one" },
								{ type: "text", text: "line two" },
							],
						},
					],
				},
			]),
			{ baseURL: "https://api.openai.com/v1" },
		);
		expect(body.messages.slice(1)).toEqual([
			{ role: "tool", tool_call_id: call(1), content: "line one\nline two" },
		]);
	});

	test("consecutive assistant messages merge text and concatenate tool calls (AC-3)", () => {
		const body = toChatRequest(
			request([
				{
					id: msg(1),
					at: AT,
					role: "assistant",
					model: MODEL,
					stopReason: "tool_use",
					content: [
						{ type: "text", text: "first" },
						{ type: "tool_call", id: call(1), name: "a", input: {} },
					],
				},
				{
					id: msg(2),
					at: AT,
					role: "assistant",
					model: MODEL,
					stopReason: "tool_use",
					content: [
						{ type: "text", text: "second" },
						{ type: "tool_call", id: call(2), name: "b", input: { x: 1 } },
					],
				},
			]),
			{ baseURL: "https://api.openai.com/v1" },
		);
		expect(body.messages.slice(1)).toEqual([
			{
				role: "assistant",
				content: "first\n\nsecond",
				tool_calls: [
					{
						id: call(1),
						type: "function",
						function: { name: "a", arguments: "{}" },
					},
					{
						id: call(2),
						type: "function",
						function: { name: "b", arguments: '{"x":1}' },
					},
				],
			},
		]);
	});

	test("the tool image message merges with the next user message (AC-3)", () => {
		const body = toChatRequest(
			request([
				{
					id: msg(1),
					at: AT,
					role: "user",
					content: [
						{
							type: "tool_result",
							callId: call(1),
							isError: false,
							content: [{ type: "image", mediaType: "image/png", data: PNG }],
						},
					],
				},
				{
					id: msg(2),
					at: AT,
					role: "user",
					content: [{ type: "text", text: "describe it" }],
				},
			]),
			{ baseURL: "https://api.openai.com/v1" },
		);
		expect(body.messages.slice(1)).toEqual([
			{
				role: "tool",
				tool_call_id: call(1),
				content: "[image output follows]",
			},
			{
				role: "user",
				content: [
					{ type: "text", text: `Image output of tool call ${call(1)}:` },
					{
						type: "image_url",
						image_url: { url: `data:image/png;base64,${PNG}` },
					},
					{ type: "text", text: "describe it" },
				],
			},
		]);
	});

	test("no tools leaves the tools key out, and no max tokens leaves both token keys out (AC-3)", () => {
		const body = toChatRequest(request([]), {
			baseURL: "https://api.openai.com/v1",
		});
		expect("tools" in body).toBe(false);
		expect("max_tokens" in body).toBe(false);
		expect("max_completion_tokens" in body).toBe(false);
		expect(body.stream).toBe(true);
		expect(body.stream_options).toEqual({ include_usage: true });
	});

	test("a user image becomes a part array with a data URL", () => {
		const body = toChatRequest(
			request([
				{
					id: msg(1),
					at: AT,
					role: "user",
					content: [
						{ type: "image", mediaType: "image/jpeg", data: PNG },
						{ type: "text", text: "what is this?" },
					],
				},
			]),
			{ baseURL: "https://api.openai.com/v1" },
		);
		expect(body.messages[1]).toEqual({
			role: "user",
			content: [
				{
					type: "image_url",
					image_url: { url: `data:image/jpeg;base64,${PNG}` },
				},
				{ type: "text", text: "what is this?" },
			],
		});
	});
});
