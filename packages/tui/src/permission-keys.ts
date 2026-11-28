import type { PermissionMode, ToolKind } from "@pk/schema";
import { cellWidth, sanitizeForScreen } from "./text.ts";

/** The note field keeps at most this many code points (spec 0006 AC-6). */
export const NOTE_MAX_CHARS = 500;

/**
 * The next mode on Shift+Tab (spec 0006 AC-10): `normal → accept_edits → plan → normal`, with
 * `skip_all` after `plan` only when it is available. Pure.
 */
export function nextMode(
	mode: PermissionMode,
	skipAllAvailable: boolean,
): PermissionMode {
	switch (mode) {
		case "normal":
			return "accept_edits";
		case "accept_edits":
			return "plan";
		case "plan":
			return skipAllAvailable ? "skip_all" : "normal";
		case "skip_all":
			return "normal";
		default: {
			const unreachable: never = mode;
			return unreachable;
		}
	}
}

/**
 * The note draft as you type or paste it: newlines and tabs become single spaces, controls and
 * escape sequences are removed (so it draws safely), and it stops at `NOTE_MAX_CHARS` code points.
 */
export function normalizeNoteDraft(text: string): string {
	const spaced = text.replace(/\r\n|[\r\n\t]/g, " ");
	return [...sanitizeForScreen(spaced)].slice(0, NOTE_MAX_CHARS).join("");
}

/** The note to send: cleaned and trimmed. Empty means a plain deny (spec 0006 AC-5, AC-6). */
export function cleanNote(draft: string): string {
	return normalizeNoteDraft(draft).trim();
}

/** The `[a]` label: an `execute` call is allowed only as that exact command (spec 0006 AC-6). */
function sessionLabel(kind: ToolKind): string {
	return kind === "execute" ? "[a] this command" : "[a] this session";
}

/**
 * The two key rows of the permission panel (spec 0006 AC-6): all four keys on the first row, or,
 * when that does not fit `width` cells, split over both. The second row is empty when unused, so
 * the panel keeps its height.
 */
export function permissionKeyRows(
	kind: ToolKind,
	width: number,
): readonly [string, string] {
	const first = `[y] allow once  ${sessionLabel(kind)}`;
	const second = "[n] deny  [e] deny and explain";
	const whole = `${first}  ${second}`;
	return cellWidth(whole) <= width ? [whole, ""] : [first, second];
}
