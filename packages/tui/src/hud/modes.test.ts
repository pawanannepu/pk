import { describe, expect, test } from "bun:test";
import {
	type AgentEvent,
	DENIED_TEXT,
	MAIN_AGENT_ID,
	NOT_RUN_TEXT,
	type PermissionMode,
	PLAN_BLOCKED_TEXT,
} from "@pk/schema";
import { type DemoEvent, demoId } from "../demo/script.ts";
import { reduceHud } from "./reduce.ts";
import {
	type HudAction,
	type HudState,
	initialHudState,
	SKIP_ALL_LINE,
} from "./state.ts";

const MODEL = { provider: "demo", model: "scripted" };
const ev = (event: DemoEvent): AgentEvent => ({
	...event,
	seq: 0,
	at: "2026-11-22T10:00:00.000Z",
	agentId: MAIN_AGENT_ID,
});
const run = (actions: readonly HudAction[], from: HudState) =>
	actions.reduce(reduceHud, from);
const change = (mode: PermissionMode) => ev({ type: "mode_change", mode });
const dangerLines = (s: HudState) =>
	s.transcript.filter((i) => i.kind === "notice" && i.level === "danger");

const errorResult = (n: number, text: string) =>
	ev({
		type: "tool_result",
		durationMs: 0,
		result: {
			type: "tool_result",
			callId: demoId("call", n),
			isError: true,
			content: [{ type: "text", text }],
		},
	});

describe("the HUD mode (spec 0006 AC-10, AC-11)", () => {
	test("the mode starts from info.mode and follows mode_change", () => {
		const s = run(
			[change("accept_edits"), change("plan")],
			initialHudState(MODEL, "normal"),
		);
		expect(s.mode).toBe("plan");
	});

	test("starting in skip_all adds one red line, counted as a warning, and the hero stays", () => {
		const s = initialHudState(MODEL, "skip_all");
		expect(dangerLines(s)).toEqual([
			expect.objectContaining({ text: SKIP_ALL_LINE }),
		]);
		expect(s.warnings).toBe(1);
		expect(s.hasMessage).toBe(false);
	});

	test("each entry into skip_all adds a line, and lines stay after leaving", () => {
		const s = run(
			[
				change("skip_all"),
				change("normal"),
				change("accept_edits"),
				change("plan"),
				change("skip_all"),
				change("skip_all"),
				change("normal"),
			],
			initialHudState(MODEL, "plan"),
		);
		expect(dangerLines(s)).toHaveLength(2);
		expect(s.warnings).toBe(2);
		expect(s.mode).toBe("normal");
	});

	test("the hero gives way to the first submit or message, not to a notice", () => {
		const noticed = run(
			[ev({ type: "notice", level: "warning", code: "x", text: "careful" })],
			initialHudState(MODEL, "normal"),
		);
		expect(noticed.hasMessage).toBe(false);
		expect(
			reduceHud(noticed, { type: "ui_submit", text: "hi" }).hasMessage,
		).toBe(true);
	});
});

describe("outcomes and the denied turn end (spec 0006 AC-9, AC-12)", () => {
	test("denied, blocked and not run are dim outcomes, none counted as an error", () => {
		const s = run(
			[
				ev({ type: "turn_start", turnId: demoId("turn", 1) }),
				errorResult(1, `${DENIED_TEXT} (note: no)`),
				errorResult(2, `${PLAN_BLOCKED_TEXT}: pk is read only right now`),
				errorResult(3, NOT_RUN_TEXT),
				errorResult(4, "file not found"),
			],
			initialHudState(MODEL, "normal"),
		);
		expect(
			[1, 2, 3, 4].map((n) => s.tools[demoId("call", n)]?.outcome),
		).toEqual(["denied", "blocked", "not_run", undefined]);
		expect(s.errors).toBe(1);
	});

	test("turn_end denied adds the stopped line", () => {
		const s = run(
			[
				ev({ type: "turn_start", turnId: demoId("turn", 1) }),
				ev({ type: "turn_end", turnId: demoId("turn", 1), reason: "denied" }),
			],
			initialHudState(MODEL, "normal"),
		);
		const last = s.transcript.at(-1);
		expect(last).toMatchObject({
			kind: "notice",
			level: "info",
			text: "stopped: you denied a tool call",
		});
	});

	test("a tool_run_start or tool_result for the pending call closes its panel", () => {
		const call = {
			type: "tool_call" as const,
			id: demoId("call", 7),
			name: "edit_file",
			input: { path: "a" },
		};
		const asked = run(
			[
				ev({
					type: "permission_request",
					requestId: demoId("req", 7),
					call,
					kind: "write",
				}),
			],
			initialHudState(MODEL, "normal"),
		);
		expect(asked.permissions).toHaveLength(1);
		const ran = reduceHud(
			asked,
			ev({ type: "tool_run_start", callId: demoId("call", 7) }),
		);
		expect(ran.permissions).toEqual([]);
		const blocked = reduceHud(asked, errorResult(7, PLAN_BLOCKED_TEXT));
		expect(blocked.permissions).toEqual([]);
	});
});
