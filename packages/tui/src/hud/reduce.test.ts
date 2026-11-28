import { describe, expect, test } from "bun:test";
import {
	type AgentEvent,
	type JsonObject,
	MAIN_AGENT_ID,
	sumCosts,
} from "@pk/schema";
import {
	DEMO_SCRIPT,
	type DemoEvent,
	type DemoStep,
	demoId,
} from "../demo/script.ts";
import { ERROR_HINTS } from "../error-hints.ts";
import { formatCost } from "../format.ts";
import { reduceHud } from "./reduce.ts";
import { type HudAction, type HudState, initialHudState } from "./state.ts";

const base = () =>
	initialHudState({ provider: "demo", model: "scripted" }, "normal");
let seq = 0;
const ev = (event: DemoEvent, at = "2026-11-22T10:00:00.000Z"): AgentEvent => ({
	...event,
	seq: seq++,
	at,
	agentId: MAIN_AGENT_ID,
});
const run = (actions: readonly HudAction[], from: HudState = base()) =>
	actions.reduce(reduceHud, from);

/** One turn's events, following the allowed or denied branch, wrapped in turn_start. */
function turnEvents(index: number, allow: boolean): AgentEvent[] {
	const flatten = (steps: readonly DemoStep[]): DemoEvent[] =>
		steps.flatMap((s) =>
			"event" in s ? [s.event] : flatten(allow ? s.allowed : s.denied),
		);
	return [
		ev({ type: "turn_start", turnId: demoId("turn", index + 1) }),
		...flatten(DEMO_SCRIPT[index] ?? []).map((e) => ev(e)),
	];
}

describe("the full demo through reduceHud (spec 0003 Critical test scenarios)", () => {
	test("allowed branch: files, cost, error counts and the cut off grep", () => {
		const afterTwo = run([...turnEvents(0, true), ...turnEvents(1, true)]);
		expect(afterTwo.files).toEqual([
			{ path: "src/provider/index.ts", read: true, added: 0, removed: 0 },
			{ path: "src/provider/retry.ts", read: false, added: 3, removed: 1 },
		]);
		expect(formatCost(afterTwo.cost, "—")).toBe("$0.0031 +1 unpriced");
		expect(afterTwo.errors).toBe(1); // the failed bash
		expect(afterTwo.warnings).toBe(1);
		expect(afterTwo.todos.map((t) => t.status)).toEqual([
			"done",
			"in_progress",
			"pending",
		]);

		const [start3, ...rest3] = turnEvents(2, true);
		const atStart = run(start3 ? [start3] : [], afterTwo);
		expect(atStart.errors).toBe(0);
		const afterThree = run(rest3, atStart);
		expect(afterThree.errors).toBe(1); // the error turn_end, not the cut off grep
		const grep = afterThree.tools[demoId("call", 4)];
		expect(grep?.state).toBe("failed");
		expect(grep?.errorLine).toBe("interrupted");
		const errorItem = afterThree.transcript.at(-1);
		expect(errorItem?.kind === "error" && errorItem.code).toBe(
			"provider.rate_limited",
		);
		expect(errorItem?.kind === "error" && errorItem.hint).toBe(
			"wait a minute, or switch model",
		);
		expect(afterThree.turn.status).toBe("idle");
		expect(afterThree.submitting).toBe(false);
	});

	test("denied branch: no error count after turn 2", () => {
		const afterTwo = run([...turnEvents(0, false), ...turnEvents(1, false)]);
		expect(afterTwo.errors).toBe(0);
		expect(afterTwo.tools[demoId("call", 2)]?.outcome).toBe("denied");
		expect(afterTwo.files.map((f) => f.path)).toEqual([
			"src/provider/index.ts",
		]);
	});

	test("usage: session tokens, context tokens and the sparkline values", () => {
		const s = run(turnEvents(0, true));
		expect(s.usage.totalTokens).toBe(4_100 + 2_000 + 320);
		expect(s.usage.lastContextTokens).toBe(6_100);
		expect(s.usage.recentOutput).toEqual([320]);
		expect(
			sumCosts([{ source: "catalog", microUsd: 1_200 }]).knownMicroUsd,
		).toBe(s.cost.knownMicroUsd);
	});
});

