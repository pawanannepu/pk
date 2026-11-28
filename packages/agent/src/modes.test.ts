import { describe, expect, test } from "bun:test";
import { isPkError } from "@pk/env";
import {
	checkConversation,
	DENIED_TEXT,
	NOT_RUN_TEXT,
	PLAN_BLOCKED_TEXT,
} from "@pk/schema";
import { readFileTool, textOutcome } from "@pk/tools";
import {
	INTERRUPTED_BEFORE_TEXT,
	PLAN_BLOCKED_RESULT_TEXT,
} from "./results.ts";
import {
	callEvents,
	resultTexts,
	startSession,
	testCommandTool,
	testTool,
	textStep,
	toolStep,
} from "./test-support.ts";

const writer = () =>
	testTool("write_thing", "write", async () => textOutcome("written", false));
const runner = () =>
	testCommandTool("run_thing", async () => textOutcome("ran", false));

const write = (n: number, path = "a") => callEvents(n, "write_thing", { path });
const run = (n: number, command: string) =>
	callEvents(n, "run_thing", { path: command });

const count = (types: string[], type: string) =>
	types.filter((t) => t === type).length;

const lastEnd = (h: ReturnType<typeof startSession>) => {
	const end = h.events.findLast((e) => e.type === "turn_end");
	return end?.type === "turn_end" ? end.reason : undefined;
};

describe("answers and session allows (spec 0006 AC-1, AC-2)", () => {
	test("y runs once, the next call asks again, a stores the key and the third runs", async () => {
		const h = startSession(
			[
				toolStep(write(1)),
				toolStep(write(2)),
				toolStep(write(3)),
				textStep("done"),
			],
			{ tools: [writer()] },
		);
		h.session.submit("write three times");
		const first = await h.until("permission_request");
		h.session.respond(first.requestId, { decision: "allow_once" });
		const second = await h.until("permission_request");
		h.session.respond(second.requestId, { decision: "allow_session" });
		await h.turns();
		expect(count(h.types(), "permission_request")).toBe(2);
		expect(resultTexts(h.events)).toEqual(["written", "written", "written"]);
	});

	test("[a] on a command allows only that exact command", async () => {
		const h = startSession(
			[
				toolStep(run(1, "ls")),
				toolStep(run(2, "ls")),
				toolStep(run(3, "ls -la")),
				textStep("done"),
			],
			{ tools: [runner()] },
		);
		h.session.submit("list");
		const first = await h.until("permission_request");
		expect(first.kind).toBe("execute");
		h.session.respond(first.requestId, { decision: "allow_session" });
		const again = await h.until("permission_request");
		expect(again.call.input).toEqual({ path: "ls -la" });
		h.session.respond(again.requestId, { decision: "allow_once" });
		await h.turns();
		expect(count(h.types(), "permission_request")).toBe(2);
		expect(resultTexts(h.events)).toEqual(["ran", "ran", "ran"]);
	});
});

describe("accept_edits mode (spec 0006 AC-1)", () => {
	test("a write runs with no prompt while a command still asks", async () => {
		const h = startSession(
			[toolStep(write(1), run(2, "ls")), textStep("done")],
			{ tools: [writer(), runner()], mode: "accept_edits" },
		);
		h.session.submit("write then list");
		const request = await h.until("permission_request");
		expect(request.kind).toBe("execute");
		expect(request.call.name).toBe("run_thing");
		h.session.respond(request.requestId, { decision: "allow_once" });
		await h.turns();
		expect(count(h.types(), "permission_request")).toBe(1);
		expect(resultTexts(h.events)).toEqual(["written", "ran"]);
	});
});

describe("plan mode (spec 0006 AC-3)", () => {
	test("a write is blocked with no prompt and no run, the read runs, and the turn goes on", async () => {
		const h = startSession(
			[
				toolStep(write(1), callEvents(2, "read_file", { path: "hello.txt" })),
				textStep("here is my plan"),
			],
			{
				tools: [writer(), readFileTool],
				files: { "hello.txt": "hi" },
				mode: "plan",
			},
		);
		h.session.submit("plan it");
		await h.turns();
		expect(h.types()).not.toContain("permission_request");
		expect(count(h.types(), "tool_run_start")).toBe(1);
		const [blocked, read] = resultTexts(h.events);
		expect(blocked).toBe(PLAN_BLOCKED_RESULT_TEXT);
		expect(blocked).toStartWith(`${PLAN_BLOCKED_TEXT}: pk is read only`);
		expect(read).toContain("hi");
		const blockedEvent = h.events.find((e) => e.type === "tool_result");
		expect(
			blockedEvent?.type === "tool_result" && blockedEvent.durationMs,
		).toBe(0);
		expect(h.fake.requests()).toHaveLength(2);
		expect(lastEnd(h)).toBe("done");
	});

	test("a command is blocked too, with no prompt and no run", async () => {
		const h = startSession([toolStep(run(1, "ls")), textStep("plan")], {
			tools: [runner()],
			mode: "plan",
		});
		h.session.submit("list");
		await h.turns();
		expect(h.types()).not.toContain("permission_request");
		expect(h.types()).not.toContain("tool_run_start");
		expect(resultTexts(h.events)).toEqual([PLAN_BLOCKED_RESULT_TEXT]);
		expect(lastEnd(h)).toBe("done");
	});

	test("a session allow does not beat plan mode", async () => {
		const h = startSession(
			[
				toolStep(write(1)),
				textStep("ok"),
				toolStep(write(2)),
				textStep("ok again"),
			],
			{ tools: [writer()] },
		);
		h.session.submit("write");
		const request = await h.until("permission_request");
		h.session.respond(request.requestId, { decision: "allow_session" });
		await h.turns();
		h.session.setMode("plan");
		h.session.submit("write again");
		await h.turns();
		expect(resultTexts(h.events)).toEqual([
			"written",
			PLAN_BLOCKED_RESULT_TEXT,
		]);
	});
});

