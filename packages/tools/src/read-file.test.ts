import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPkError } from "@pk/env";
import type { JsonObject } from "@pk/schema";
import {
	cutLine,
	formatWindow,
	readFileTool,
	splitLines,
} from "./read-file.ts";
import type { FileSystem, ToolContext, ToolOutcome } from "./tool.ts";

const nodeFs: FileSystem = {
	realpath: (p) => realpath(p),
	stat: async (p) => {
		const s = await stat(p);
		return {
			kind: s.isFile() ? "file" : s.isDirectory() ? "directory" : "other",
			size: s.size,
			mtimeMs: s.mtimeMs,
		};
	},
	readFile: (p) => readFile(p),
};

let base = "";
let root = "";
let outside = "";

beforeAll(() => {
	// Not realpathed on purpose: on macOS tmpdir() is under /var, a symlink to /private/var.
	base = mkdtempSync(join(tmpdir(), "pk-read-file-"));
	root = join(base, "project");
	outside = join(base, "outside");
	mkdirSync(join(root, "src"), { recursive: true });
	mkdirSync(outside);
	writeFileSync(join(root, "hello.txt"), "hello\nworld\n");
	writeFileSync(join(root, "crlf.txt"), "﻿one\r\ntwo\r\n");
	writeFileSync(join(root, "empty.txt"), "");
	writeFileSync(join(root, "bin.dat"), new Uint8Array([104, 105, 0, 1]));
	writeFileSync(join(root, "bad.txt"), new Uint8Array([0x61, 0xff, 0x62]));
	writeFileSync(
		join(root, "many.txt"),
		Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`).join("\n"),
	);
	writeFileSync(join(outside, "secret.txt"), "secret");
	symlinkSync(join(outside, "secret.txt"), join(root, "escape.txt"));
	symlinkSync(join(root, "hello.txt"), join(root, "src", "inner.txt"));
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

const ctx = (projectRoot = realpathSync(root)): ToolContext => ({
	signal: new AbortController().signal,
	projectRoot,
	fs: nodeFs,
	ledger: new Map(),
});

/** Runs read_file and returns its outcome; a thrown PkError becomes an error outcome with its message. */
async function read(input: JsonObject, context = ctx()): Promise<ToolOutcome> {
	const v = readFileTool.validate(input);
	if (!v.ok) return v.outcome;
	try {
		return await readFileTool.execute(v.input, context);
	} catch (error) {
		if (isPkError(error)) {
			return {
				content: [{ type: "text", text: error.message }],
				isError: true,
			};
		}
		throw error;
	}
}

const text = (o: ToolOutcome) =>
	o.content.map((b) => (b.type === "text" ? b.text : "")).join("");

describe("read_file reads (spec 0005 AC-11)", () => {
	test("cat -n lines, the read touch and one stamp", async () => {
		const o = await read({ path: "hello.txt" });
		expect(o.isError).toBe(false);
		expect(text(o)).toBe("     1\thello\n     2\tworld");
		expect(o.details).toEqual({
			files: [{ path: "hello.txt", action: "read" }],
		});
		expect(o.stamps).toHaveLength(1);
		expect(o.stamps?.[0]).toMatchObject({
			path: join(realpathSync(root), "hello.txt"),
			size: 12,
			lines: { from: 1, to: 2, total: 2 },
		});
	});

	test("BOM and CRLF are removed, invalid UTF-8 becomes U+FFFD", async () => {
		expect(text(await read({ path: "crlf.txt" }))).toBe(
			"     1\tone\n     2\ttwo",
		);
		expect(text(await read({ path: "bad.txt" }))).toBe("     1\ta�b");
	});

	test("an empty file says so, whatever the offset", async () => {
		const o = await read({ path: "empty.txt", offset: 5 });
		expect(o.isError).toBe(false);
		expect(text(o)).toBe("(the file is empty)");
		expect(o.stamps?.[0]?.lines).toEqual({ from: 0, to: 0, total: 0 });
	});

	test("the default window is 2000 lines, with a footer to read more", async () => {
		const lines = text(await read({ path: "many.txt" })).split("\n");
		expect(lines).toHaveLength(2001);
		expect(lines.at(-1)).toBe(
			"[Lines 1 to 2000 of 2500. Call read_file with offset=2001 to read more.]",
		);
	});

	test("offset and limit pick a window", async () => {
		expect(text(await read({ path: "many.txt", offset: 2499, limit: 5 }))).toBe(
			"  2499\tline 2499\n  2500\tline 2500",
		);
		expect(text(await read({ path: "many.txt", offset: 10, limit: 1 }))).toBe(
			"    10\tline 10\n[Lines 10 to 10 of 2500. Call read_file with offset=11 to read more.]",
		);
	});

	test("an out of range limit is invalid input", async () => {
		const o = await read({ path: "hello.txt", limit: 2001 });
		expect(o.isError).toBe(true);
		expect(text(o)).toStartWith("Invalid input for read_file: limit:");
	});
});

describe("read_file caps (pure)", () => {
	test("a long line is cut at 2000 code points, never splitting a character", () => {
		const line = "😀".repeat(2500);
		const cut = cutLine(line);
		expect(cut).toBe(
			`${"😀".repeat(2000)} [line cut: 2000 of 2500 characters shown]`,
		);
		expect(cutLine("x".repeat(2000))).toBe("x".repeat(2000));
	});

	test("output stops before 100 KB on a whole line, but always returns one line", () => {
		const wide = Array.from({ length: 100 }, () => "y".repeat(1990));
		const window = formatWindow(wide, 1, 2000);
		const body = window.text.split("\n");
		expect(window.to).toBe(51);
		expect(body.at(-1)).toBe(
			"[Lines 1 to 51 of 100. Call read_file with offset=52 to read more.]",
		);
		const one = formatWindow(["z".repeat(2000)], 1, 2000);
		expect(one.to).toBe(1);
	});

	test("splitLines counts a final newline as no extra line", () => {
		expect(splitLines(new TextEncoder().encode("a\nb\n"))).toEqual(["a", "b"]);
		expect(splitLines(new TextEncoder().encode("a\n\n"))).toEqual(["a", ""]);
		expect(splitLines(new Uint8Array())).toEqual([]);
	});
});

describe("read_file path scope (spec 0005 AC-12)", () => {
	const refusal = (input: string) =>
		`${input} is outside the project (${realpathSync(root)}). read_file can only read files inside the project for now.`;

	test("a relative path leaving the root through .. is refused", async () => {
		const o = await read({ path: "../outside/secret.txt" });
		expect(o.isError).toBe(true);
		expect(text(o)).toBe(refusal("../outside/secret.txt"));
	});

	test("an absolute path outside is refused", async () => {
		expect(text(await read({ path: "/etc/hosts" }))).toBe(
			refusal("/etc/hosts"),
		);
	});

	test("a symlink inside the root pointing out is refused", async () => {
		expect(text(await read({ path: "escape.txt" }))).toBe(
			refusal("escape.txt"),
		);
	});

	test("a symlink inside pointing inside is read, shown by its real path", async () => {
		const o = await read({ path: "src/inner.txt" });
		expect(o.isError).toBe(false);
		expect(o.details).toEqual({
			files: [{ path: "hello.txt", action: "read" }],
		});
	});

	test("the root agrees with itself in its symlinked and real forms", async () => {
		const linked = join(root, "hello.txt");
		const real = join(realpathSync(root), "hello.txt");
		for (const projectRoot of [root, realpathSync(root)]) {
			for (const path of [linked, real]) {
				const o = await read({ path }, ctx(projectRoot));
				expect(o.isError).toBe(false);
			}
		}
	});
});

describe("read_file errors (spec 0005 AC-13)", () => {
	test("each failure has its fixed text", async () => {
		expect(text(await read({ path: "nope.txt" }))).toBe(
			"nope.txt does not exist.",
		);
		expect(text(await read({ path: "src/deep/nope.txt" }))).toBe(
			"src/deep/nope.txt does not exist.",
		);
		expect(text(await read({ path: "hello.txt/x" }))).toBe(
			"hello.txt/x does not exist.",
		);
		expect(text(await read({ path: "src" }))).toBe(
			"src is a directory, not a file.",
		);
		expect(text(await read({ path: "bin.dat" }))).toBe(
			"bin.dat looks like a binary file. read_file reads text files only.",
		);
		expect(text(await read({ path: "hello.txt", offset: 3 }))).toBe(
			"offset 3 is past the end of hello.txt (2 lines).",
		);
	});

	test("a file over 10 MB is refused from stat, before any read", async () => {
		const reads: string[] = [];
		const big: FileSystem = {
			...nodeFs,
			stat: async () => ({ kind: "file", size: 12_582_912, mtimeMs: 1 }),
			readFile: async (p) => {
				reads.push(p);
				return readFileSync(p);
			},
		};
		const o = await read({ path: "hello.txt" }, { ...ctx(), fs: big });
		expect(text(o)).toBe(
			"hello.txt is 12.0 MB, larger than the 10 MB read_file can read.",
		);
		expect(reads).toHaveLength(0);
	});

	test("exactly 10 MB is read; one byte more is too large (AC-13)", async () => {
		const sized = (size: number): FileSystem => ({
			...nodeFs,
			stat: async () => ({ kind: "file", size, mtimeMs: 1 }),
		});
		const atLimit = await read(
			{ path: "hello.txt" },
			{ ...ctx(), fs: sized(10_485_760) },
		);
		expect(atLimit.isError).toBe(false);
		const over = await read(
			{ path: "hello.txt" },
			{ ...ctx(), fs: sized(10_485_761) },
		);
		expect(over.isError).toBe(true);
		expect(text(over)).toContain("larger than the 10 MB read_file can read");
	});

	test("a FIFO or device is not a regular file, and no permission is its own text", async () => {
		const other: FileSystem = {
			...nodeFs,
			stat: async () => ({ kind: "other", size: 0, mtimeMs: 1 }),
		};
		expect(
			text(await read({ path: "hello.txt" }, { ...ctx(), fs: other })),
		).toBe("hello.txt is not a regular file.");
		const denied: FileSystem = {
			...nodeFs,
			readFile: async () => {
				throw Object.assign(new Error("EACCES"), { code: "EACCES" });
			},
		};
		expect(
			text(await read({ path: "hello.txt" }, { ...ctx(), fs: denied })),
		).toBe("pk is not allowed to read hello.txt.");
	});
});
