import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UNICODE_GLYPHS } from "./glyphs.ts";
import { PALETTE } from "./theme.ts";

const DOC = readFileSync(
	join(import.meta.dir, "../../../docs/design.md"),
	"utf8",
);

/** Every backticked name in the first cell of each row of the table under `## <heading>`. */
function tableNames(heading: string): string[] {
	const lines = DOC.split("\n");
	const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
	if (start < 0) return [];
	const rest = lines.slice(start + 1);
	const tableStart = rest.findIndex((line) => line.startsWith("|"));
	const table = rest.slice(tableStart);
	const end = table.findIndex((line) => !line.startsWith("|"));
	const rows = (end < 0 ? table : table.slice(0, end)).slice(2); // header and separator
	return rows.flatMap((row) => {
		const first = row.split("|")[1] ?? "";
		return [...first.matchAll(/`([^`]+)`/g)].flatMap((m) =>
			m[1] ? [m[1]] : [],
		);
	});
}

const SECTIONS = [
	"Palette",
	"Glyphs",
	"Layout and widths",
	"Frames and titles",
	"Header",
	"Footer",
	"Rails",
	"Hero",
	"Transcript items",
	"Permission panel",
	"Input",
	"Motion",
	"Plain output rules",
];

describe("docs/design.md (spec 0003 AC-1)", () => {
	test("covers every section of the design language", () => {
		const missing = SECTIONS.filter(
			(s) => !DOC.split("\n").includes(`## ${s}`),
		);
		expect(missing).toEqual([]);
		for (const item of [
			"Your message",
			"Reply",
			"Reasoning",
			"Tool call",
			"Diff",
			"Error",
			"Notice",
		]) {
			expect(DOC).toContain(`**${item}**`);
		}
	});

	test("the token table and theme.ts list the same tokens", () => {
		const doc = tableNames("Palette");
		const code = Object.keys(PALETTE);
		expect(doc.filter((name) => !code.includes(name))).toEqual([]);
		expect(code.filter((name) => !doc.includes(name))).toEqual([]);
	});

	test("the glyph table and glyphs.ts list the same glyphs", () => {
		const doc = tableNames("Glyphs");
		const code = Object.keys(UNICODE_GLYPHS);
		expect(doc.filter((name) => !code.includes(name))).toEqual([]);
		expect(code.filter((name) => !doc.includes(name))).toEqual([]);
	});

	test("the hex values in the doc match theme.ts", () => {
		const rows = DOC.split("\n").filter((line) =>
			/^\| `[a-zA-Z]+` \| `#/.test(line),
		);
		const pairs = rows.map((row) => {
			const cells = row.split("|").map((c) => c.trim().replaceAll("`", ""));
			return [cells[1], cells[2]] as const;
		});
		expect(pairs.length).toBe(Object.keys(PALETTE).length);
		for (const [token, hex] of pairs) {
			const spec = Object.entries(PALETTE).find(
				([name]) => name === token,
			)?.[1];
			expect<string | undefined>(spec?.hex).toBe(hex);
		}
	});
});
