import { redact } from "@pk/env";
import {
	type CallId,
	DENIED_TEXT,
	JsonValue,
	type PermissionAnswer,
	type PermissionMode,
	PLAN_BLOCKED_TEXT,
	type ToolResultBlock,
} from "@pk/schema";
import type { ToolOutcome } from "@pk/tools";

/** Error texts are cut to this many characters (spec 0005 AC-4). */
export const ERROR_TEXT_MAX = 2000;

/** The result of a call the user interrupted before it ran. */
export const INTERRUPTED_BEFORE_TEXT =
	"The user interrupted before this tool call ran.";
/** The result of the call that was running when the user interrupted. */
export const INTERRUPTED_DURING_TEXT = "The user interrupted this tool call.";
/** The `tool_result` event text for a started call of a reply dropped on error. Never saved. */
export const REPLY_FAILED_TEXT = "the reply failed before this call finished";
/** The `turn_end` message for anything that is not a provider error. The raw error goes to the log. */
export const INTERNAL_ERROR_TEXT =
	"pk hit an internal error. See the log for details.";

/** The AC-4 text for a tool name the session does not have. */
export function unknownToolText(
	name: string,
	available: readonly string[],
): string {
	return `Unknown tool "${name}". Available tools: ${available.join(", ")}.`;
}

/** The AC-4 text for a call whose arguments were not valid JSON. */
export function inputErrorText(inputError: string): string {
	return `The arguments could not be used: ${inputError}. Call the tool again with a JSON object that matches its input schema.`;
}

/** The AC-4 text for a tool that threw something other than a `PkError`. */
export function unexpectedText(name: string, message: string): string {
	return `${name} failed unexpectedly: ${message}`;
}

/** The result of a call plan mode blocked (spec 0006 AC-3). */
export const PLAN_BLOCKED_RESULT_TEXT = `${PLAN_BLOCKED_TEXT}: pk is read only right now, so this call did not run. Keep exploring with read tools and describe your plan; the user will switch modes when ready.`;

/** A deny's note, trimmed; `undefined` when there is none or it is only spaces (a plain deny). */
export function denyNote(
	answer: Extract<PermissionAnswer, { decision: "deny" }>,
): string | undefined {
	const note = answer.note?.trim() ?? "";
	return note === "" ? undefined : note;
}

/** The denied text, with your trimmed note when you gave one (spec 0006 AC-4, AC-5). */
export function deniedText(
	answer: Extract<PermissionAnswer, { decision: "deny" }>,
): string {
	const note = denyNote(answer);
	return note === undefined ? DENIED_TEXT : `${DENIED_TEXT} (note: ${note})`;
}

/** A mode in words, as notices show it: `accept edits`, `skip all`. */
export function modeWords(mode: PermissionMode): string {
	switch (mode) {
		case "normal":
			return "normal";
		case "accept_edits":
			return "accept edits";
		case "plan":
			return "plan";
		case "skip_all":
			return "skip all";
		default: {
			const unhandled: never = mode;
			return unhandled;
		}
	}
}

/** Redacts, then cuts to `ERROR_TEXT_MAX` characters with `…` added when it was cut. Pure. */
export function clipErrorText(text: string): string {
	const clean = redact(text);
	return clean.length > ERROR_TEXT_MAX
		? `${clean.slice(0, ERROR_TEXT_MAX)}…`
		: clean;
}

/** An error outcome with one text block. */
export function errorOutcome(text: string): ToolOutcome {
	return { content: [{ type: "text", text }], isError: true };
}

/** `details` as JSON for the result block. A parse, not a cast: the readonly display shape is plain JSON. */
function detailsField(details: ToolOutcome["details"]): {
	details?: JsonValue;
} {
	if (details === undefined) return {};
	const parsed = JsonValue.safeParse(details);
	return parsed.success ? { details: parsed.data } : {};
}

/**
 * Wraps an outcome into the call's result block. Error texts are redacted and cut; successful
 * content is never touched (each tool applies its own caps). Pure.
 */
export function resultBlock(
	callId: CallId,
	outcome: ToolOutcome,
): ToolResultBlock {
	const content = outcome.isError
		? outcome.content.map((block) =>
				block.type === "text"
					? { ...block, text: clipErrorText(block.text) }
					: block,
			)
		: outcome.content;
	return {
		type: "tool_result",
		callId,
		isError: outcome.isError,
		content,
		...detailsField(outcome.details),
	};
}
