import { describe, expect, test } from "bun:test";
import {
	formatBytes,
	formatCost,
	formatDuration,
	formatMicroUsd,
	formatTokens,
} from "./format.ts";
import { cutPatch } from "./patch.ts";
import {
	cellWidth,
	sanitizeForScreen,
	tildePath,
	toolTarget,
	truncateEnd,
	truncateMiddle,
} from "./text.ts";

describe("sanitizeForScreen (spec 0003 AC-24)", () => {
	test("removes escapes and control characters, expands tabs to 4 columns, drops \\r", () => {
		expect(sanitizeForScreen("a\x1b[2Jb\tc\r\n")).toBe("ab  c\n");
	});
	test("removes OSC sequences and DEL, keeps newlines", () => {
		expect(sanitizeForScreen("x\x1b]52;c;aGk=\x07y\x7fz\n\x00w")).toBe(
			"xyz\nw",
		);
	});
	test("tabs count cells, not characters", () => {
		expect(sanitizeForScreen("日\tx")).toBe("日  x");
	});
});

describe("truncation counts terminal cells", () => {
	test("truncateMiddle keeps both ends", () => {
		expect(truncateMiddle("src/provider/retry.ts", 11, "…")).toBe(
			"src/p…ry.ts",
		);
		expect(
			cellWidth(truncateMiddle("日本語のパス/ファイル.ts", 10, "…")),
		).toBeLessThanOrEqual(10);
		expect(truncateMiddle("short", 10, "…")).toBe("short");
	});
	test("truncateEnd keeps the start", () => {
		expect(truncateEnd("openai/gpt-5-very-long", 10, "…")).toBe("openai/gp…");
	});
});

describe("toolTarget", () => {
	test("first string among path, file_path, command, pattern, url, query; first line only", () => {
		expect(toolTarget({ command: "ls\nrm -rf /", path: "a.ts" })).toBe("a.ts");
		expect(toolTarget({ command: "bun test\nmore" })).toBe("bun test");
		expect(toolTarget({ query: "x\x1b[31m" })).toBe("x");
		expect(toolTarget({ other: "x" })).toBeUndefined();
		expect(toolTarget(undefined)).toBeUndefined();
	});
	test("tildePath shows home as ~", () => {
		expect(tildePath("/home/dev/code", "/home/dev")).toBe("~/code");
		expect(tildePath("/home/devx/code", "/home/dev")).toBe("/home/devx/code");
	});
});

describe("formatters (Value sourcing)", () => {
	test("tokens", () => {
		expect(formatTokens(812)).toBe("812");
		expect(formatTokens(12_400)).toBe("12.4k");
		expect(formatTokens(1_200_000)).toBe("1.2M");
	});
	test("bytes", () => {
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(2150)).toBe("2.1 KB");
		expect(formatBytes(1.4 * 1024 * 1024)).toBe("1.4 MB");
	});
	test("durations", () => {
		expect(formatDuration(212)).toBe("0.2s");
		expect(formatDuration(14_000)).toBe("14s");
		expect(formatDuration(65_000)).toBe("1m 05s");
	});
	test("cost: 2 decimals from $0.01, else 4; dash and unpriced", () => {
		expect(formatMicroUsd(40_000)).toBe("$0.04");
		expect(formatMicroUsd(1_200)).toBe("$0.0012");
		expect(
			formatCost({ knownMicroUsd: 0, pricedCalls: 0, unknownCalls: 2 }, "—"),
		).toBe("— +2 unpriced");
		expect(
			formatCost(
				{ knownMicroUsd: 3_100, pricedCalls: 2, unknownCalls: 1 },
				"—",
			),
		).toBe("$0.0031 +1 unpriced");
		expect(
			formatCost({ knownMicroUsd: 0, pricedCalls: 0, unknownCalls: 0 }, "—"),
		).toBe("—");
	});
});

describe("cutPatch (spec 0003 AC-12)", () => {
	const patch = [
		"--- a/x.ts",
		"+++ b/x.ts",
		"@@ -1,50 +1,52 @@",
		...Array.from({ length: 24 }, (_, i) => ` line ${i}`),
		"-old",
		"+new 1",
		"+new 2",
		"+new 3",
		...Array.from({ length: 24 }, (_, i) => ` tail ${i}`),
		"",
	].join("\n");
	test("keeps the headers and 40 patch lines, and counts what was cut", () => {
		const { patch: cut, cut: n } = cutPatch(patch, 40);
		const lines = cut.trimEnd().split("\n");
		expect(lines.slice(0, 2)).toEqual(["--- a/x.ts", "+++ b/x.ts"]);
		expect(
			lines.filter(
				(l) =>
					!l.startsWith("@@") && !l.startsWith("---") && !l.startsWith("+++"),
			).length,
		).toBe(40);
		expect(n).toBe(12);
		// The hunk header matches the kept lines: 24 + 12 context, 1 removed, 3 added.
		expect(lines[2]).toBe("@@ -1,37 +1,39 @@");
	});
	test("a short patch is unchanged", () => {
		expect(cutPatch("--- a\n+++ b\n@@ -1 +1 @@\n-a\n+b\n", 40).cut).toBe(0);
	});
});

