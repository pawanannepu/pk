import { describe, expect, test } from "bun:test";
import type { PermissionMode } from "@pk/schema";
import {
	cleanNote,
	NOTE_MAX_CHARS,
	nextMode,
	normalizeNoteDraft,
	permissionKeyRows,
} from "./permission-keys.ts";

describe("nextMode (spec 0006 AC-10)", () => {
	test("three modes without the skip flag, four with it", () => {
		const lap = (skip: boolean) => {
			const seen: PermissionMode[] = ["normal"];
			let mode = nextMode("normal", skip);
			while (mode !== "normal") {
				seen.push(mode);
				mode = nextMode(mode, skip);
			}
			return seen;
		};
		expect(lap(false)).toEqual(["normal", "accept_edits", "plan"]);
		expect(lap(true)).toEqual(["normal", "accept_edits", "plan", "skip_all"]);
		expect(nextMode("skip_all", false)).toBe("normal");
	});
});

describe("the note draft (spec 0006 AC-6)", () => {
	test("newlines and tabs become single spaces and controls are removed", () => {
		expect(normalizeNoteDraft("a\r\nb\nc\td")).toBe("a b c d");
		expect(normalizeNoteDraft("bell\u0007 del\u007f esc\u001b[31mred")).toBe(
			"bell del escred",
		);
	});

	test("the draft stops at 500 code points", () => {
		const long = "😀".repeat(NOTE_MAX_CHARS + 20);
		expect([...normalizeNoteDraft(long)]).toHaveLength(NOTE_MAX_CHARS);
	});

	test("the sent note is trimmed, and spaces only is empty", () => {
		expect(cleanNote("  use the edit tool \n")).toBe("use the edit tool");
		expect(cleanNote(" \t ")).toBe("");
	});
});

describe("permission key rows at the width boundary (spec 0006 AC-6)", () => {
	test("exactly the full row's width keeps one row, one cell less splits it", () => {
		const [whole] = permissionKeyRows("write", 1000);
		expect(permissionKeyRows("write", whole.length)).toEqual([whole, ""]);
		expect(permissionKeyRows("write", whole.length - 1)).toEqual([
			"[y] allow once  [a] this session",
			"[n] deny  [e] deny and explain",
		]);
	});
});

describe("permission key rows (spec 0006 AC-6)", () => {
	test("one row when it fits, two when narrow, and [a] this command for execute", () => {
		expect(permissionKeyRows("write", 200)).toEqual([
			"[y] allow once  [a] this session  [n] deny  [e] deny and explain",
			"",
		]);
		expect(permissionKeyRows("execute", 40)).toEqual([
			"[y] allow once  [a] this command",
			"[n] deny  [e] deny and explain",
		]);
	});
});
