import { describe, expect, test } from "bun:test";
import {
	contrastRatio,
	nativeColorTerm,
	PALETTE,
	resolveColorMode,
	resolveTheme,
	type TextToken,
	terminalColorCapabilities,
} from "./theme.ts";

describe("contrast against canvas (spec 0003 AC-2)", () => {
	const canvas = PALETTE.canvas.hex;
	test("text is at least 7:1", () => {
		expect(contrastRatio(PALETTE.text.hex, canvas)).toBeGreaterThanOrEqual(7);
	});
	test("textDim, amber, green and red are at least 4.5:1", () => {
		for (const token of ["textDim", "amber", "green", "red"] as const) {
			expect(contrastRatio(PALETTE[token].hex, canvas)).toBeGreaterThanOrEqual(
				4.5,
			);
		}
	});
	test("bracket is at least 3:1 (non text graphics)", () => {
		expect(contrastRatio(PALETTE.bracket.hex, canvas)).toBeGreaterThanOrEqual(
			3,
		);
	});
	test("no text primitive accepts the decoration tokens", () => {
		const ok: TextToken = "textDim";
		// @ts-expect-error textFaint is decoration only
		const faint: TextToken = "textFaint";
		// @ts-expect-error line is decoration only
		const line: TextToken = "line";
		expect([ok, faint, line].length).toBe(3);
	});
});

describe("resolveColorMode (spec 0003 AC-3)", () => {
	const caps = (rgb: boolean, ansi256: boolean) => ({ rgb, ansi256 });
	test("NO_COLOR set to a non empty value wins over everything", () => {
		expect(
			resolveColorMode({
				env: { NO_COLOR: "1", COLORTERM: "truecolor" },
				capabilities: caps(true, true),
			}),
		).toBe("none");
	});
	test("an empty NO_COLOR is ignored", () => {
		expect(
			resolveColorMode({
				env: { NO_COLOR: "" },
				capabilities: caps(true, true),
			}),
		).toBe("truecolor");
	});
	test("reported capabilities: rgb, then ansi256, else 16", () => {
		expect(resolveColorMode({ env: {}, capabilities: caps(true, false) })).toBe(
			"truecolor",
		);
		expect(resolveColorMode({ env: {}, capabilities: caps(false, true) })).toBe(
			"256",
		);
		expect(
			resolveColorMode({ env: {}, capabilities: caps(false, false) }),
		).toBe("16");
	});
	test("before the first report (null) it guesses from COLORTERM and TERM", () => {
		expect(
			resolveColorMode({ env: { COLORTERM: "truecolor" }, capabilities: null }),
		).toBe("truecolor");
		expect(
			resolveColorMode({ env: { COLORTERM: "24bit" }, capabilities: null }),
		).toBe("truecolor");
		expect(
			resolveColorMode({ env: { TERM: "xterm-256color" }, capabilities: null }),
		).toBe("256");
		expect(
			resolveColorMode({ env: { TERM: "xterm" }, capabilities: null }),
		).toBe("16");
		expect(resolveColorMode({ env: {}, capabilities: null })).toBe("16");
	});
});

describe("16 colors reach the terminal as palette slots (spec 0003 AC-3)", () => {
	test("a 16 color guess hands the native layer a 256 color TERM; other guesses leave TERM alone", () => {
		expect(nativeColorTerm({ TERM: "xterm" })).toBe("xterm-256color");
		expect(nativeColorTerm({ TERM: "screen" })).toBe("screen-256color");
		expect(nativeColorTerm({})).toBe("xterm-256color");
		expect(nativeColorTerm({ TERM: "xterm-256color" })).toBeUndefined();
		expect(
			nativeColorTerm({ TERM: "xterm", COLORTERM: "truecolor" }),
		).toBeUndefined();
	});
	test("with pk's TERM, the reported ansi256 is dropped so the mode stays 16; rgb from the terminal still wins", () => {
		const reported = { rgb: false, ansi256: true, osc52: true };
		const forced = terminalColorCapabilities(reported, true);
		expect(forced).toEqual({ rgb: false, ansi256: false });
		expect(resolveColorMode({ env: {}, capabilities: forced })).toBe("16");
		expect(terminalColorCapabilities(reported, false)).toEqual({
			rgb: false,
			ansi256: true,
		});
		const rgb = terminalColorCapabilities({ rgb: true, ansi256: true }, true);
		expect(resolveColorMode({ env: {}, capabilities: rgb })).toBe("truecolor");
		expect(terminalColorCapabilities(null, true)).toBeNull();
	});
});

describe("resolveTheme (spec 0003 AC-3)", () => {
	test("truecolor and 256 use the exact hex values and paint the canvas", () => {
		for (const mode of ["truecolor", "256"] as const) {
			const t = resolveTheme(mode, "pk");
			expect(t.text.fg?.intent).toBe("rgb");
			expect(t.canvasBg.intent).toBe("rgb");
			expect(t.tintDiffRows).toBe(true);
		}
	});
	test("ui.background terminal keeps the terminal background in truecolor", () => {
		expect(resolveTheme("truecolor", "terminal").canvasBg.intent).toBe(
			"default",
		);
	});
	test("16 colors use the hand picked slots and the default background", () => {
		const t = resolveTheme("16", "pk");
		expect(t.amber.fg?.intent).toBe("indexed");
		expect(t.bracket.fg?.intent).toBe("indexed");
		expect(t.text.fg?.intent).toBe("default");
		expect(t.textDim.dim).toBe(true);
		expect(t.title.bold).toBe(true);
		expect(t.canvasBg.intent).toBe("default");
		expect(t.tintDiffRows).toBe(false);
	});
	test("none uses only terminal defaults plus the attribute in the No color column", () => {
		const t = resolveTheme("none", "pk");
		for (const token of Object.keys(PALETTE) as (keyof typeof PALETTE)[]) {
			const style = t[token];
			if (style.fg) expect(style.fg.intent).toBe("default");
			if (style.bg) expect(style.bg.intent).toBe("default");
		}
		expect(t.amber.bold).toBe(true);
		expect(t.red.bold).toBe(true);
		expect(t.textDim.dim).toBe(true);
		expect(t.selectionBg.inverse).toBe(true);
		expect(t.green.bold).toBeUndefined();
	});
});
