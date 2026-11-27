import { z } from "zod";
import { fsErrorCode, ToolError } from "./errors.ts";
import { resolveInProject } from "./path-scope.ts";
import {
	defineTool,
	type FileStamp,
	type FileSystem,
	textOutcome,
} from "./tool.ts";

/** The most lines one call returns. */
export const READ_MAX_LINES = 2000;
/** A longer line is cut at this many code points. */
export const READ_MAX_LINE_CHARS = 2000;
/** The formatted lines stop before passing this many UTF-8 bytes (100 KB). */
export const READ_MAX_OUTPUT_BYTES = 102_400;
/** Files larger than this (10 MB) are refused from `stat`, before any read. */
export const READ_MAX_FILE_BYTES = 10_485_760;
/** How many leading bytes are checked for a NUL to spot a binary file. */
export const READ_SNIFF_BYTES = 8192;
/** The text an empty file returns. */
export const EMPTY_FILE_TEXT = "(the file is empty)";

const NAME = "read_file";

/** The `read_file` input (spec 0005 AC-11). */
export const ReadFileInput = z.object({
	path: z
		.string()
		.min(1)
		.describe(
			"The file to read. Relative paths start at the project root. Must be inside the project.",
		),
	offset: z
		.number()
		.int()
		.min(1)
		.optional()
		.describe("The first line to read, from 1. Default 1."),
	limit: z
		.number()
		.int()
		.min(1)
		.max(READ_MAX_LINES)
		.optional()
		.describe(
			`How many lines to read, at most ${READ_MAX_LINES}. Default ${READ_MAX_LINES}.`,
		),
});
/** The `read_file` input. */
export type ReadFileInput = z.infer<typeof ReadFileInput>;

/**
 * Turns file bytes into lines: invalid UTF-8 becomes U+FFFD, then a leading BOM is removed, lines
 * split on `\n`, each loses a trailing `\r`, and a final newline adds no empty line. Pure.
 */
