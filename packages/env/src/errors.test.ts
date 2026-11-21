import { describe, expect, test } from "bun:test";
import { isPkError, PkError } from "./errors.ts";

class RateLimited extends PkError {
	constructor(cause?: unknown) {
		super("provider.rate_limited", "the provider is rate limiting you", {
			cause,
		});
	}
}

describe("PkError", () => {
	test("carries a stable code and the message", () => {
		const error = new PkError("tool.bad_input", "path is required");

		expect(error.code).toBe("tool.bad_input");
		expect(error.message).toBe("path is required");
		expect(error).toBeInstanceOf(Error);
	});

	test("a subclass reports its own name, so logs say what failed", () => {
		const error = new RateLimited();

		expect(error.name).toBe("RateLimited");
		expect(error.code).toBe("provider.rate_limited");
		expect(error).toBeInstanceOf(PkError);
	});

	test("keeps the cause it was given", () => {
		const cause = new Error("HTTP 429");

		expect(new RateLimited(cause).cause).toBe(cause);
	});

	test("has no cause when none is given", () => {
		expect(new PkError("x", "y").cause).toBeUndefined();
	});
});

describe("isPkError", () => {
	test("is true for PkError and its subclasses", () => {
		expect(isPkError(new PkError("x", "y"))).toBe(true);
		expect(isPkError(new RateLimited())).toBe(true);
	});

	test("is false for plain errors and other values, even with a code field", () => {
		expect(isPkError(new Error("plain"))).toBe(false);
		expect(isPkError({ code: "provider.rate_limited", message: "fake" })).toBe(
			false,
		);
		expect(isPkError(undefined)).toBe(false);
		expect(isPkError("provider.rate_limited")).toBe(false);
	});
});