describe("segments (spec 0003 AC-11)", () => {
	const m = demoId("msg", 7);
	test("text, then a tool call, then more text renders as text, tool line, text", () => {
		const s = run([
			ev({ type: "turn_start", turnId: demoId("turn", 9) }),
			ev({ type: "text_delta", messageId: m, text: "Looking " }),
			ev({ type: "text_delta", messageId: m, text: "now." }),
			ev({
				type: "tool_call_start",
				messageId: m,
				callId: demoId("call", 9),
				name: "read_file",
			}),
			ev({ type: "text_delta", messageId: m, text: "Found it." }),
		]);
		expect(s.transcript.map((i) => i.kind)).toEqual(["text", "tool", "text"]);
		expect(s.transcript.map((i) => i.key)).toEqual([
			`${m}:0`,
			`tool:${demoId("call", 9)}`,
			`${m}:1`,
		]);
		const first = s.transcript[0];
		expect(first?.kind === "text" && first.text).toBe("Looking now.");
	});

	test("a streaming item keeps its object identity for unchanged items", () => {
		const one = run([ev({ type: "text_delta", messageId: m, text: "a" })]);
		const withNotice = run(
			[ev({ type: "notice", level: "info", code: "x", text: "n" })],
			one,
		);
		const more = run(
			[ev({ type: "text_delta", messageId: demoId("msg", 8), text: "b" })],
			withNotice,
		);
		const again = run(
			[ev({ type: "text_delta", messageId: demoId("msg", 8), text: "c" })],
			more,
		);
		expect(again.transcript[0]).toBe(one.transcript[0]);
		expect(again.transcript[1]).toBe(withNotice.transcript[1]);
	});

	test("the final message adds text only when nothing streamed", () => {
		const message = (id: typeof m) =>
			ev({
				type: "message",
				message: {
					id,
					at: "2026-11-22T10:00:00.000Z",
					role: "assistant",
					model: { provider: "demo", model: "x" },
					stopReason: "end_turn",
					content: [{ type: "text", text: "whole" }],
				},
			});
		const streamed = run([
			ev({ type: "text_delta", messageId: m, text: "whole" }),
			message(m),
		]);
		expect(streamed.transcript.length).toBe(1);
		const silent = run([message(demoId("msg", 11))]);
		expect(silent.transcript.map((i) => i.kind === "text" && i.text)).toEqual([
			"whole",
		]);
	});

	test("reasoning duration is last delta minus first, at least 1 s", () => {
		const s = run([
			ev(
				{ type: "reasoning_delta", messageId: m, text: "a" },
				"2026-11-22T10:00:00.000Z",
			),
			ev(
				{ type: "reasoning_delta", messageId: m, text: "b" },
				"2026-11-22T10:00:04.200Z",
			),
		]);
		const item = s.transcript[0];
		expect(item?.kind === "reasoning" && item.lastAt - item.firstAt).toBe(
			4_200,
		);
	});
});

describe("tool calls (spec 0003 AC-12)", () => {
	const call = demoId("call", 20);
	test("an unknown call on tool_run_start or tool_result creates a line named tool", () => {
		const s = run([
			ev({
				type: "tool_result",
				durationMs: 5,
				result: {
					type: "tool_result",
					callId: call,
					isError: false,
					content: [{ type: "text", text: "héllo" }],
				},
			}),
		]);
		expect(s.tools[call]?.name).toBe("tool");
		expect(s.tools[call]?.state).toBe("done");
		expect(s.tools[call]?.sizeBytes).toBe(6); // UTF-8 bytes
		expect(s.transcript.map((i) => i.kind)).toEqual(["tool"]);
	});

	test("details that do not parse are ignored and never throw", () => {
		const s = run([
			ev({
				type: "tool_call_start",
				messageId: demoId("msg", 1),
				callId: call,
				name: "edit_file",
			}),
			ev({
				type: "tool_result",
				durationMs: 5,
				result: {
					type: "tool_result",
					callId: call,
					isError: false,
					content: [],
					details: { diff: 42 },
				},
			}),
		]);
		expect(s.tools[call]?.display).toBeUndefined();
		expect(s.tools[call]?.state).toBe("done");
	});

	test("the target comes from the first source that carries the input", () => {
		const s = run([
			ev({
				type: "tool_call_start",
				messageId: demoId("msg", 1),
				callId: call,
				name: "bash",
			}),
			ev({
				type: "permission_request",
				requestId: demoId("req", 5),
				kind: "execute",
				call: {
					type: "tool_call",
					id: call,
					name: "bash",
					input: { command: "ls -la\nrm x" },
				},
			}),
		]);
		expect(s.tools[call]?.target).toBe("ls -la");
		expect(s.permissions.length).toBe(1);
	});
});

