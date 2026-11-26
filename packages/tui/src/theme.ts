import { RGBA } from "@opentui/core";
import type { TuiEnv } from "./session.ts";

/** How many colors the terminal draws. `none` is `NO_COLOR`: terminal defaults plus attributes only. */
export type ColorMode = "truecolor" | "256" | "16" | "none";

/** The attribute a token adds in the 16 color and no color treatments. */
type Attr = "bold" | "dim" | "inverse";

interface TokenSpec {
	readonly hex: string;
	/** Painted as a background, not a foreground. */
	readonly bg: boolean;
	/** 16 color: an ANSI slot, `default` (the terminal's own color), or `drop` (no color at all). */
	readonly ansi16: number | "default" | "drop";
	readonly attr16?: Attr;
	/** The attribute in `none` mode. */
	readonly attrNone?: Attr;
}

/**
 * The palette (spec 0003, *Palette*). Tokens are named by role, never by hue. `docs/design.md` holds
 * the same table, and `design-doc.test.ts` keeps the two in step.
 */
export const PALETTE = {
	canvas: { hex: "#07080A", bg: true, ansi16: "default" },
	surface: { hex: "#0D0F12", bg: true, ansi16: "default" },
	line: {
		hex: "#3D424A",
		bg: false,
		ansi16: "default",
		attr16: "dim",
		attrNone: "dim",
	},
	bracket: { hex: "#A9AEB6", bg: false, ansi16: 7 },
	text: { hex: "#E4E6EA", bg: false, ansi16: "default" },
	title: {
		hex: "#E4E6EA",
		bg: false,
		ansi16: "default",
		attr16: "bold",
		attrNone: "bold",
	},
	textDim: {
		hex: "#8C919A",
		bg: false,
		ansi16: "default",
		attr16: "dim",
		attrNone: "dim",
	},
	textFaint: {
		hex: "#565B63",
		bg: false,
		ansi16: "default",
		attr16: "dim",
		attrNone: "dim",
	},
	amber: { hex: "#F2A93B", bg: false, ansi16: 3, attrNone: "bold" },
	green: { hex: "#4CC38A", bg: false, ansi16: 2 },
	red: { hex: "#E5534B", bg: false, ansi16: 1, attrNone: "bold" },
	addBg: { hex: "#0E2A1C", bg: true, ansi16: "drop" },
	removeBg: { hex: "#2D1214", bg: true, ansi16: "drop" },
	selectionBg: {
		hex: "#2B3340",
		bg: true,
		ansi16: "drop",
		attr16: "inverse",
		attrNone: "inverse",
	},
} as const satisfies Record<string, TokenSpec>;

/** A palette token name. */
export type Token = keyof typeof PALETTE;

/** Tokens used only for decoration (rules, ticks, separators). No text primitive accepts them (AC-2). */
export type DecorToken = "line" | "textFaint";

/** Tokens a text primitive may draw words in. */
export type TextToken = Exclude<
	Token,
	DecorToken | "canvas" | "surface" | "addBg" | "removeBg" | "selectionBg"
>;

/** A resolved token: colors and attributes ready for OpenTUI. */
export interface Style {
	readonly fg?: RGBA;
	readonly bg?: RGBA;
	readonly bold?: boolean;
	readonly dim?: boolean;
	readonly inverse?: boolean;
}

/** Every token resolved for one color mode and background setting. */
export type Theme = Readonly<Record<Token, Style>> & {
	readonly mode: ColorMode;
	/** The screen background: the painted canvas, or the terminal default. */
	readonly canvasBg: RGBA;
	/** The panel fill (input, permission panel). */
	readonly surfaceBg: RGBA;
	/** True when diff rows are tinted (`truecolor` and `256`). */
	readonly tintDiffRows: boolean;
};

/** The renderer capability fields `resolveColorMode` reads. */
export interface ColorCapabilities {
	readonly rgb: boolean;
	readonly ansi256: boolean;
}

/**
 * The color depth to draw with (AC-3). `NO_COLOR` set to anything non empty wins. Then the renderer's
 * reported capabilities; before the first report (`null`), a guess from `COLORTERM` and `TERM`.
 */
export function resolveColorMode(input: {
	readonly env: TuiEnv;
	readonly capabilities: ColorCapabilities | null;
}): ColorMode {
	const { env, capabilities } = input;
	if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return "none";
	if (capabilities) {
		if (capabilities.rgb) return "truecolor";
		if (capabilities.ansi256) return "256";
		return "16";
	}
	return guessColorMode(env);
}

