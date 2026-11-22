/**
 * Shared test values for this package's tests. Not exported from `index.ts`; imported only by
 * `*.test.ts` files.
 */
import {
	type AssistantMessage,
	CallId,
	type Message,
	MessageId,
	type ModelRef,
	type UserMessage,
} from "./index.ts";

/** A fixed, valid ID body for prefix `n` (two digits), so tests read clearly. */
export function body(n: number): string {
	return `01JDX8Z3QK5V7W9Y0A2B4C6D${String(n).padStart(2, "0")}`;
}

export const msgId = (n: number): MessageId =>
	MessageId.parse(`msg_${body(n)}`);
export const callId = (n: number): CallId => CallId.parse(`call_${body(n)}`);

export const AT = "2026-11-22T10:15:30.123Z";
export const MODEL: ModelRef = {
	provider: "openrouter",
	model: "anthropic/claude-x",
};

/** A tiny 1x1 PNG, base64. */
export const PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export function user(n: number, content: UserMessage["content"]): UserMessage {
	return { id: msgId(n), role: "user", at: AT, content };
}

export function assistant(
	n: number,
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "tool_use",
): AssistantMessage {
	return {
		id: msgId(n),
		role: "assistant",
		at: AT,
		model: MODEL,
		stopReason,
		content,
	};
}

export const text = (t: string) => ({ type: "text", text: t }) as const;

export const call = (n: number, name = "read_file") =>
	({
		type: "tool_call",
		id: callId(n),
		name,
		input: { path: "a.ts" },
	}) as const;

export const result = (n: number, isError = false) =>
	({
		type: "tool_result",
		callId: callId(n),
		isError,
		content: [{ type: "text", text: "ok" }],
	}) as const;

/** A conversation using every block type: text, image, reasoning with replay, two parallel calls, an error result with details. */
export const EVERY_BLOCK: readonly Message[] = [
	user(1, [
		text("What is in a.ts and b.ts?"),
		{ type: "image", mediaType: "image/png", data: PNG },
	]),
	assistant(2, [
		{
			type: "reasoning",
			text: "Read both files.",
			replay: { api: "anthropic_messages", model: MODEL, data: "opaque-token" },
		},
		text("Reading both."),
		call(3),
		{
			type: "tool_call",
			id: callId(4),
			name: "read_file",
			input: { path: "b.ts" },
		},
	]),
	user(5, [
		result(3),
		{
			type: "tool_result",
			callId: callId(4),
			isError: true,
			content: [{ type: "text", text: "b.ts not found" }],
			details: { path: "b.ts", errno: -2, tried: ["b.ts", "./b.ts"] },
		},
	]),
	assistant(
		6,
		[text("a.ts exports one function; b.ts is missing.")],
		"end_turn",
	),
];

/** Makes message IDs for repair and fold, counting up from 90. */
export function idMaker(): (prefix: "msg") => MessageId {
	let n = 90;
	return () => msgId(n++);
}
