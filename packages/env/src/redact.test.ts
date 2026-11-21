import { describe, expect, test } from "bun:test";
import { PkError } from "./errors.ts";
import { REDACTED, redact } from "./redact.ts";

describe("redact", () => {
	test("removes known secret values wherever they appear", () => {
		const secret = "my-custom-key-123456";
		expect(redact(`calling with ${secret} now`, { secrets: [secret] })).toBe(
			`calling with ${REDACTED} now`,
		);
	});

	test("ignores very short known secrets", () => {
		expect(redact("abc def", { secrets: ["abc"] })).toBe("abc def");
	});

	test("masks common provider key and bearer token shapes", () => {
		const text = [
			"sk-ant-api03-abcdefghijklmnop",
			"sk-proj-abcdefghijklmnopqrstuvwx",
			"Authorization: Bearer abcdefghijklmnop",
			"gsk_abcdefghijklmnopqrstu",
			"ghp_abcdefghijklmnopqrstuvwxyz",
		].join(" | ");
		const out = redact(text);
		expect(out).not.toContain("abcdefghijklmnop");
		expect(out.split(REDACTED).length - 1).toBe(5);
	});

	test("replaces credential named fields whole and walks nested data", () => {
		const input = {
			apiKey: "anything",
			headers: { Authorization: "Basic xyz", "x-api-key": "k" },
			usage: { input_tokens: 12, output_tokens: 3 },
			list: [{ password: "hunter2" }, "plain"],
		};
		expect(redact(input)).toEqual({
			apiKey: REDACTED,
			headers: { Authorization: REDACTED, "x-api-key": REDACTED },
			usage: { input_tokens: 12, output_tokens: 3 },
			list: [{ password: REDACTED }, "plain"],
		});
	});

	test("does not mutate its input and survives cycles", () => {
		const input: Record<string, unknown> = { token: "t0ps3cret" };
		input.self = input;
		const out = redact(input) as Record<string, unknown>;
		expect(input.token).toBe("t0ps3cret");
		expect(out.token).toBe(REDACTED);
		expect(out.self).toBe(out);
	});

	test("turns errors into plain redacted records, keeping the code", () => {
		const error = new PkError(
			"provider.auth",
			"bad key sk-abcdefghijklmnopqrstuv",
		);
		const out = redact(error) as unknown as Record<string, unknown>;
		expect(out.name).toBe("PkError");
		expect(out.code).toBe("provider.auth");
		expect(out.message).toBe(`bad key ${REDACTED}`);
		expect(String(out.stack)).not.toContain("sk-abcdefghijklmnopqrstuv");
	});
});