describe("errors, notices and the stream (spec 0003 AC-14)", () => {
	test("error codes and messages pass through redact()", () => {
		const s = run([
			ev({
				type: "turn_end",
				turnId: demoId("turn", 1),
				reason: "error",
				error: {
					code: "provider.auth",
					message: "bad key sk-abcdefghijklmnopqrstuvwx",
				},
			}),
		]);
		const item = s.transcript[0];
		expect(item?.kind === "error" && item.message).toBe("bad key [REDACTED]");
		expect(item?.kind === "error" && item.hint).toContain("API key");
	});

	test("a missing error is unknown; interrupted and turn_limit add lines", () => {
		const s = run([
			ev({ type: "turn_end", turnId: demoId("turn", 1), reason: "error" }),
			ev({
				type: "turn_end",
				turnId: demoId("turn", 2),
				reason: "interrupted",
			}),
			ev({ type: "turn_end", turnId: demoId("turn", 3), reason: "turn_limit" }),
		]);
		expect(
			s.transcript.map((i) =>
				i.kind === "error"
					? `${i.code}: ${i.message}`
					: i.kind === "notice"
						? `${i.level}: ${i.text}`
						: i.kind,
			),
		).toEqual([
			"unknown: the turn ended with an error",
			"info: interrupted",
			"warning: turn limit reached",
		]);
		expect(s.warnings).toBe(1);
	});

	test("stream end and failure become a notice and a tui.session_failed error", () => {
		const s = run([
			{ type: "ui_stream_end" },
			{ type: "ui_stream_failed", message: "boom" },
		]);
		expect(
			s.transcript.map((i) =>
				i.kind === "error" ? i.code : i.kind === "notice" ? i.text : "",
			),
		).toEqual(["session ended", "tui.session_failed"]);
	});

	test("events from a subagent leave the state unchanged", () => {
		const before = base();
		const sub: AgentEvent = {
			...ev({ type: "notice", level: "warning", code: "x", text: "y" }),
			agentId: demoId("agent", 1),
		};
		expect(reduceHud(before, sub)).toBe(before);
	});

	test("a model change for the main role updates the model", () => {
		const s = run([
			ev({
				type: "model_change",
				role: "main",
				model: { provider: "openai", model: "gpt-5" },
			}),
			ev({
				type: "model_change",
				role: "summarize",
				model: { provider: "x", model: "y" },
			}),
		]);
		expect(s.model).toEqual({ provider: "openai", model: "gpt-5" });
	});
});

const toolResult = (
	callId: ReturnType<typeof demoId<"call">>,
	options: {
		readonly isError?: boolean;
		readonly text?: string;
		readonly details?: JsonObject;
	} = {},
): AgentEvent =>
	ev({
		type: "tool_result",
		durationMs: 10,
		result: {
			type: "tool_result",
			callId,
			isError: options.isError ?? false,
			content:
				options.text === undefined
					? []
					: [{ type: "text", text: options.text }],
			...(options.details === undefined ? {} : { details: options.details }),
		},
	});

const permission = (n: number): AgentEvent =>
	ev({
		type: "permission_request",
		requestId: demoId("req", n),
		kind: "write",
		call: {
			type: "tool_call",
			id: demoId("call", n),
			name: "edit_file",
			input: { path: `src/${n}.ts` },
		},
	});

