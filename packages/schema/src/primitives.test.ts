import { describe, expect, test } from "bun:test";
import {
	AgentId,
	CallId,
	formatModelRef,
	ID_SCHEMAS,
	MAIN_AGENT_ID,
	MessageId,
	ModelRefInput,
	SessionId,
	Timestamp,
} from "./index.ts";

const BODY = "01JDX8Z3QK5V7W9Y0A2B4C6D8E";

describe("ModelRefInput (AC-4)", () => {
	test('"provider/model" splits at the first slash', () => {
		const ref = ModelRefInput.parse("openrouter/anthropic/claude-x");
		expect(ref).toEqual({
			provider: "openrouter",
			model: "anthropic/claude-x",
		});
		expect(formatModelRef(ref)).toBe("openrouter/anthropic/claude-x");
	});

	test("the object form passes through", () => {
		expect(ModelRefInput.parse({ provider: "openai", model: "gpt-x" })).toEqual(
			{
				provider: "openai",
				model: "gpt-x",
			},
		);
	});

	test.each([
		["", "empty"],
		["gpt-x", 'no "/"'],
		["Open AI/gpt-x", "^[a-z0-9][a-z0-9_-]{0,31}$"],
		["openai/", "model part"],
	])("rejects %p with a message naming the rule", (input, rule) => {
		const result = ModelRefInput.safeParse(input);
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toContain(rule);
	});
});

describe("IDs (AC-14)", () => {
	test("each schema accepts its own prefix only", () => {
		expect(SessionId.safeParse(`ses_${BODY}`).success).toBe(true);
		expect(MessageId.safeParse(`ses_${BODY}`).success).toBe(false);
		expect(CallId.safeParse(`call_${BODY}`).success).toBe(true);
		expect(CallId.safeParse(`call_${BODY.toLowerCase()}`).success).toBe(false);
		expect(CallId.safeParse(`call_${BODY}I`).success).toBe(false);
		expect(AgentId.safeParse("main").success).toBe(true);
		expect(AgentId.safeParse(`agent_${BODY}`).success).toBe(true);
		expect(AgentId.safeParse("agent_main").success).toBe(false);
		expect(MAIN_AGENT_ID).toBe(AgentId.parse("main"));
		for (const prefix of [
			"ses",
			"msg",
			"call",
			"req",
			"turn",
			"agent",
		] as const) {
			expect(ID_SCHEMAS[prefix].parse(`${prefix}_${BODY}`)).toBe(
				`${prefix}_${BODY}` as never,
			);
		}
	});

	test("IDs are branded: a CallId is not a MessageId", () => {
		const call = CallId.parse(`call_${BODY}`);
		const takesMessage = (id: MessageId): MessageId => id;
		// @ts-expect-error a CallId cannot be passed where a MessageId is expected
		takesMessage(call);
		// @ts-expect-error a plain string is not a MessageId
		takesMessage(`msg_${BODY}`);
	});
});

describe("Timestamp", () => {
	test("is ISO 8601 UTC with milliseconds", () => {
		expect(Timestamp.safeParse("2026-11-22T10:15:30.123Z").success).toBe(true);
		expect(Timestamp.safeParse("2026-11-22T10:15:30Z").success).toBe(false);
		expect(Timestamp.safeParse("2026-11-22T10:15:30.123+01:00").success).toBe(
			false,
		);
	});
});
