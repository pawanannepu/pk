/**
 * @pk/tools: The Tool interface (definition plus executor) and the built in tools. Tools never ask for permission themselves.
 *
 * #6 (spec 0005) ships the interface, `defineTool` and the first tool, `read_file`. Tools read the
 * disk only through the `FileSystem` port that `cli` builds, and return `FileStamp`s for the ledger.
 */

/** `ToolError`, the failure a tool throws for the model to see, with its stable codes. */
export { ToolError, type ToolErrorCode } from "./errors.ts";
/** The project root check every file tool uses. */
export { resolveInProject, type ScopedPath } from "./path-scope.ts";
/** `read_file` and its limits. */
export {
	EMPTY_FILE_TEXT,
	READ_MAX_FILE_BYTES,
	READ_MAX_LINE_CHARS,
	READ_MAX_LINES,
	READ_MAX_OUTPUT_BYTES,
	ReadFileInput,
	readFileTool,
} from "./read-file.ts";
/** The tool interface, its context and outcome, the file system port, and `defineTool`. */
export {
	defineTool,
	type FileStamp,
	type FileStat,
	type FileSystem,
	invalidInputText,
	type Tool,
	type ToolContext,
	type ToolOutcome,
	type ToolSpec,
	type ToolValidation,
	textOutcome,
} from "./tool.ts";
