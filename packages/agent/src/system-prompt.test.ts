import { describe, expect, test } from "bun:test";
import {
	DEFAULT_MAX_TURNS,
	localDate,
	PLACEHOLDER_SYSTEM_PROMPT_VERSION,
	placeholderSystemPrompt,
} from "./system-prompt.ts";

describe("placeholderSystemPrompt (spec 0005 AC-15)", () => {
	test("names the root, the date and the tools joined with a comma, in the order given", () => {
		const prompt = placeholderSystemPrompt({
			projectRoot: "/work/app",
			today: "2026-01-02",
			toolNames: ["read_file", "grep", "bash"],
		});
		expect(prompt).toContain("The project is at /work/app.");
		expect(prompt).toContain("Today is 2026-01-02.");
		expect(prompt).toContain("(read_file, grep, bash)");
	});

	test("is version 1 and pure: the same input gives the same text", () => {
		const input = {
			projectRoot: "/r",
			today: "2026-11-27",
			toolNames: ["read_file"],
		};
		expect(PLACEHOLDER_SYSTEM_PROMPT_VERSION).toBe(1);
		expect(placeholderSystemPrompt(input)).toBe(placeholderSystemPrompt(input));
	});
});

describe("localDate (spec 0005 value sourcing: today)", () => {
	// 2026-11-27 23:59 in New York is 2026-11-28 04:59 UTC.
	const lateEvening = Date.UTC(2026, 10, 28, 4, 59);

	test("is the local calendar date, not the UTC one, late in the evening", () => {
		expect(localDate(lateEvening, "America/New_York")).toBe("2026-11-27");
		expect(localDate(lateEvening, "UTC")).toBe("2026-11-28");
	});

	test("is the next day already in a zone ahead of UTC", () => {
		// 2026-11-27 20:00 UTC is 2026-11-28 05:00 in Tokyo.
		expect(localDate(Date.UTC(2026, 10, 27, 20), "Asia/Tokyo")).toBe(
			"2026-11-28",
		);
	});

	test("pads month and day to two digits", () => {
		expect(localDate(Date.UTC(2026, 0, 5, 12), "UTC")).toBe("2026-01-05");
	});
});

describe("DEFAULT_MAX_TURNS (spec 0005 AC-3)", () => {
	test("is 50", () => {
		expect(DEFAULT_MAX_TURNS).toBe(50);
	});
});
