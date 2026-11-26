import { describe, expect, test } from "bun:test";
import { ManualClock } from "@opentui/core/testing";
import { AgentEvent, MAIN_AGENT_ID } from "@pk/schema";
import { DEMO_SCRIPT, type DemoStep } from "./script.ts";
import { createScriptedSession } from "./scripted-session.ts";

const AT = "2026-11-22T10:00:00.000Z";

function eventsOf(steps: readonly DemoStep[]): DemoStep[] {
	return steps.flatMap((step) =>
		"event" in step
			? [step]
			: [...eventsOf(step.allowed), ...eventsOf(step.denied)],
	);
}

describe("the demo script (spec 0003 AC-22)", () => {
	test("every scripted event parses as an AgentEvent", () => {
		const steps = DEMO_SCRIPT.flatMap(eventsOf);
		expect(steps.length).toBeGreaterThan(40);
		const failures = steps.flatMap((step) => {
			if (!("event" in step)) return [];
			const parsed = AgentEvent.safeParse({
				...step.event,
				seq: 0,
				at: AT,
				agentId: MAIN_AGENT_ID,
			});
			return parsed.success
				? []
				: [`${step.event.type}: ${parsed.error.message}`];
		});
		expect(failures).toEqual([]);
	});

	test("every turn ends with exactly one turn_end, last", () => {
		for (const turn of DEMO_SCRIPT) {
			const ends = eventsOf(turn).filter(
				(s) => "event" in s && s.event.type === "turn_end",
			);
			expect(ends.length).toBe(1);
			const last = turn.at(-1);
			expect(last && "event" in last && last.event.type).toBe("turn_end");
		}
	});
});

async function drain(clock: ManualClock, ms: number) {
	for (let t = 0; t < ms; t += 10) {
		clock.advance(10);
		for (let i = 0; i < 5; i++) await Promise.resolve();
	}
}

describe("createScriptedSession", () => {
	test("plays turn N on the Nth submit with turn_start, your message and rising seq", async () => {
		const clock = new ManualClock();
		const session = createScriptedSession(DEMO_SCRIPT, { clock, speed: 10 });
		const seen: AgentEvent[] = [];
		void (async () => {
			for await (const event of session.events) seen.push(event);
		})();
		session.submit("hello");
		await drain(clock, 2_000);
		expect(seen[0]?.type).toBe("turn_start");
		expect(seen[1]?.type === "message" && seen[1].message.role).toBe("user");
		expect(seen.at(-1)?.type).toBe("turn_end");
		expect(seen.map((e) => e.seq)).toEqual(seen.map((_, i) => i));
		for (const event of seen)
			expect(AgentEvent.safeParse(event).success).toBe(true);
	});

	test("waits on respond and follows the denied branch", async () => {
		const clock = new ManualClock();
		const session = createScriptedSession(DEMO_SCRIPT, { clock, speed: 10 });
		const seen: AgentEvent[] = [];
		void (async () => {
			for await (const event of session.events) seen.push(event);
		})();
		session.submit("one");
		await drain(clock, 2_000);
		session.submit("two");
		await drain(clock, 1_000);
		const requests = seen.flatMap((e) =>
			e.type === "permission_request" ? [e.requestId] : [],
		);
		expect(requests.length).toBe(2);
		expect(seen.at(-1)?.type).toBe("permission_request");
		for (const id of requests) session.respond(id, { decision: "deny" });
		await drain(clock, 2_000);
		const denied = seen.filter(
			(e) =>
				e.type === "tool_result" &&
				e.result.content[0]?.type === "text" &&
				e.result.content[0].text === "denied by user",
		);
		expect(denied.length).toBe(2);
		expect(seen.at(-1)?.type).toBe("turn_end");
	});
});