describe("deny paths (spec 0006 AC-4, AC-5)", () => {
	test("a plain deny stops the turn: later calls are not run, no model call, a queued prompt starts", async () => {
		const h = startSession(
			[
				toolStep(
					write(1),
					callEvents(2, "read_file", { path: "hello.txt" }),
					callEvents(3, "nope", {}),
				),
				textStep("next answer"),
			],
			{ tools: [writer(), readFileTool], files: { "hello.txt": "hi" } },
		);
		h.session.submit("write");
		h.session.submit("queued");
		const request = await h.until("permission_request");
		h.session.respond(request.requestId, { decision: "deny" });
		await h.turns();
		expect(resultTexts(h.events)).toEqual([
			DENIED_TEXT,
			NOT_RUN_TEXT,
			NOT_RUN_TEXT,
		]);
		expect(count(h.types(), "permission_request")).toBe(1);
		expect(h.types()).not.toContain("tool_run_start");
		expect(lastEnd(h)).toBe("denied");
		expect(checkConversation(h.session.conversation)).toEqual([]);

		// The queued prompt starts in the same step as turn_end, so the only other model call is its own.
		await h.turns();
		expect(lastEnd(h)).toBe("done");
		const requests = h.fake.requests();
		expect(requests).toHaveLength(2);
		expect(requests[1]?.messages.at(-1)).toMatchObject({
			role: "user",
			content: [{ type: "text", text: "queued" }],
		});
		expect(checkConversation(h.session.conversation)).toEqual([]);
	});

	test("a note is trimmed and the turn continues; a note of only spaces is a plain deny", async () => {
		const h = startSession(
			[toolStep(write(1), write(2)), textStep("ok"), toolStep(write(3))],
			{ tools: [writer()] },
		);
		h.session.submit("write");
		const first = await h.until("permission_request");
		h.session.respond(first.requestId, {
			decision: "deny",
			note: "  use the edit tool  ",
		});
		const second = await h.until("permission_request");
		h.session.respond(second.requestId, { decision: "allow_once" });
		await h.turns();
		expect(resultTexts(h.events)).toEqual([
			`${DENIED_TEXT} (note: use the edit tool)`,
			"written",
		]);
		expect(lastEnd(h)).toBe("done");

		h.session.submit("again");
		const third = await h.until("permission_request");
		h.session.respond(third.requestId, { decision: "deny", note: "   " });
		await h.turns();
		expect(resultTexts(h.events).at(-1)).toBe(DENIED_TEXT);
		expect(lastEnd(h)).toBe("denied");
	});

	test("the trimmed note reaches the model in the next request as the tool result (AC-4)", async () => {
		const h = startSession([toolStep(write(1)), textStep("ok")], {
			tools: [writer()],
		});
		h.session.submit("write");
		const request = await h.until("permission_request");
		h.session.respond(request.requestId, {
			decision: "deny",
			note: "  use the fixture  ",
		});
		await h.turns();
		const requests = h.fake.requests();
		expect(requests).toHaveLength(2);
		const sent = JSON.stringify(requests[1]?.messages);
		expect(sent).toContain(`${DENIED_TEXT} (note: use the fixture)`);
		expect(sent).not.toContain("  use the fixture  ");
	});

	test("a plain deny on the last allowed model call ends denied, not turn_limit", async () => {
		const h = startSession([toolStep(write(1))], {
			tools: [writer()],
			maxTurns: 1,
		});
		h.session.submit("write");
		const request = await h.until("permission_request");
		h.session.respond(request.requestId, { decision: "deny" });
		await h.turns();
		expect(lastEnd(h)).toBe("denied");
	});
});

