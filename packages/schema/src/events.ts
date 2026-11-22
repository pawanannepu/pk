import { z } from "zod";
import {
	Message,
	ToolCallBlock,
	ToolName,
	ToolResultBlock,
} from "./conversation.ts";
import {
	AgentId,
	CallId,
	MessageId,
	ModelRef,
	ModelRole,
	RequestId,
	Timestamp,
	TurnId,
} from "./primitives.ts";
import { Cost, ToolKind, Usage } from "./provider.ts";

/** An item on the visible to do list (#12). Any status may move back, because the model rewrites the whole list. */
export const TodoItem = z
	.object({
		content: z.string().min(1),
		status: z.enum(["pending", "in_progress", "done"]),
	})
	.readonly();
/** An item on the to do list. */
export type TodoItem = z.infer<typeof TodoItem>;

/** Your answer to a permission request, passed to `session.respond(requestId, answer)`. */
export const PermissionAnswer = z.discriminatedUnion("decision", [
	z.object({ decision: z.literal("allow_once") }).readonly(),
	z.object({ decision: z.literal("allow_session") }).readonly(),
	z
		.object({ decision: z.literal("deny"), note: z.string().optional() })
		.readonly(),
]);
/** Your answer to a permission request. */
export type PermissionAnswer = z.infer<typeof PermissionAnswer>;

/** How a turn ended. */
export const TurnEndReason = z.enum([
	"done",
	"interrupted",
	"turn_limit",
	"error",
]);
/** How a turn ended. */
export type TurnEndReason = z.infer<typeof TurnEndReason>;

/** The error a turn ended with, by stable `PkError` code. */
export const TurnError = z
	.object({ code: z.string(), message: z.string() })
	.readonly();
/** The error a turn ended with. */
export type TurnError = z.infer<typeof TurnError>;

/**
 * The envelope every event carries. `seq` starts at 0 for each session object and rises by one with
 * each event, across turns.
 */
const envelope = {
	seq: z.number().int().min(0),
	at: Timestamp,
	agentId: AgentId,
} as const;

/**
 * The one typed stream the core emits and every frontend (`tui`, `headless`, tests) reads,
 * discriminated on `type`. A turn is `turn_start`, then any number of the others, then exactly one
 * `turn_end`, which comes last. A subagent's events reuse this union with their own `agentId` (#38).
 */
export const AgentEvent = z.discriminatedUnion("type", [
	z
		.object({ ...envelope, type: z.literal("turn_start"), turnId: TurnId })
		.readonly(),
	z
		.object({
			...envelope,
			type: z.literal("text_delta"),
			messageId: MessageId,
			text: z.string(),
		})
		.readonly(),
	z
		.object({
			...envelope,
			type: z.literal("reasoning_delta"),
			messageId: MessageId,
			text: z.string(),
		})
		.readonly(),
	z
		.object({
			...envelope,
			type: z.literal("tool_call_start"),
			messageId: MessageId,
			callId: CallId,
			name: ToolName,
		})
		.readonly(),
	z
		.object({ ...envelope, type: z.literal("message"), message: Message })
		.readonly(),
	z
		.object({
			...envelope,
			type: z.literal("permission_request"),
			requestId: RequestId,
			call: ToolCallBlock,
			kind: ToolKind,
		})
		.readonly(),
	z
		.object({ ...envelope, type: z.literal("tool_run_start"), callId: CallId })
		.readonly(),
	z
		.object({
			...envelope,
			type: z.literal("tool_result"),
			result: ToolResultBlock,
			durationMs: z.number().int().min(0),
		})
		.readonly(),
	z
		.object({
			...envelope,
			type: z.literal("usage"),
			model: ModelRef,
			usage: Usage,
			cost: Cost,
		})
		.readonly(),
	z
		.object({
			...envelope,
			type: z.literal("todo_update"),
			todos: z.array(TodoItem).readonly(),
		})
		.readonly(),
	z
		.object({
			...envelope,
			type: z.literal("model_change"),
			role: ModelRole,
			model: ModelRef,
		})
		.readonly(),
	z
		.object({
			...envelope,
			type: z.literal("notice"),
			level: z.enum(["info", "warning"]),
			code: z.string(),
			text: z.string(),
		})
		.readonly(),
	z
		.object({
			...envelope,
			type: z.literal("turn_end"),
			turnId: TurnId,
			reason: TurnEndReason,
			error: TurnError.optional(),
		})
		.readonly(),
]);
/** One event of the agent's stream. */
export type AgentEvent = z.infer<typeof AgentEvent>;

/** The `type` of an `AgentEvent`. */
export type AgentEventType = AgentEvent["type"];

/** The `AgentEvent` variant with this `type`, like `AgentEventOf<"turn_end">`. */
export type AgentEventOf<T extends AgentEventType> = Extract<
	AgentEvent,
	{ readonly type: T }
>;
