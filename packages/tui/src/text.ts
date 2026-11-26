import type { JsonObject } from "@pk/schema";

// Escape sequences are removed whole, so no `[2J` is left on screen once the ESC goes.
const ESCAPE_SEQUENCE =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escapes is the point
	/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[PX^_][^\x1b]*(?:\x1b\\)?|\x1b[ -/]*[0-~]?/g;
// C0 controls except newline and tab (tab is expanded below), DEL, and the C1 range.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f\x80-\x9f]/g;

/** Terminal cells a string takes. Never `.length`: wide and combining characters differ. */
export function cellWidth(text: string): number {
	return Bun.stringWidth(text);
}

/**
 * Makes an outside string safe to draw (AC-24): removes escape sequences, C0 controls (except
 * newline), DEL and `\r`, and expands each tab to the next multiple of 4 columns.
 */
export function sanitizeForScreen(text: string): string {
	const stripped = text.replace(ESCAPE_SEQUENCE, "").replace(CONTROL, "");
	if (!stripped.includes("\t")) return stripped;
	return stripped
		.split("\n")
		.map((line) =>
			line.split("\t").reduce((out, part, i) => {
				if (i === 0) return part;
				const pad = 4 - (cellWidth(out) % 4);
				return `${out}${" ".repeat(pad)}${part}`;
			}, ""),
		)
		.join("\n");
}

/** Splits a string into grapheme clusters, so truncation never cuts a character in half. */
function graphemes(text: string): string[] {
	return [
		...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
	].map((s) => s.segment);
}

/** Keeps the start of `text` within `width` cells, ending with `ellipsis` when cut. */
export function truncateEnd(
	text: string,
	width: number,
	ellipsis: string,
): string {
	if (cellWidth(text) <= width) return text;
	const room = width - cellWidth(ellipsis);
	if (room <= 0) return ellipsis.slice(0, Math.max(0, width));
	let out = "";
	for (const g of graphemes(text)) {
		if (cellWidth(out + g) > room) break;
		out += g;
	}
	return out + ellipsis;
}

/** Keeps both ends of `text` within `width` cells, with `ellipsis` in the middle when cut. */
export function truncateMiddle(
	text: string,
	width: number,
	ellipsis: string,
): string {
	if (cellWidth(text) <= width) return text;
	const room = width - cellWidth(ellipsis);
	if (room <= 0) return ellipsis.slice(0, Math.max(0, width));
	const parts = graphemes(text);
	const headRoom = Math.ceil(room / 2);
	const tailRoom = room - headRoom;
	let head = "";
	for (const g of parts) {
		if (cellWidth(head + g) > headRoom) break;
		head += g;
	}
	let tail = "";
	for (const g of [...parts].reverse()) {
		if (cellWidth(g + tail) > tailRoom) break;
		tail = g + tail;
	}
	return head + ellipsis + tail;
}

/** The input keys a tool names its main argument with, in the order they are tried. */
const TARGET_KEYS = [
	"path",
	"file_path",
	"command",
	"pattern",
	"url",
	"query",
] as const;

/**
 * The short target a tool line shows: the first string among `TARGET_KEYS` in the call's input, cut
 * to its first line and sanitized. `undefined` when none is present.
 */
export function toolTarget(input: JsonObject | undefined): string | undefined {
	if (!input) return undefined;
	for (const key of TARGET_KEYS) {
		const value = input[key];
		if (typeof value === "string") {
			const firstLine = value.split("\n")[0] ?? "";
			return sanitizeForScreen(firstLine);
		}
	}
	return undefined;
}

/** Replaces your home folder at the start of `path` with `~`. */
export function tildePath(path: string, home: string): string {
	if (home === "" || home === "/") return path;
	if (path === home) return "~";
	return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