describe("formatter boundaries never show a figure that should have rolled over", () => {
	test("tokens: 999 stays whole, 1000 is 1.0k, and the k to M switch never shows 1000.0k", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(999)).toBe("999");
		expect(formatTokens(1_000)).toBe("1.0k");
		expect(formatTokens(999_949)).toBe("999.9k");
		expect(formatTokens(999_950)).toBe("1.0M");
	});
	test("bytes: 1023 B, then 1.0 KB, and the KB to MB switch never shows 1024.0 KB", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(1023)).toBe("1023 B");
		expect(formatBytes(1024)).toBe("1.0 KB");
		expect(formatBytes(1024 * 1024 - 53)).toBe("1023.9 KB");
		expect(formatBytes(1024 * 1024 - 52)).toBe("1.0 MB");
	});
	test("durations: negative is 0.0s, 9.95 s rounds to 10s, 59.5 s becomes 1m 00s (never 60s)", () => {
		expect(formatDuration(-5)).toBe("0.0s");
		expect(formatDuration(9_949)).toBe("9.9s");
		expect(formatDuration(9_950)).toBe("10s");
		expect(formatDuration(59_499)).toBe("59s");
		expect(formatDuration(59_500)).toBe("1m 00s");
		expect(formatDuration(600_000)).toBe("10m 00s");
	});
	test("cost: zero is $0.0000 (the COST last turn figure), $0.01 switches to 2 decimals", () => {
		expect(formatMicroUsd(0)).toBe("$0.0000");
		expect(formatMicroUsd(10_000)).toBe("$0.01");
		expect(formatMicroUsd(12_345_678)).toBe("$12.35");
	});
	test("cost: a priced call that cost nothing shows $0.0000, not the dash", () => {
		expect(
			formatCost({ knownMicroUsd: 0, pricedCalls: 1, unknownCalls: 0 }, "-"),
		).toBe("$0.0000");
	});
});

describe("sanitizeForScreen covers every escape family (spec 0003 AC-24)", () => {
	test("SGR colors with parameters, OSC ended by ST, DCS, and a bare ESC c reset are removed whole", () => {
		expect(sanitizeForScreen("\x1b[38;2;255;0;0mred\x1b[0m")).toBe("red");
		expect(sanitizeForScreen("\x1b]0;title\x1b\\x")).toBe("x");
		expect(sanitizeForScreen("\x1bPq#0;2;0;0;0\x1b\\done")).toBe("done");
		expect(sanitizeForScreen("\x1bcz")).toBe("z");
		expect(sanitizeForScreen("end\x1b")).toBe("end");
	});
	test("tabs restart their column count on each line", () => {
		expect(sanitizeForScreen("ab\tc\n\td")).toBe("ab  c\n    d");
	});
	test("plain text passes through unchanged", () => {
		const text = "const x = 1; // café 日本\n";
		expect(sanitizeForScreen(text)).toBe(text);
	});
});

describe("truncation edges", () => {
	test("a width at or under the ellipsis width never returns more cells than asked", () => {
		expect(truncateEnd("abcdef", 0, "…")).toBe("");
		expect(truncateEnd("abcdef", 1, "…")).toBe("…");
		expect(truncateMiddle("abcdef", 1, "…")).toBe("…");
		expect(truncateEnd("abcdef", 2, "...")).toBe("..");
	});
	test("truncateEnd never splits a combining mark or overflows on wide characters", () => {
		expect(truncateEnd("ééé", 2, "…")).toBe("é…");
		expect(truncateEnd("日本語", 4, "…")).toBe("日…");
	});
	test("truncateMiddle gives the extra cell to the head when the room is odd", () => {
		expect(truncateMiddle("abcdefghij", 6, "…")).toBe("abc…ij");
	});
	test("text that fits exactly is left alone", () => {
		expect(truncateEnd("abcdef", 6, "…")).toBe("abcdef");
		expect(truncateMiddle("abcdef", 6, "…")).toBe("abcdef");
	});
});

describe("toolTarget and tildePath edges", () => {
	test("a non string value is skipped for the next key", () => {
		expect(toolTarget({ path: 42, command: "ls" })).toBe("ls");
		expect(toolTarget({})).toBeUndefined();
	});
	test("home itself is ~, and an empty or root home leaves the path alone", () => {
		expect(tildePath("/home/dev", "/home/dev")).toBe("~");
		expect(tildePath("/home/dev/code", "")).toBe("/home/dev/code");
		expect(tildePath("/etc/hosts", "/")).toBe("/etc/hosts");
	});
});

describe("cutPatch edges (spec 0003 AC-12)", () => {
	const multi = [
		"--- a/x.ts",
		"+++ b/x.ts",
		"@@ -1,2 +1,2 @@ fn a",
		" a",
		"-b",
		"+B",
		"@@ -10,2 +10,3 @@ fn c",
		" c",
		"+d",
		" e",
		"@@ -20,1 +21,1 @@",
		"-x",
		"+y",
		"",
	].join("\n");

	test("a cut inside the second hunk rewrites its header and drops the later hunks", () => {
		expect(cutPatch(multi, 4)).toEqual({
			patch: [
				"--- a/x.ts",
				"+++ b/x.ts",
				"@@ -1,2 +1,2 @@ fn a",
				" a",
				"-b",
				"+B",
				"@@ -10,1 +10,1 @@ fn c",
				" c",
				"",
			].join("\n"),
			cut: 4,
		});
	});
	test("a cut that ends on a hunk boundary leaves no empty hunk header", () => {
		const { patch, cut } = cutPatch(multi, 3);
		expect(patch.trimEnd().split("\n").at(-1)).toBe("+B");
		expect(patch).not.toContain("fn c");
		expect(cut).toBe(5);
	});
	test("a patch with exactly the limit is unchanged", () => {
		expect(cutPatch(multi, 8)).toEqual({ patch: multi, cut: 0 });
	});
	test("no newline markers do not count as patch lines", () => {
		const patch =
			"@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n";
		expect(cutPatch(patch, 2)).toEqual({ patch, cut: 0 });
	});
	test("text with no hunk header is returned as is", () => {
		expect(cutPatch("Binary files a and b differ\n", 1)).toEqual({
			patch: "Binary files a and b differ\n",
			cut: 0,
		});
	});
});
