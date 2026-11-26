import { describe, expect, test } from "bun:test";
import { FileTouch, ToolDisplayDetails } from "./display.ts";
import { Settings, USER_ONLY_SETTINGS } from "./settings.ts";

describe("ToolDisplayDetails (spec 0003 AC-21)", () => {
	test("accepts files and a diff, and keeps unknown keys out of the way", () => {
		const parsed = ToolDisplayDetails.safeParse({
			files: [{ path: "src/a.ts", action: "edit", added: 3, removed: 1 }],
			diff: "--- a\n+++ b\n",
			exitCode: 0,
		});
		expect(parsed.success).toBe(true);
	});

	test("rejects a diff that is not a string and an empty path", () => {
		expect(ToolDisplayDetails.safeParse({ diff: 42 }).success).toBe(false);
		expect(FileTouch.safeParse({ path: "", action: "read" }).success).toBe(
			false,
		);
		expect(
			FileTouch.safeParse({ path: "a", action: "edit", added: -1 }).success,
		).toBe(false);
	});

	test("rejects an unknown action and a fractional line count", () => {
		expect(FileTouch.safeParse({ path: "a", action: "delete" }).success).toBe(
			false,
		);
		expect(
			FileTouch.safeParse({ path: "a", action: "edit", removed: 1.5 }).success,
		).toBe(false);
	});
});

describe("Settings.ui (spec 0003 AC-21)", () => {
	test("is a strict object with background and ascii", () => {
		expect(
			Settings.safeParse({ ui: { background: "terminal", ascii: true } })
				.success,
		).toBe(true);
		expect(Settings.safeParse({ ui: { background: "light" } }).success).toBe(
			false,
		);
		expect(Settings.safeParse({ ui: { theme: "x" } }).success).toBe(false);
	});

	test("is user only", () => {
		expect(USER_ONLY_SETTINGS).toContain("ui");
	});
});
