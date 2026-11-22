import { z } from "zod";
import {
	ApiStyle,
	CallId,
	JsonObject,
	JsonValue,
	MessageId,
	ModelRef,
	Timestamp,
} from "./primitives.ts";

/** Plain text, from you or the model. */
export const TextBlock = z
	.object({ type: z.literal("text"), text: z.string() })
	.readonly();
/** Plain text, from you or the model. */
export type TextBlock = z.infer<typeof TextBlock>;

/** The image formats pk accepts. */
export const ImageMediaType = z.enum([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
]);
/** The image formats pk accepts. */
export type ImageMediaType = z.infer<typeof ImageMediaType>;

/**
 * An image as base64 data. Always base64 in a `Message`; saved files hold a `StoredImageBlock`
 * (a blob reference) instead, so adapters only ever see base64.
 */
export const ImageBlock = z
	.object({
		type: z.literal("image"),
		mediaType: ImageMediaType,
		data: z.base64(),
	})
	.readonly();
/** An image as base64 data. */
export type ImageBlock = z.infer<typeof ImageBlock>;

/** The opaque token some APIs need sent back with a reasoning block, tagged with the API and model that made it. */
export const ReasoningReplay = z
	.object({ api: ApiStyle, model: ModelRef, data: z.string() })
	.readonly();
/** The opaque reasoning replay token. */
export type ReasoningReplay = z.infer<typeof ReasoningReplay>;

/**
 * The model's reasoning. `text` may be empty. An adapter sends `replay` back only when both `api`
 * and `model` match the current request (signed reasoning is model specific); otherwise it sends the
 * text, or drops the block.
 */
export const ReasoningBlock = z
	.object({
		type: z.literal("reasoning"),
		text: z.string(),
		replay: ReasoningReplay.optional(),
	})
	.readonly();
/** The model's reasoning. */
export type ReasoningBlock = z.infer<typeof ReasoningBlock>;

/** The rule a tool name follows: letters, digits, `_` and `-`, 1 to 64 characters. */
export const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** A tool's name. */
export const ToolName = z
	.string()
	.regex(TOOL_NAME_PATTERN, `tool name must match ${TOOL_NAME_PATTERN.source}`);
/** A tool's name. */
export type ToolName = z.infer<typeof ToolName>;

/**
 * A tool call the model made. When the model's arguments are not valid JSON, the adapter sets
 * `input: {}` and `inputError` to a short description, and the loop answers with an error result.
 */
export const ToolCallBlock = z
	.object({
		type: z.literal("tool_call"),
		id: CallId,
		name: ToolName,
		input: JsonObject,
		inputError: z.string().max(2000).optional(),
	})
	.readonly();
/** A tool call the model made. */
export type ToolCallBlock = z.infer<typeof ToolCallBlock>;

/** The fields every tool result shares, whatever its image form. Shared with the saved form. */
export const toolResultFields = {
	type: z.literal("tool_result"),
	callId: CallId,
	isError: z.boolean(),
	details: JsonValue.optional(),
} as const;

/** A block inside a tool result: text or an image. */
export const ToolResultContentBlock = z.discriminatedUnion("type", [
	TextBlock,
	ImageBlock,
]);
/** A block inside a tool result. */
export type ToolResultContentBlock = z.infer<typeof ToolResultContentBlock>;

/**
 * A tool's answer to one call. `details` is for the screen and saved files only and is never sent
 * to a model; each tool declares its own `details` schema in `@pk/tools`.
 */
export const ToolResultBlock = z
	.object({
		...toolResultFields,
		content: z.array(ToolResultContentBlock).readonly(),
	})
	.readonly();
/** A tool's answer to one call. */
export type ToolResultBlock = z.infer<typeof ToolResultBlock>;

/** Why the model stopped. Any provider reason pk does not map becomes `other`, and the raw value is not kept. */
export const StopReason = z.enum([
	"end_turn",
	"tool_use",
	"max_tokens",
	"refusal",
	"aborted",
	"other",
]);
/** Why the model stopped. */
export type StopReason = z.infer<typeof StopReason>;

/** The fields every message shares. Shared with the saved form. */
export const messageFields = { id: MessageId, at: Timestamp } as const;

/** A block in a user message: text, an image, or a tool result. */
export const UserContentBlock = z.discriminatedUnion("type", [
	TextBlock,
	ImageBlock,
	ToolResultBlock,
]);
/** A block in a user message. */
export type UserContentBlock = z.infer<typeof UserContentBlock>;

/** Your input, or the tool results the loop sends back. Holds at least one block. */
export const UserMessage = z
	.object({
		...messageFields,
		role: z.literal("user"),
		content: z.array(UserContentBlock).min(1).readonly(),
	})
	.readonly();
/** Your input, or the tool results the loop sends back. */
export type UserMessage = z.infer<typeof UserMessage>;

/** A block in an assistant message: text, reasoning, or a tool call. */
export const AssistantContentBlock = z.discriminatedUnion("type", [
	TextBlock,
	ReasoningBlock,
	ToolCallBlock,
]);
/** A block in an assistant message. */
export type AssistantContentBlock = z.infer<typeof AssistantContentBlock>;

/** The fields of an assistant message. Images never appear here, so the saved form reuses it as is. */
const assistantShape = {
	...messageFields,
	role: z.literal("assistant"),
	model: ModelRef,
	stopReason: StopReason,
	content: z.array(AssistantContentBlock).readonly(),
} as const;

/**
 * One model reply. `content` may be empty only when `stopReason` is `aborted`. On abort, a call that
 * started but never ended is dropped; finished calls are kept and get results from the loop, or from repair.
 */
export const AssistantMessage = z
	.object(assistantShape)
	.refine((m) => m.content.length > 0 || m.stopReason === "aborted", {
		message: 'content may be empty only when stopReason is "aborted"',
		path: ["content"],
	})
	.readonly();
/** One model reply. */
export type AssistantMessage = z.infer<typeof AssistantMessage>;

/** A message in a conversation, user or assistant. The system prompt is never a message. */
export const Message = z.discriminatedUnion("role", [
	UserMessage,
	AssistantMessage,
]);
/** A message in a conversation. */
export type Message = z.infer<typeof Message>;

/** The tool calls in a message, in order. A user message has none. */
export function toolCallsOf(message: Message): readonly ToolCallBlock[] {
	if (message.role === "user") return [];
	return message.content.filter(
		(block): block is ToolCallBlock => block.type === "tool_call",
	);
}

/** The tool results in a message, in order. An assistant message has none. */
export function toolResultsOf(message: Message): readonly ToolResultBlock[] {
	if (message.role === "assistant") return [];
	return message.content.filter(
		(block): block is ToolResultBlock => block.type === "tool_result",
	);
}