const usage = (outputTokens: number, priced: boolean): AgentEvent =>
	ev({
		type: "usage",
		model: { provider: "demo", model: "scripted" },
		usage: {
			inputTokens: 100,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			outputTokens,
		},
		cost: priced
			? { source: "catalog", microUsd: 1_000 }
			: { source: "unknown" },
	});

describe("permission queue and turn end (spec 0003 AC-13, AC-14)", () => {
	test("permission requests queue in order and ui_respond removes only the answered one", () => {
		const s = run([permission(1), permission(2), permission(3)]);
		const answered = run(
			[{ type: "ui_respond", requestId: demoId("req", 2) }],
			s,
		);
		expect(answered.permissions.map((p) => p.requestId)).toEqual([
			demoId("req", 1),
			demoId("req", 3),
		]);
	});

	test("turn_end closes what the turn left open: panels, submitting, the segment and running calls", () => {
		const m = demoId("msg", 30);
		const running = demoId("call", 31);
		const s = run([
			{ type: "ui_submit", text: "go" },
			ev({ type: "turn_start", turnId: demoId("turn", 30) }),
			ev({ type: "text_delta", messageId: m, text: "a" }),
			permission(32),
			ev({
				type: "tool_call_start",
				messageId: m,
				callId: running,
				name: "bash",
			}),
			ev({ type: "tool_run_start", callId: running }),
			ev({ type: "turn_end", turnId: demoId("turn", 30), reason: "done" }),
		]);
		expect(s.turn.status).toBe("idle");
		expect(s.submitting).toBe(false);
		expect(s.permissions).toEqual([]);
		expect(s.openSegment).toBeUndefined();
		expect(s.tools[running]).toMatchObject({
			state: "failed",
			errorLine: "interrupted",
		});
		// A call cut off by the turn's end is not counted as an error.
		expect(s.errors).toBe(0);
	});
});

describe("counts, files and usage (spec 0003 AC-8, AC-10)", () => {
	test("warnings are a session total, errors reset at each turn_start", () => {
		const s = run([
			ev({ type: "turn_start", turnId: demoId("turn", 1) }),
			ev({ type: "notice", level: "warning", code: "x", text: "w1" }),
			{ type: "ui_notice", level: "warning", code: "y", text: "w2" },
			ev({ type: "notice", level: "info", code: "z", text: "i" }),
			toolResult(demoId("call", 40), { isError: true, text: "boom\nmore" }),
		]);
		expect(s.warnings).toBe(2);
		expect(s.errors).toBe(1);
		expect(s.tools[demoId("call", 40)]?.errorLine).toBe("boom");
		const next = run(
			[ev({ type: "turn_start", turnId: demoId("turn", 2) })],
			s,
		);
		expect(next.errors).toBe(0);
		expect(next.warnings).toBe(2);
	});

	test("a denied call is failed on screen but stays out of the error count", () => {
		const s = run([
			toolResult(demoId("call", 41), { isError: true, text: "denied by user" }),
		]);
		expect(s.tools[demoId("call", 41)]).toMatchObject({
			state: "failed",
			outcome: "denied",
		});
		expect(s.errors).toBe(0);
	});

	test("a denial with a note still shows as denied (spec 0005 AC-10)", () => {
		const s = run([
			toolResult(demoId("call", 42), {
				isError: true,
				text: "denied by user (note: use the test fixture instead)",
			}),
		]);
		expect(s.tools[demoId("call", 42)]).toMatchObject({ outcome: "denied" });
		expect(s.errors).toBe(0);
	});

	test("later touches of the same file add up, keep its first place, and read sticks", () => {
		const s = run([
			toolResult(demoId("call", 50), {
				details: { files: [{ path: "a.ts", action: "read" }] },
			}),
			toolResult(demoId("call", 51), {
				details: {
					files: [
						{ path: "b.ts", action: "edit", added: 1, removed: 0 },
						{ path: "a.ts", action: "edit", added: 2, removed: 3 },
					],
				},
			}),
			toolResult(demoId("call", 52), {
				details: {
					files: [{ path: "a.ts", action: "edit", added: 4, removed: 1 }],
				},
			}),
		]);
		expect(s.files).toEqual([
			{ path: "a.ts", read: true, added: 6, removed: 4 },
			{ path: "b.ts", read: false, added: 1, removed: 0 },
		]);
	});

	test("the sparkline keeps only the last 14 calls; unpriced calls are counted, never added as zero", () => {
		const s = run(Array.from({ length: 16 }, (_, i) => usage(i, i % 4 !== 0)));
		expect(s.usage.calls).toBe(16);
		expect(s.usage.recentOutput).toEqual(
			Array.from({ length: 14 }, (_, i) => i + 2),
		);
		expect(s.cost).toMatchObject({
			pricedCalls: 12,
			unknownCalls: 4,
			knownMicroUsd: 12_000,
		});
	});

	test("turn_start resets the last turn cost and keeps the session cost", () => {
		const s = run([
			ev({ type: "turn_start", turnId: demoId("turn", 1) }),
			usage(1, true),
			ev({ type: "turn_start", turnId: demoId("turn", 2) }),
			usage(1, true),
			usage(1, true),
		]);
		expect(s.cost.lastTurnMicroUsd).toBe(2_000);
		expect(s.cost.knownMicroUsd).toBe(3_000);
	});
});

