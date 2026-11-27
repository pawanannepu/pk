import { describe, expect, test } from "bun:test";
import {
	DEFAULT_RETRYABLE,
	ProviderError,
	withMessageSuffix,
} from "./errors.ts";
import { NO_KEY_PLACEHOLDER, resolveApiKey } from "./keys.ts";

const env =
	(values: Record<string, string>) =>
	(name: string): string | undefined =>
		values[name];

describe("resolveApiKey (AC-9)", () => {
	test("returns the variable's value, read on every call", () => {
		const values: Record<string, string> = { GROQ_API_KEY: "gsk_one" };
		expect(resolveApiKey({ env: "GROQ_API_KEY" }, env(values), "groq")).toBe(
			"gsk_one",
		);
		values.GROQ_API_KEY = "gsk_two";
		expect(resolveApiKey({ env: "GROQ_API_KEY" }, env(values), "groq")).toBe(
			"gsk_two",
		);
	});

	test("unset or empty is provider.missing_key, naming the variable", () => {
		for (const values of [{}, { OPENAI_API_KEY: "" }] as Record<
			string,
			string
		>[]) {
			try {
				resolveApiKey({ env: "OPENAI_API_KEY" }, env(values), "openai");
				throw new Error("expected a throw");
			} catch (error) {
				expect(error).toBeInstanceOf(ProviderError);
				const e = error as ProviderError;
				expect(e.code).toBe("provider.missing_key");
				expect(e.retryable).toBe(false);
				expect(e.message).toBe(
					"OPENAI_API_KEY is not set. Export it, or change providers.openai.apiKey in your user settings.",
				);
			}
		}
	});

	test("keychain is unavailable until pk login; no source is the placeholder", () => {
		expect(() => resolveApiKey({ keychain: true }, env({}), "openai")).toThrow(
			/Keychain keys arrive with pk login/,
		);
		expect(resolveApiKey(undefined, env({}), "ollama")).toBe(
			NO_KEY_PLACEHOLDER,
		);
		expect(NO_KEY_PLACEHOLDER).toBe("pk-no-key");
	});
});

describe("ProviderError (AC-6, AC-7)", () => {
	test("retryable defaults from the code, and a suffix makes a new error with the same fields", () => {
		const error = new ProviderError({
			code: "provider.overloaded",
			message: "groq is overloaded (503). Try again shortly.",
			providerId: "groq",
			status: 503,
			cause: { name: "InternalServerError", status: 503 },
		});
		expect(error.retryable).toBe(DEFAULT_RETRYABLE["provider.overloaded"]);
		expect(error.retryable).toBe(true);
		const longer = withMessageSuffix(error, " (gave up after 5 attempts)");
		expect(longer).not.toBe(error);
		expect(error.message).toBe("groq is overloaded (503). Try again shortly.");
		expect(longer.message).toEndWith("(gave up after 5 attempts)");
		expect([
			longer.code,
			longer.status,
			longer.providerId,
			longer.retryable,
		]).toEqual(["provider.overloaded", 503, "groq", true]);
		expect(longer.cause).toEqual({ name: "InternalServerError", status: 503 });
		expect(longer.name).toBe("ProviderError");
	});
});
