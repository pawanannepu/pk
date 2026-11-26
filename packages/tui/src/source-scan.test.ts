import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { UNICODE_GLYPHS } from "./glyphs.ts";

const SRC = import.meta.dir;
const SKIP = new Set(["theme.ts", "glyphs.ts"]);

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory())
			return entry.name === "demo" ? [] : sourceFiles(path);
		if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name))
			return [];
		if (entry.name.startsWith("test-support")) return [];
		return SKIP.has(entry.name) ? [] : [path];
	});
}

/** The code with comments removed, so prose about glyphs or colors is allowed. */
function withoutComments(code: string): string {
	return code
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const glyphs = Object.values(UNICODE_GLYPHS)
	.flatMap((v) => (Array.isArray(v) ? v : [v]))
	.flatMap((g) => [...g]);

describe("every color and glyph comes from the theme and the glyph set (spec 0003 Key invariants)", () => {
	const files = sourceFiles(SRC);
	test("the scan sees the screen code", () => {
		expect(files.length).toBeGreaterThan(10);
	});
	test("no hex color literal outside theme.ts", () => {
		const hits = files.flatMap((file) =>
			/#[0-9a-fA-F]{6}\b/.test(withoutComments(readFileSync(file, "utf8")))
				? [relative(SRC, file)]
				: [],
		);
		expect(hits).toEqual([]);
	});
	test("no raw glyph from the glyph table outside glyphs.ts", () => {
		const hits = files.flatMap((file) => {
			const code = withoutComments(readFileSync(file, "utf8"));
			const found = glyphs.filter((g) => code.includes(g));
			return found.length > 0
				? [`${relative(SRC, file)}: ${[...new Set(found)].join(" ")}`]
				: [];
		});
		expect(hits).toEqual([]);
	});
});