describe("events that must not add lines (spec 0003 AC-11, AC-12)", () => {
	test("a second tool_call_start for the same call adds no second line", () => {
		const start = ev({
			type: "tool_call_start",
			messageId: demoId("msg", 60),
			callId: demoId("call", 60),
			name: "read_file",
		});
		const s = run([start, start]);
		expect(s.transcript.length).toBe(1);
	});

	test("a user message carrying only tool results adds nothing; your prompt adds a user line", () => {
		const s = run([
			ev({
				type: "message",
				message: {
					id: demoId("msg", 61),
					at: "2026-11-22T10:00:00.000Z",
					role: "user",
					content: [
						{
							type: "tool_result",
							callId: demoId("call", 61),
							isError: false,
							content: [{ type: "text", text: "file body" }],
						},
					],
				},
			}),
			ev({
				type: "message",
				message: {
					id: demoId("msg", 62),
					at: "2026-11-22T10:00:00.000Z",
					role: "user",
					content: [{ type: "text", text: "fix the retry" }],
				},
			}),
		]);
		expect(s.transcript.map((i) => i.kind === "user" && i.text)).toEqual([
			"fix the retry",
		]);
	});
});

describe("error hints (spec 0003 AC-14)", () => {
	test("every code in ERROR_HINTS shows its hint, and a code with none shows no hint", () => {
		for (const [code, hint] of Object.entries(ERROR_HINTS)) {
			const s = run([
				ev({
					type: "turn_end",
					turnId: demoId("turn", 1),
					reason: "error",
					error: { code, message: "m" },
				}),
			]);
			const item = s.transcript[0];
			expect(item?.kind === "error" && item.hint).toBe(hint);
		}
		const none = run([
			ev({
				type: "turn_end",
				turnId: demoId("turn", 1),
				reason: "error",
				error: { code: "provider.server", message: "m" },
			}),
		]);
		const item = none.transcript[0];
		expect(item?.kind === "error" && "hint" in item).toBe(false);
	});
});

describe("reduceHud is pure (root Functional rule)", () => {
	const deepFreeze = <T>(value: T): T => {
		if (
			value !== null &&
			typeof value === "object" &&
			!Object.isFrozen(value)
		) {
			Object.freeze(value);
			for (const child of Object.values(value)) deepFreeze(child);
		}
		return value;
	};

	test("a deeply frozen state can take the whole demo without anything changing in place", () => {
		const events = [...turnEvents(0, true), ...turnEvents(1, true)];
		const s = events.reduce(
			(state, event) => deepFreeze(reduceHud(state, event)),
			deepFreeze(base()),
		);
		expect(s.transcript.length).toBeGreaterThan(0);
	});
});