describe("modes and setMode (spec 0006 AC-8, AC-9)", () => {
	test("start notices are the first events, before any turn", async () => {
		const notice = {
			level: "warning" as const,
			code: "permissions.skip_all_setting_ignored",
			text: "ignored",
		};
		const h = startSession([textStep("hi")], { notices: [notice] });
		h.session.submit("hello");
		await h.turns();
		expect(h.events[0]).toMatchObject({ seq: 0, type: "notice", ...notice });
		expect(h.events[1]?.type).toBe("turn_start");
	});

	test("skip_all without skipAllAvailable is a wiring bug", () => {
		let thrown: unknown;
		try {
			startSession([], { mode: "skip_all" });
		} catch (error) {
			thrown = error;
		}
		expect(isPkError(thrown) && thrown.code).toBe("agent.invalid_mode");
	});

	test("skip_all with the flag runs writes and commands without asking", async () => {
		const h = startSession([toolStep(write(1), run(2, "rm -rf dist"))], {
			tools: [writer(), runner()],
			mode: "skip_all",
			skipAllAvailable: true,
		});
		h.session.submit("go");
		await h.turns();
		expect(h.types()).not.toContain("permission_request");
		expect(resultTexts(h.events)).toEqual(["written", "ran"]);
	});

	test("the getter changes at once, each change emits one mode_change, even while idle", async () => {
		const h = startSession([textStep("hi")]);
		expect(h.session.mode).toBe("normal");
		h.session.setMode("accept_edits");
		h.session.setMode("plan");
		h.session.setMode("plan");
		expect(h.session.mode).toBe("plan");
		h.session.setMode("skip_all");
		expect(h.session.mode).toBe("plan");
		const first = await h.until("mode_change");
		const second = await h.until("mode_change");
		expect([first.mode, second.mode]).toEqual(["accept_edits", "plan"]);
		await h.session.close();
		h.session.setMode("normal");
		expect(h.session.mode).toBe("plan");
		await h.turns();
		expect(count(h.types(), "mode_change")).toBe(2);
	});

	test("switching to accept_edits runs a pending write with a trace notice; a late respond is ignored", async () => {
		const h = startSession([toolStep(write(1)), textStep("ok")], {
			tools: [writer()],
		});
		h.session.submit("write");
		const request = await h.until("permission_request");
		h.session.setMode("accept_edits");
		h.session.respond(request.requestId, { decision: "deny" });
		await h.turns();
		const types = h.types();
		const notice = h.events.find(
			(e) => e.type === "notice" && e.code === "permissions.allowed_by_mode",
		);
		expect(notice?.type === "notice" && notice.text).toBe(
			"allowed by accept edits mode",
		);
		expect(types.indexOf("mode_change")).toBeLessThan(
			types.indexOf("tool_run_start"),
		);
		expect(resultTexts(h.events)).toEqual(["written"]);
		expect(lastEnd(h)).toBe("done");
	});

	test("with the flag, switching to skip_all runs a pending command with a trace notice", async () => {
		const h = startSession([toolStep(run(1, "ls")), textStep("ok")], {
			tools: [runner()],
			skipAllAvailable: true,
		});
		h.session.submit("list");
		await h.until("permission_request");
		h.session.setMode("skip_all");
		await h.turns();
		expect(h.session.mode).toBe("skip_all");
		const notice = h.events.find(
			(e) => e.type === "notice" && e.code === "permissions.allowed_by_mode",
		);
		expect(notice?.type === "notice" && notice.text).toBe(
			"allowed by skip all mode",
		);
		expect(resultTexts(h.events)).toEqual(["ran"]);
	});

	test("switching to plan blocks a pending write", async () => {
		const h = startSession([toolStep(write(1)), textStep("ok")], {
			tools: [writer()],
		});
		h.session.submit("write");
		await h.until("permission_request");
		h.session.setMode("plan");
		await h.turns();
		expect(resultTexts(h.events)).toEqual([PLAN_BLOCKED_RESULT_TEXT]);
		expect(h.types()).not.toContain("tool_run_start");
	});

	test("switching to normal keeps a pending command waiting", async () => {
		const h = startSession([toolStep(run(1, "ls")), textStep("ok")], {
			tools: [runner()],
			mode: "accept_edits",
		});
		h.session.submit("list");
		const request = await h.until("permission_request");
		h.session.setMode("normal");
		await h.until("mode_change");
		expect(count(h.types(), "permission_request")).toBe(1);
		h.session.respond(request.requestId, { decision: "allow_once" });
		await h.turns();
		expect(resultTexts(h.events)).toEqual(["ran"]);
	});

	test("an interrupt beats a later setMode: the pending call never runs (AC-14)", async () => {
		const h = startSession([toolStep(write(1))], { tools: [writer()] });
		h.session.submit("write");
		await h.until("permission_request");
		h.session.interrupt();
		h.session.setMode("accept_edits");
		await h.turns();
		expect(h.types()).not.toContain("tool_run_start");
		expect(resultTexts(h.events)).toEqual([INTERRUPTED_BEFORE_TEXT]);
		expect(lastEnd(h)).toBe("interrupted");
	});
});
