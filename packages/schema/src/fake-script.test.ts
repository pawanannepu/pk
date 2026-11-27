import { describe, expect, test } from "bun:test";
import { callId } from "./fixtures.test-support.ts";
import { FakeScript, FakeStep, ProviderErrorCode } from "./index.ts";

describe("FakeScript (spec 0004 AC-10)", () => {
	test("parses event steps and error steps", () => {
		const script = FakeScript.parse({
			v: 1,
			steps: [
				{ error: { code: "provider.rate_limited", retryAfterMs: 2000 } },
				{
					events: [
						{ type: "tool_call_start", callId: callId(1), name: "read_file" },
						{ type: "tool_call_end", callId: callId(1), input: {} },
						{ type: "stop", reason: "tool_use" },
					],
					eventDelayMs: 5,
					thenError: { code: "provider.server", status: 500 },
				},
			],
		});
		expect(script.steps).toHaveLength(2);
	});

	test("rejects an empty script, a wrong version, a step with both forms, and a bad call id", () => {
		expect(FakeScript.safeParse({ v: 1, steps: [] }).success).toBe(false);
		expect(
			FakeScript.safeParse({ v: 2, steps: [{ events: [] }] }).success,
		).toBe(false);
		expect(
			FakeStep.safeParse({
				events: [],
				error: { code: "provider.auth" },
			}).success,
		).toBe(false);
		expect(
			FakeStep.safeParse({
				events: [{ type: "tool_call_start", callId: "call_1", name: "x" }],
			}).success,
		).toBe(false);
	});

	test("rejects an unknown error code and a negative retry wait", () => {
		expect(
			FakeStep.safeParse({ error: { code: "provider.nope" } }).success,
		).toBe(false);
		expect(
			FakeStep.safeParse({
				error: { code: "provider.server", retryAfterMs: -1 },
			}).success,
		).toBe(false);
		expect(ProviderErrorCode.options).toContain("provider.stream_broken");
	});
});
