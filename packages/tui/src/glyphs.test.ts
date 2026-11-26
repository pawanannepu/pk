import { describe, expect, test } from "bun:test";
import { ASCII_GLYPHS, glyphSet, UNICODE_GLYPHS } from "./glyphs.ts";

describe("glyphSet (spec 0003 AC-5)", () => {
	test("both sets have the same keys", () => {
		expect(Object.keys(ASCII_GLYPHS).sort()).toEqual(
			Object.keys(UNICODE_GLYPHS).sort(),
		);
		expect(ASCII_GLYPHS.spark.length).toBe(UNICODE_GLYPHS.spark.length);
	});
	test("every ASCII glyph is printable ASCII", () => {
		const all = Object.values(ASCII_GLYPHS)
			.flatMap((v) => (Array.isArray(v) ? v : [v]))
			.join("");
		expect(/^[\x20-\x7e]*$/.test(all)).toBe(true);
	});
	test("Unicode only for a UTF-8 locale, read in the order LC_ALL, LC_CTYPE, LANG", () => {
		expect(glyphSet({ LANG: "en_US.UTF-8" }, false)).toBe(UNICODE_GLYPHS);
		expect(glyphSet({ LANG: "en_US.utf8" }, false)).toBe(UNICODE_GLYPHS);
		expect(glyphSet({ LC_ALL: "C", LANG: "en_US.UTF-8" }, false)).toBe(
			ASCII_GLYPHS,
		);
		expect(
			glyphSet({ LC_ALL: "", LC_CTYPE: "en_US.UTF-8", LANG: "C" }, false),
		).toBe(UNICODE_GLYPHS);
		expect(glyphSet({}, false)).toBe(ASCII_GLYPHS);
		expect(glyphSet({ LANG: "" }, false)).toBe(ASCII_GLYPHS);
	});
	test("ui.ascii forces ASCII", () => {
		expect(glyphSet({ LANG: "en_US.UTF-8" }, true)).toBe(ASCII_GLYPHS);
	});
});