export function splitLines(bytes: Uint8Array): readonly string[] {
	const decoded = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
	const text = decoded.startsWith("﻿") ? decoded.slice(1) : decoded;
	if (text === "") return [];
	const parts = text.split("\n");
	const lines = text.endsWith("\n") ? parts.slice(0, -1) : parts;
	return lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

/** Cuts a line at `READ_MAX_LINE_CHARS` code points, never splitting a character. Pure. */
export function cutLine(line: string): string {
	// A string's UTF-16 length is never below its code point count, so short lines skip the split.
	if (line.length <= READ_MAX_LINE_CHARS) return line;
	const chars = Array.from(line);
	if (chars.length <= READ_MAX_LINE_CHARS) return line;
	return `${chars.slice(0, READ_MAX_LINE_CHARS).join("")} [line cut: ${READ_MAX_LINE_CHARS} of ${chars.length} characters shown]`;
}

/** The formatted window and the lines it covers. */
export interface LineWindow {
	readonly text: string;
	readonly from: number;
	readonly to: number;
}

/**
 * Formats lines `offset` to `offset + limit - 1` `cat -n` style (number right aligned to width 6, a
 * tab, the line), stopping before the output passes `READ_MAX_OUTPUT_BYTES` but always returning one
 * line, and adds the "read more" footer when lines remain. `offset` must be within the lines. Pure.
 */
export function formatWindow(
	lines: readonly string[],
	offset: number,
	limit: number,
): LineWindow {
	const total = lines.length;
	const last = Math.min(total, offset + limit - 1);
	const out: string[] = [];
	let bytes = 0;
	let to = offset - 1;
	for (let n = offset; n <= last; n++) {
		const formatted = `${String(n).padStart(6)}\t${cutLine(lines[n - 1] ?? "")}`;
		const size =
			Buffer.byteLength(formatted, "utf8") + (out.length > 0 ? 1 : 0);
		if (out.length > 0 && bytes + size > READ_MAX_OUTPUT_BYTES) break;
		out.push(formatted);
		bytes += size;
		to = n;
	}
	if (to < total) {
		out.push(
			`[Lines ${offset} to ${to} of ${total}. Call read_file with offset=${to + 1} to read more.]`,
		);
	}
	return { text: out.join("\n"), from: offset, to };
}

/** Maps a thrown file system error to the AC-13 text, or rethrows it. */
function fsFailure(error: unknown, display: string): never {
	const code = fsErrorCode(error);
	if (code === "ENOENT" || code === "ENOTDIR") {
		throw new ToolError("tool.not_found", `${display} does not exist.`);
	}
	if (code === "EACCES" || code === "EPERM") {
		throw new ToolError(
			"tool.access_denied",
			`pk is not allowed to read ${display}.`,
		);
	}
	throw error;
}

async function attempt<T>(run: () => Promise<T>, display: string): Promise<T> {
	try {
		return await run();
	} catch (error) {
		return fsFailure(error, display);
	}
}

/** The size in MB with one decimal, for the too large text. */
function megabytes(size: number): string {
	return (size / 1_048_576).toFixed(1);
}

/** Reads, checks and decodes the file at a scoped real path. */
async function readText(
	fs: FileSystem,
	real: string,
	display: string,
): Promise<{ lines: readonly string[]; mtimeMs: number; size: number }> {
	const stat = await attempt(() => fs.stat(real), display);
	switch (stat.kind) {
		case "directory":
			throw new ToolError(
				"tool.is_directory",
				`${display} is a directory, not a file.`,
			);
		case "other":
			throw new ToolError(
				"tool.not_regular_file",
				`${display} is not a regular file.`,
			);
		case "file":
			break;
		default: {
			const _exhaustive: never = stat.kind;
			return _exhaustive;
		}
	}
	if (stat.size > READ_MAX_FILE_BYTES) {
		throw new ToolError(
			"tool.too_large",
			`${display} is ${megabytes(stat.size)} MB, larger than the 10 MB read_file can read.`,
		);
	}
	const bytes = await attempt(() => fs.readFile(real), display);
	if (bytes.subarray(0, READ_SNIFF_BYTES).includes(0)) {
		throw new ToolError(
			"tool.binary_file",
			`${display} looks like a binary file. read_file reads text files only.`,
		);
	}
	return { lines: splitLines(bytes), mtimeMs: stat.mtimeMs, size: stat.size };
}

/**
 * `read_file`: reads a text file inside the project with line numbers (spec 0005 AC-11 to AC-14).
 * Every problem is a `ToolError` whose message the model sees. A successful read returns the `read`
 * file touch for the screen and one `FileStamp` for the ledger.
 */
export const readFileTool = defineTool<ReadFileInput>({
	name: NAME,
	kind: "read",
	description:
		"Read a text file in the project. Returns its lines numbered from 1, at most 2000 lines per call; use offset and limit to read a long file in parts.",
	input: ReadFileInput,
	async run(input, ctx) {
		const scoped = await resolveInProject(
			input.path,
			ctx.projectRoot,
			ctx.fs,
			NAME,
		);
		const { real, display } = scoped;
		if (!scoped.exists) {
			throw new ToolError("tool.not_found", `${display} does not exist.`);
		}
		const file = await readText(ctx.fs, real, display);
		const total = file.lines.length;
		const offset = input.offset ?? 1;
		const stampOf = (from: number, to: number): FileStamp => ({
			path: real,
			mtimeMs: file.mtimeMs,
			size: file.size,
			lines: { from, to, total },
		});
		const details = { files: [{ path: display, action: "read" as const }] };
		if (total === 0) {
			return {
				...textOutcome(EMPTY_FILE_TEXT, false),
				details,
				stamps: [stampOf(0, 0)],
			};
		}
		if (offset > total) {
			throw new ToolError(
				"tool.offset_past_end",
				`offset ${offset} is past the end of ${display} (${total} lines).`,
			);
		}
		const window = formatWindow(
			file.lines,
			offset,
			input.limit ?? READ_MAX_LINES,
		);
		return {
			...textOutcome(window.text, false),
			details,
			stamps: [stampOf(window.from, window.to)],
		};
	},
});
