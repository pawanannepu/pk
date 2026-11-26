import type { TuiEnv } from "./session.ts";

/**
 * Every glyph the screen draws, by name (spec 0003, *Glyphs*). Code never writes a raw glyph; it asks
 * the active set. `spark` has 8 levels and `spinner` holds the animation frames.
 */
export interface GlyphSet {
	readonly cornerTL: string;
	readonly cornerTR: string;
	readonly cornerBL: string;
	readonly cornerBR: string;
	readonly rule: string;
	readonly vrule: string;
	readonly tick: string;
	readonly bar: string;
	readonly caret: string;
	readonly done: string;
	readonly pending: string;
	readonly failed: string;
	readonly warn: string;
	readonly info: string;
	readonly lamp: string;
	readonly marker: string;
	readonly reasoning: string;
	readonly newBelow: string;
	readonly ellipsis: string;
	readonly gaugeFull: string;
	readonly gaugeEmpty: string;
	readonly spark: readonly string[];
	readonly spinner: readonly string[];
	readonly wordmark: string;
}

/** The Unicode set: box drawing, geometric shapes and Braille. */
export const UNICODE_GLYPHS: GlyphSet = {
	cornerTL: "┌",
	cornerTR: "┐",
	cornerBL: "└",
	cornerBR: "┘",
	rule: "─",
	vrule: "│",
	tick: "┬",
	bar: "┃",
	caret: "›",
	done: "◆",
	pending: "◇",
	failed: "✖",
	warn: "▲",
	info: "·",
	lamp: "◉",
	marker: "■",
	reasoning: "∿",
	newBelow: "↓",
	ellipsis: "…",
	gaugeFull: "▓",
	gaugeEmpty: "░",
	spark: ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"],
	spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
	wordmark: "◢◣",
};

/** The ASCII set, for non UTF-8 locales and `ui.ascii`. Every glyph is printable ASCII. */
export const ASCII_GLYPHS: GlyphSet = {
	cornerTL: "+",
	cornerTR: "+",
	cornerBL: "+",
	cornerBR: "+",
	rule: "-",
	vrule: "|",
	tick: "+",
	bar: "|",
	caret: ">",
	done: "*",
	pending: "o",
	failed: "x",
	warn: "!",
	info: ".",
	lamp: "@",
	marker: "#",
	reasoning: "~",
	newBelow: "v",
	ellipsis: "...",
	gaugeFull: "#",
	gaugeEmpty: ".",
	spark: [" ", ".", ":", "-", "=", "+", "*", "#"],
	spinner: ["|", "/", "-", "\\"],
	wordmark: "/\\",
};

/**
 * The glyph set to draw with (AC-5): ASCII when `ascii` is true or the first non empty of `LC_ALL`,
 * `LC_CTYPE`, `LANG` does not name UTF-8 (all empty counts as not UTF-8), else Unicode.
 */
export function glyphSet(
	env: Pick<TuiEnv, "LC_ALL" | "LC_CTYPE" | "LANG">,
	ascii: boolean,
): GlyphSet {
	if (ascii) return ASCII_GLYPHS;
	const locale = [env.LC_ALL, env.LC_CTYPE, env.LANG].find(
		(value) => value !== undefined && value !== "",
	);
	return locale !== undefined && /utf-?8/i.test(locale)
		? UNICODE_GLYPHS
		: ASCII_GLYPHS;
}
