import { describe, expect, test } from "bun:test";
import * as provider from "./index.ts";

// Spec 0004 AC-1: the public surface of @pk/provider that adapters, cli and the loop rely on.
describe("@pk/provider public surface (AC-1)", () => {
	test("exports every runtime value the spec names", () => {
		expect(typeof provider.ProviderError).toBe("function");
		expect(typeof provider.withRetry).toBe("function");
		expect(typeof provider.withTimeouts).toBe("function");
		expect(typeof provider.retryNoticeText).toBe("function");
		expect(typeof provider.resolveApiKey).toBe("function");
		expect(typeof provider.createFakeProvider).toBe("function");
		expect(typeof provider.NO_KEY_PLACEHOLDER).toBe("string");
	});

	test("the no key placeholder is pk-no-key (AC-9)", () => {
		expect(provider.NO_KEY_PLACEHOLDER).toBe("pk-no-key");
	});

	test("ProviderError is a PkError with a stable code and provider id (AC-6)", () => {
		const error = new provider.ProviderError({
			code: "provider.rate_limited",
			message: "slow down",
			providerId: "openai",
		});
		expect(error).toBeInstanceOf(Error);
		expect(error.code).toBe("provider.rate_limited");
		expect(error.providerId).toBe("openai");
		expect(error.retryable).toBe(true);
	});
});