function guessColorMode(env: TuiEnv): "truecolor" | "256" | "16" {
	const colorterm = (env.COLORTERM ?? "").toLowerCase();
	if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor";
	if ((env.TERM ?? "").includes("256color")) return "256";
	return "16";
}

/**
 * The `TERM` pk hands OpenTUI's native layer when the environment guess is 16 colors (AC-3), else
 * `undefined`. OpenTUI 0.9.7 writes an indexed color as `38;5;N` only when `TERM` names 256 colors;
 * below that it writes the slot's fixed RGB value, so amber would never be your terminal's own. With
 * this `TERM`, slots 0 to 15 go out as `38;5;N`, your palette's own slot. The `ansi256` it then
 * reports is pk's doing, so `terminalColorCapabilities` drops it.
 */
export function nativeColorTerm(env: TuiEnv): string | undefined {
	if (guessColorMode(env) !== "16") return undefined;
	const term = env.TERM ?? "";
	return term === "" ? "xterm-256color" : `${term}-256color`;
}

/**
 * The terminal's own color capabilities from the renderer's report (`null` before the first one).
 * When pk set the native `TERM` (`nativeColorTerm`), `ansi256` came from pk, not the terminal, so it
 * is dropped; `rgb` still counts, since only the terminal's replies turn it on.
 */
export function terminalColorCapabilities(
	reported: unknown,
	nativeTermSet: boolean,
): ColorCapabilities | null {
	if (typeof reported !== "object" || reported === null) return null;
	const rgb = "rgb" in reported && reported.rgb === true;
	const ansi256 =
		!nativeTermSet && "ansi256" in reported && reported.ansi256 === true;
	return { rgb, ansi256 };
}

const withAttr = (attr: Attr | undefined): Pick<Style, Attr> =>
	attr === undefined ? {} : { [attr]: true };

function resolveToken(spec: TokenSpec, mode: ColorMode): Style {
	switch (mode) {
		case "truecolor":
		case "256": {
			const color = RGBA.fromHex(spec.hex);
			return spec.bg ? { bg: color } : { fg: color };
		}
		case "16": {
			const attrs = withAttr(spec.attr16);
			if (spec.ansi16 === "drop")
				return spec.bg ? { bg: RGBA.defaultBackground(), ...attrs } : attrs;
			const color =
				spec.ansi16 === "default"
					? spec.bg
						? RGBA.defaultBackground()
						: RGBA.defaultForeground()
					: RGBA.fromIndex(spec.ansi16);
			return spec.bg ? { bg: color, ...attrs } : { fg: color, ...attrs };
		}
		case "none": {
			const attrs = withAttr(spec.attrNone);
			return spec.bg
				? { bg: RGBA.defaultBackground(), ...attrs }
				: { fg: RGBA.defaultForeground(), ...attrs };
		}
		default: {
			const unreachable: never = mode;
			return unreachable;
		}
	}
}

/**
 * Every token as a `Style` for this mode (AC-3). The canvas is the terminal's own background when
 * `background` is `"terminal"` or the mode is `16` or `none`.
 */
export function resolveTheme(
	mode: ColorMode,
	background: "pk" | "terminal",
): Theme {
	const r = (token: Token): Style => resolveToken(PALETTE[token], mode);
	const styles: Record<Token, Style> = {
		canvas: r("canvas"),
		surface: r("surface"),
		line: r("line"),
		bracket: r("bracket"),
		text: r("text"),
		title: r("title"),
		textDim: r("textDim"),
		textFaint: r("textFaint"),
		amber: r("amber"),
		green: r("green"),
		red: r("red"),
		addBg: r("addBg"),
		removeBg: r("removeBg"),
		selectionBg: r("selectionBg"),
	};
	const painted = mode === "truecolor" || mode === "256";
	const canvasBg =
		painted && background === "pk"
			? RGBA.fromHex(PALETTE.canvas.hex)
			: RGBA.defaultBackground();
	const surfaceBg = painted
		? RGBA.fromHex(PALETTE.surface.hex)
		: RGBA.defaultBackground();
	return {
		...styles,
		canvas: { bg: canvasBg },
		mode,
		canvasBg,
		surfaceBg,
		tintDiffRows: painted,
	};
}

/** WCAG relative luminance of a `#RRGGBB` color. */
export function relativeLuminance(hex: string): number {
	const channel = (offset: number): number => {
		const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two `#RRGGBB` colors, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
	const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
		(x, y) => y - x,
	);
	return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}
