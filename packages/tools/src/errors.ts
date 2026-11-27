import { PkError } from "@pk/env";

/** The stable codes a tool failure carries. Each one's `message` is the text the model sees. */
export type ToolErrorCode =
	| "tool.outside_project"
	| "tool.not_found"
	| "tool.is_directory"
	| "tool.not_regular_file"
	| "tool.access_denied"
	| "tool.too_large"
	| "tool.binary_file"
	| "tool.offset_past_end";

/**
 * A tool failure the model can act on. The loop turns it into an error result with `message` as
 * its text, so the message is written for the model, not for a log.
 */
export class ToolError extends PkError {
	declare readonly code: ToolErrorCode;

	constructor(code: ToolErrorCode, message: string) {
		super(code, message);
	}
}

/** The Node error `code` (`ENOENT`, `EACCES`, ...) of a thrown file system error, or `undefined`. */
export function fsErrorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("code" in error)) {
		return undefined;
	}
	return typeof error.code === "string" ? error.code : undefined;
}
