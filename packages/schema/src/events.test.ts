import { describe, expect, test } from "bun:test";
import { AT } from "./fixtures.test-support.ts";
import {
	AgentEvent,
	classifyResultText,
	DENIED_TEXT,
	MAIN_AGENT_ID,
	NOT_RUN_TEXT,
	PermissionAnswer,
	PLAN_BLOCKED_TEXT,
	TurnEndReason,
} from "./index.ts";

/** Handles every variant: compiles only while the switch is exhaustive (AC-6). */
function label(event: AgentEvent): string {
	switch (event.type) {
		case "turn_start":
		case "text_delta":
		case "reasoning_delta":
		case "tool_call_start":
		case "message":
		case "permission_request":
		case "tool_run_start":
		case "tool_result":
		case "usage":
		case "todo_update":
		case "model_change":
		case "mode_change":
		case "notice":
		case "turn_end":
			return event.type;
		default: {
			const unhandled: never = event;
			return unhandled;
		}
	}
}

/** Misses `notice`, so the `never` check must fail to compile (AC-6). */
function missingOne(event: AgentEvent): string {
	switch (event.type) {
		case "turn_start":
		case "text_delta":
		case "reasoning_delta":
		case "tool_call_start":
		case "message":
		case "permission_request":
		case "tool_run_start":
		case "tool_result":
		case "usage":
		case "todo_update":
		case "model_change":
		case "mode_change":
		case "turn_end":
			return event.type;
		default: {
			// @ts-expect-error `notice` is not handled, so `event` is not `never`
			const unhandled: never = event;
			return unhandled;
		}
	}
}

describe("AgentEvent (AC-6)", () => {
	const notice = {
		seq: 0,
		at: AT,
		agentId: MAIN_AGENT_ID,
		type: "notice",
		level: "warning",
		code: "settings.unknown_key",
		text: "unknown key",
	};

	test("every variant carries seq, at and agentId", () => {
		expect(AgentEvent.parse(notice)).toEqual(AgentEvent.parse(notice));
		expect(label(AgentEvent.parse(notice))).toBe("notice");
		expect(typeof missingOne).toBe("function"); // its check is at compile time
		for (const key of ["seq", "at", "agentId"]) {
			const rest = Object.fromEntries(
				Object.entries(notice).filter(([k]) => k !== key),
			);
			expect(AgentEvent.safeParse(rest).success).toBe(false);
		}
		expect(AgentEvent.safeParse({ ...notice, seq: 1.5 }).success).toBe(false);
	});

	test("PermissionAnswer is allow_once, allow_session or deny with an optional note", () => {
		expect(PermissionAnswer.safeParse({ decision: "allow_once" }).success).toBe(
			true,
		);
		expect(
			PermissionAnswer.safeParse({ decision: "allow_session" }).success,
		).toBe(true);
		expect(
			PermissionAnswer.safeParse({ decision: "deny", note: "not that file" })
				.success,
		).toBe(true);
		expect(
			PermissionAnswer.safeParse({ decision: "allow_always" }).success,
		).toBe(false);
	});

	test("mode_change carries a permission mode, and turns can end denied (spec 0006 AC-13)", () => {
		const change = { ...notice, type: "mode_change", mode: "plan" };
		expect(label(AgentEvent.parse(change))).toBe("mode_change");
		expect(AgentEvent.safeParse({ ...change, mode: "yolo" }).success).toBe(
			false,
		);
		expect(TurnEndReason.parse("denied")).toBe("denied");
	});
});

describe("classifyResultText (spec 0006 AC-13)", () => {
	test("matches denials and plan blocks by prefix and not run by equality", () => {
		expect(classifyResultText(DENIED_TEXT)).toBe("denied");
		expect(classifyResultText(`${DENIED_TEXT} (note: use edit)`)).toBe(
			"denied",
		);
		expect(classifyResultText(`${PLAN_BLOCKED_TEXT}: pk is read only`)).toBe(
			"blocked",
		);
		expect(classifyResultText(NOT_RUN_TEXT)).toBe("not_run");
		expect(classifyResultText(`${NOT_RUN_TEXT}!`)).toBeUndefined();
		expect(classifyResultText("file not found")).toBeUndefined();
	});
});
