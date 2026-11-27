import { describe, expect, test } from "bun:test";
import { DENIED_TEXT } from "@pk/schema";
import {
	clipErrorText,
	deniedText,
	ERROR_TEXT_MAX,
	resultBlock,
} from "./results.ts";
import { callId } from "./test-support.ts";

describe("error text clipping (spec 0005 AC-4)", () => {
	test("a text of exactly 2000 characters is kept whole, with no …", () => {
		const text = "x".repeat(ERROR_TEXT_MAX);
		expect(clipErrorText(text)).toBe(text);
	});

	test("one character over is cut to 2000 plus …", () => {
		const clipped = clipErrorText("x".repeat(ERROR_TEXT_MAX + 1));
		expect(clipped).toBe(`${"x".repeat(ERROR_TEXT_MAX)}…`);
	});

	test("a secret is redacted before the cut is measured", () => {
		expect(clipErrorText("key sk-abcdefghijklmnopqrstuvwxyz")).not.toContain(
			"sk-abcdefghijklmnopqrstuvwxyz",
		);
	});
});

describe("deniedText (spec 0005 AC-10)", () => {
	test("no note, or an empty note, is the bare denied text", () => {
		expect(deniedText({ decision: "deny" })).toBe(DENIED_TEXT);
		expect(deniedText({ decision: "deny", note: "" })).toBe(DENIED_TEXT);
	});

	test("a note is added in brackets", () => {
		expect(deniedText({ decision: "deny", note: "not now" })).toBe(
			`${DENIED_TEXT} (note: not now)`,
		);
	});
});

describe("resultBlock (spec 0005 AC-4)", () => {
	test("successful content is never cut, however long", () => {
		const long = "y".repeat(5000);
		const block = resultBlock(callId(1), {
			content: [{ type: "text", text: long }],
			isError: false,
		});
		expect(block.content).toEqual([{ type: "text", text: long }]);
		expect(block.isError).toBe(false);
	});

	test("an error's text blocks are clipped", () => {
		const block = resultBlock(callId(1), {
			content: [{ type: "text", text: "z".repeat(3000) }],
			isError: true,
		});
		const [first] = block.content;
		expect(first?.type === "text" && first.text.length).toBe(
			ERROR_TEXT_MAX + 1,
		);
	});

	test("details pass through as JSON, and no details means no key", () => {
		const withDetails = resultBlock(callId(1), {
			content: [],
			isError: false,
			details: { files: [{ path: "a.txt", action: "read" }] },
		});
		expect(withDetails.details).toEqual({
			files: [{ path: "a.txt", action: "read" }],
		});
		const without = resultBlock(callId(1), { content: [], isError: false });
		expect("details" in without).toBe(false);
	});

	test("the block carries the call's id", () => {
		expect(resultBlock(callId(7), { content: [], isError: true }).callId).toBe(
			callId(7),
		);
	});
});
