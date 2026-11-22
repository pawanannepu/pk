import {
	type AssistantMessage,
	type Message,
	type ToolResultBlock,
	toolCallsOf,
	toolResultsOf,
	type UserContentBlock,
	type UserMessage,
} from "./conversation.ts";
import type { CallId, MessageId } from "./primitives.ts";

/** The text of the error result repair adds for a call that has no recorded result. */
export const REPAIRED_RESULT_TEXT = "No result was recorded for this call.";

/** What can be wrong with the pairing of calls and results in a conversation. */
export type ConversationIssueCode =
	| "missing_result"
	| "orphan_result"
	| "duplicate_result"
	| "duplicate_call_id";

/** One problem `checkConversation` found. `messageIndex` points at the message that holds it. */
export interface ConversationIssue {
	readonly code: ConversationIssueCode;
	readonly messageIndex: number;
	readonly callId?: CallId;
	readonly message: string;
}

/**
 * Checks that every tool call has exactly one result in the message directly after it, every result
 * answers a call in the message directly before it, and no `CallId` is used twice. Returns one issue
 * per problem; a valid conversation returns `[]`.
 *
 * An assistant message with calls as the last message is valid (a turn in progress). Two messages
 * with the same role in a row are valid pk data; adapters merge them where their API needs it.
 */
export function checkConversation(
	messages: readonly Message[],
): ConversationIssue[] {
	const issues: ConversationIssue[] = [];
	const seenCalls = new Set<CallId>();

	messages.forEach((message, index) => {
		if (message.role === "assistant") {
			const calls = toolCallsOf(message);
			for (const call of calls) {
				if (seenCalls.has(call.id)) {
					issues.push({
						code: "duplicate_call_id",
						messageIndex: index,
						callId: call.id,
						message: `call ID ${call.id} is used by more than one tool call`,
					});
				}
				seenCalls.add(call.id);
			}
			const next = messages[index + 1];
			if (next === undefined) return; // a pending last message
			const answered = new Set(toolResultsOf(next).map((r) => r.callId));
			for (const call of calls) {
				if (!answered.has(call.id)) {
					issues.push({
						code: "missing_result",
						messageIndex: index,
						callId: call.id,
						message: `tool call ${call.id} has no result in the next message`,
					});
				}
			}
			return;
		}

		const previous = index > 0 ? messages[index - 1] : undefined;
		const asked = new Set(
			previous === undefined ? [] : toolCallsOf(previous).map((c) => c.id),
		);
		const answered = new Set<CallId>();
		for (const result of toolResultsOf(message)) {
			if (!asked.has(result.callId)) {
				issues.push({
					code: "orphan_result",
					messageIndex: index,
					callId: result.callId,
					message: `tool result ${result.callId} has no call in the message before it`,
				});
			} else if (answered.has(result.callId)) {
				issues.push({
					code: "duplicate_result",
					messageIndex: index,
					callId: result.callId,
					message: `tool call ${result.callId} has more than one result`,
				});
			}
			answered.add(result.callId);
		}
	});

	return issues;
}

/** Options for `repairConversation`. */
export interface RepairOptions {
	/** Mints the ID of a user message repair has to insert. */
	readonly newId: (prefix: "msg") => MessageId;
	/** Also answer the calls of a pending last assistant message (true when resuming a session). */
	readonly closePendingTail: boolean;
}

/** The result of `repairConversation`. */
export interface RepairResult {
	readonly messages: readonly Message[];
	/** Results added, plus results dropped, plus duplicate calls dropped. 0 means nothing changed. */
	readonly changes: number;
}

function syntheticResult(callId: CallId): ToolResultBlock {
	return {
		type: "tool_result",
		callId,
		isError: true,
		content: [{ type: "text", text: REPAIRED_RESULT_TEXT }],
	};
}

/**
 * Returns a conversation `checkConversation` accepts, changing as little as it can:
 *
 * - A tool call whose `CallId` was already used is dropped (the first one wins). An assistant message
 *   left empty by that is removed, unless its `stopReason` is `aborted`.
 * - A result whose call is not in the message directly before it, or a second result for one call, is
 *   dropped. A user message left with no blocks is removed.
 * - A call with no result gets a synthetic error result with `REPAIRED_RESULT_TEXT`. It goes into the
 *   next message when that is a user message (after its existing results), otherwise into a new user
 *   message inserted directly after, with the assistant message's `at` and an ID from `newId("msg")`.
 * - A pending last message's calls are answered only when `closePendingTail` is true.
 *
 * Pure: it never mutates its input.
 */
export function repairConversation(
	messages: readonly Message[],
	options: RepairOptions,
): RepairResult {
	let changes = 0;

	// Pass 1: drop duplicate calls and results that do not answer the message before them.
	const seenCalls = new Set<CallId>();
	const cleaned: Message[] = [];
	for (const message of messages) {
		if (message.role === "assistant") {
			const content = message.content.filter((block) => {
				if (block.type !== "tool_call") return true;
				if (seenCalls.has(block.id)) {
					changes++;
					return false;
				}
				seenCalls.add(block.id);
				return true;
			});
			if (content.length === 0 && message.stopReason !== "aborted") continue;
			cleaned.push(
				content.length === message.content.length
					? message
					: { ...message, content },
			);
			continue;
		}

		const previous = cleaned.at(-1);
		const asked = new Set(
			previous === undefined ? [] : toolCallsOf(previous).map((c) => c.id),
		);
		const answered = new Set<CallId>();
		const content = message.content.filter((block) => {
			if (block.type !== "tool_result") return true;
			if (!asked.has(block.callId) || answered.has(block.callId)) {
				changes++;
				return false;
			}
			answered.add(block.callId);
			return true;
		});
		if (content.length === 0) continue;
		cleaned.push(
			content.length === message.content.length
				? message
				: { ...message, content },
		);
	}

	// Pass 2: answer every call that has no result.
	const repaired: Message[] = [];
	cleaned.forEach((message, index) => {
		const next = cleaned[index + 1];
		if (message.role === "user") {
			const previous = cleaned[index - 1];
			if (previous?.role === "assistant") {
				const filled = fillResults(previous, message);
				changes += filled.added;
				repaired.push(filled.message);
				return;
			}
			repaired.push(message);
			return;
		}

		repaired.push(message);
		const calls = toolCallsOf(message);
		if (calls.length === 0) return;
		if (next === undefined && !options.closePendingTail) return;
		if (next?.role === "user") return; // filled when the user message is reached
		changes += calls.length;
		repaired.push({
			id: options.newId("msg"),
			role: "user",
			at: message.at,
			content: calls.map((call) => syntheticResult(call.id)),
		});
	});

	return { messages: repaired, changes };
}

/** Adds synthetic results to `user` for every call of `assistant` it does not answer. */
function fillResults(
	assistant: AssistantMessage,
	user: UserMessage,
): { message: UserMessage; added: number } {
	const answered = new Set(toolResultsOf(user).map((r) => r.callId));
	const missing = toolCallsOf(assistant)
		.filter((call) => !answered.has(call.id))
		.map((call) => syntheticResult(call.id));
	if (missing.length === 0) return { message: user, added: 0 };

	// Insert after the last existing result, or at the start when there is none.
	const lastResult = user.content.findLastIndex(
		(block) => block.type === "tool_result",
	);
	const content: readonly UserContentBlock[] = [
		...user.content.slice(0, lastResult + 1),
		...missing,
		...user.content.slice(lastResult + 1),
	];
	return { message: { ...user, content }, added: missing.length };
}
