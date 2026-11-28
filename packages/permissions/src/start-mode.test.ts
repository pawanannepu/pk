import { describe, expect, test } from "bun:test";
import {
	resolveStartMode,
	SKIP_ALL_SETTING_IGNORED_CODE,
	SKIP_ALL_SETTING_IGNORED_TEXT,
} from "./start-mode.ts";

describe("resolveStartMode (spec 0006 AC-7)", () => {
	test("the skip flag gives skip_all and makes it available", () => {
		expect(resolveStartMode({ skipFlag: true, settingsMode: "plan" })).toEqual({
			mode: "skip_all",
			skipAllAvailable: true,
			notices: [],
		});
	});

	test("the skip flag with a skip_all setting gives no ignored setting warning", () => {
		expect(
			resolveStartMode({ skipFlag: true, settingsMode: "skip_all" }),
		).toEqual({ mode: "skip_all", skipAllAvailable: true, notices: [] });
	});

	test("--mode wins over settings, and a skip_all setting gives no notice then", () => {
		expect(
			resolveStartMode({
				flagMode: "plan",
				skipFlag: false,
				settingsMode: "skip_all",
			}),
		).toEqual({ mode: "plan", skipAllAvailable: false, notices: [] });
	});

	test("the settings mode is used when no flag is given", () => {
		for (const mode of ["normal", "accept_edits", "plan"] as const) {
			expect(resolveStartMode({ skipFlag: false, settingsMode: mode })).toEqual(
				{ mode, skipAllAvailable: false, notices: [] },
			);
		}
	});

	test("a skip_all setting is ignored with a warning", () => {
		expect(
			resolveStartMode({ skipFlag: false, settingsMode: "skip_all" }),
		).toEqual({
			mode: "normal",
			skipAllAvailable: false,
			notices: [
				{
					level: "warning",
					code: SKIP_ALL_SETTING_IGNORED_CODE,
					text: SKIP_ALL_SETTING_IGNORED_TEXT,
				},
			],
		});
		expect(SKIP_ALL_SETTING_IGNORED_CODE).toBe(
			"permissions.skip_all_setting_ignored",
		);
	});

	test("nothing set gives normal", () => {
		expect(resolveStartMode({ skipFlag: false })).toEqual({
			mode: "normal",
			skipAllAvailable: false,
			notices: [],
		});
	});
});
