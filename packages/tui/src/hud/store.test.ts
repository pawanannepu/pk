import { describe, expect, test } from "bun:test";
import { ManualClock } from "@opentui/core/testing";
import { type AgentEvent, MAIN_AGENT_ID } from "@pk/schema";
import { createRoot } from "solid-js";
import { demoId } from "../demo/script.ts";
import { FLUSH_INTERVAL_MS } from "../hud-constants.ts";
import type { HudAction } from "./state.ts";
import { initialHudState } from "./state.ts";
import { createHudStore, pumpEvents } from "./store.ts";

const delta = (i: number): AgentEvent => ({
	type: "text_delta",
	seq: i,
	at: "2026-11-22T10:00:00.000Z",
	agentId: MAIN_AGENT_ID,
	messageId: demoId("msg", 1),
	text: "x",
});

describe("the batched store (spec 0003 AC-25)", () => {
	test("2,000 deltas at once apply in one flush, one state update", () => {
		createRoot((dispose) => {
			const clock = new ManualClock();
			const store = createHudStore(
				initialHudState({ provider: "demo", model: "m" }, "normal"),
				clock,
			);
			for (let i = 0; i < 2_000; i++) store.enqueue(delta(i));
			expect(store.flushes()).toBe(0);
			clock.advance(FLUSH_INTERVAL_MS);
			expect(store.flushes()).toBe(1);
			const item = store.state().transcript[0];
			expect(item?.kind === "text" && item.text.length).toBe(2_000);
			expect(store.state().transcript.length).toBe(1);
			dispose();
		});
	});

	test("flushes at most every 33 ms; dispatch applies the queue first, then the action", () => {
		createRoot((dispose) => {
			const clock = new ManualClock();
			const store = createHudStore(
				initialHudState({ provider: "demo", model: "m" }, "normal"),
				clock,
			);
			store.enqueue(delta(0));
			clock.advance(0);
			expect(store.flushes()).toBe(1);
			store.enqueue(delta(1));
			clock.advance(10);
			expect(store.flushes()).toBe(1);
			clock.advance(FLUSH_INTERVAL_MS);
			expect(store.flushes()).toBe(2);
			store.enqueue(delta(2));
			store.dispatch({ type: "ui_submit", text: "hi" });
			expect(store.flushes()).toBe(3);
			expect(store.state().submitting).toBe(true);
			const item = store.state().transcript[0];
			expect(item?.kind === "text" && item.text).toBe("xxx");
			expect(clock.pendingTimerCount).toBe(0);
			dispose();
		});
	});
});

describe("dispose (spec 0003 AC-19)", () => {
	test("dispose cancels the pending flush and drops the queue, so nothing runs after the screen closes", () => {
		createRoot((dispose) => {
			const clock = new ManualClock();
			const store = createHudStore(
				initialHudState({ provider: "demo", model: "m" }, "normal"),
				clock,
			);
			store.enqueue(delta(0));
			expect(clock.pendingTimerCount).toBe(1);
			store.dispose();
			expect(clock.pendingTimerCount).toBe(0);
			clock.advance(FLUSH_INTERVAL_MS * 3);
			expect(store.flushes()).toBe(0);
			expect(store.state().transcript).toEqual([]);
			dispose();
		});
	});
});

describe("pumpEvents (spec 0003 AC-14)", () => {
	async function* stream(
		events: readonly AgentEvent[],
		failWith?: unknown,
	): AsyncIterable<AgentEvent> {
		for (const event of events) yield event;
		if (failWith !== undefined) throw failWith;
	}

	test("every event goes in order, then one ui_stream_end", async () => {
		const seen: HudAction[] = [];
		await pumpEvents(stream([delta(0), delta(1)]), (a) => seen.push(a));
		expect(seen.map((a) => ("seq" in a ? a.seq : a.type))).toEqual([
			0,
			1,
			"ui_stream_end",
		]);
	});

	test("a throw becomes ui_stream_failed with its message, even when it is not an Error", async () => {
		const seen: HudAction[] = [];
		await pumpEvents(stream([delta(0)], new Error("socket closed")), (a) =>
			seen.push(a),
		);
		expect(seen.at(-1)).toEqual({
			type: "ui_stream_failed",
			message: "socket closed",
		});
		const odd: HudAction[] = [];
		await pumpEvents(stream([], "plain"), (a) => odd.push(a));
		expect(odd).toEqual([{ type: "ui_stream_failed", message: "plain" }]);
	});

	test("once stopped, it forwards nothing more: no events, no end, no failure", async () => {
		const seen: HudAction[] = [];
		let stopped = false;
		await pumpEvents(
			stream([delta(0), delta(1), delta(2)]),
			(a) => {
				seen.push(a);
				stopped = true;
			},
			() => stopped,
		);
		expect(seen.length).toBe(1);

		const failed: HudAction[] = [];
		await pumpEvents(
			stream([], new Error("late")),
			(a) => failed.push(a),
			() => true,
		);
		expect(failed).toEqual([]);
	});
});
