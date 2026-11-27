import { describe, expect, test } from "bun:test";
import { isPkError } from "@pk/env";
import type { Provider } from "@pk/provider";
import { checkConversation, DENIED_TEXT } from "@pk/schema";
import {
	type FileStamp,
	readFileTool,
	ToolError,
	textOutcome,
} from "@pk/tools";
import {
	INTERNAL_ERROR_TEXT,
	INTERRUPTED_BEFORE_TEXT,
	INTERRUPTED_DURING_TEXT,
	REPLY_FAILED_TEXT,
} from "./results.ts";
import { foldStamps } from "./session.ts";
import { placeholderSystemPrompt } from "./system-prompt.ts";
import {
	callEvents,
	callId,
	ROOT,
	resultTexts,
	startSession,
	testTool,
	textStep,
	toolStep,
} from "./test-support.ts";

const readHello = toolStep(callEvents(1, "read_file", { path: "hello.txt" }));

describe("the loop (spec 0005)", () => {
	test("happy path: read_file through a real call, then the answer (AC-1, AC-2, AC-11, AC-15)", async () => {
		const h = startSession([readHello, textStep("It says hello.")], {
			files: { "hello.txt": "hello\nworld\n" },
		});
		h.session.submit("what is in hello.txt?");
		await h.turns();

		expect(h.types()).toEqual([
			"turn_start",
			"message",
			"tool_call_start",
			"usage",
			"message",
			"tool_run_start",
			"tool_result",
			"message",
			"text_delta",
			"usage",
			"message",
			"turn_end",
		]);
		expect(h.events.map((e) => e.seq)).toEqual(h.events.map((_, i) => i));
		expect(h.events.every((e) => e.agentId === "main")).toBe(true);
		expect(resultTexts(h.events)).toEqual(["     1\thello\n     2\tworld"]);
		const end = h.events.at(-1);
		expect(end?.type === "turn_end" && end.reason).toBe("done");
		expect(checkConversation(h.session.conversation)).toEqual([]);
		expect(h.session.conversation.map((m) => m.role)).toEqual([
			"user",
			"assistant",
			"user",
			"assistant",
		]);

		const [first] = h.fake.requests();
		expect(first?.system).toBe(
			placeholderSystemPrompt({
				projectRoot: ROOT,
				today: "2026-11-27",
				toolNames: ["read_file"],
			}),
		);
		expect(first?.tools.map((t) => t.name)).toEqual(["read_file"]);
		expect(first?.maxOutputTokens).toBeUndefined();

		const result = h.events.find((e) => e.type === "tool_result");
		expect(result?.type === "tool_result" && result.result.details).toEqual({
			files: [{ path: "hello.txt", action: "read" }],
		});
		expect(h.session.ledger.get(`${ROOT}/hello.txt`)?.lines).toEqual({
			from: 1,
			to: 2,
			total: 2,
		});
	});

	test("the turn limit stops a runaway loop after maxTurns model calls, with no notice (AC-3)", async () => {
		const h = startSession(
			[
				...[1, 2, 3, 4].map((n) =>
					toolStep(callEvents(n, "read_file", { path: "hello.txt" })),
				),
				textStep("later"),
			],
			{ files: { "hello.txt": "hi" }, maxTurns: 3 },
		);
		h.session.submit("loop");
		await h.turns();
		expect(h.fake.requests()).toHaveLength(3);
		const end = h.events.at(-1);
		expect(end?.type === "turn_end" && end.reason).toBe("turn_limit");
		expect(h.types()).not.toContain("notice");
		// The third reply's tools still ran and were recorded.
		expect(h.session.conversation.at(-1)?.role).toBe("user");
		expect(checkConversation(h.session.conversation)).toEqual([]);

		h.session.submit("go on");
		await h.turns();
		expect(h.fake.requests()).toHaveLength(5);
		expect(h.fake.requests()[3]?.messages).toHaveLength(8);
	});

	test("bad calls become error results and the turn continues (AC-4)", async () => {
		const pkFails = testTool("pk_fails", "read", async () => {
			throw new ToolError("tool.not_found", "nope.txt does not exist.");
		});
		const crashes = testTool("crashes", "read", async () => {
			throw new Error("boom");
		});
		const h = startSession(
			[
				toolStep(
					callEvents(1, "missing", {}),
					callEvents(2, "read_file", {}, "Unexpected end of JSON input"),
					callEvents(3, "read_file", { path: "" }),
					callEvents(4, "pk_fails", { path: "x" }),
					callEvents(5, "crashes", { path: "x" }),
				),
				textStep("sorry"),
			],
			{ tools: [readFileTool, pkFails, crashes] },
		);
		h.session.submit("try things");
		await h.turns();
		const texts = resultTexts(h.events);
		expect(texts[0]).toBe(
			'Unknown tool "missing". Available tools: read_file, pk_fails, crashes.',
		);
		expect(texts[1]).toBe(
			"The arguments could not be used: Unexpected end of JSON input. Call the tool again with a JSON object that matches its input schema.",
		);
		expect(texts[2]).toStartWith("Invalid input for read_file: ");
		expect(texts[3]).toBe("nope.txt does not exist.");
		expect(texts[4]).toBe("crashes failed unexpectedly: boom");
		// Only the two calls whose run was called got a run start.
		expect(h.types().filter((t) => t === "tool_run_start")).toHaveLength(2);
		expect(h.fake.requests()).toHaveLength(2);
		expect(checkConversation(h.session.conversation)).toEqual([]);
	});

	test("error texts are redacted, then cut to 2000 characters with … (AC-4)", async () => {
		const long = testTool("long", "read", async () => {
			throw new ToolError(
				"tool.not_found",
				`key sk-abcdefghijklmnopqrstuvwxyz ${"x".repeat(3000)}`,
			);
		});
		const h = startSession(
			[toolStep(callEvents(1, "long", { path: "a" })), textStep("ok")],
			{ tools: [long] },
		);
		h.session.submit("go");
		await h.turns();
		const [text] = resultTexts(h.events);
		expect(text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
		expect(text).toHaveLength(2001);
		expect(text?.endsWith("…")).toBe(true);
	});

	test("provider retries emit notices, and the final error ends the turn; the next prompt works (AC-7)", async () => {
		const h = startSession(
			[
				{ error: { code: "provider.rate_limited" } },
				{ error: { code: "provider.rate_limited" } },
				{ error: { code: "provider.server" } },
				textStep("back"),
			],
			{ maxRetries: 2 },
		);
		h.session.submit("hi");
		await h.turns();
		const notices = h.events.filter((e) => e.type === "notice");
		expect(notices).toHaveLength(2);
		expect(notices.every((n) => n.code === "provider.retrying")).toBe(true);
		const end = h.events.at(-1);
		expect(end?.type === "turn_end" && end.reason).toBe("error");
		expect(end?.type === "turn_end" && end.error?.code).toBe("provider.server");

		h.session.submit("again");
		await h.turns();
		const last = h.events.at(-1);
		expect(last?.type === "turn_end" && last.reason).toBe("done");
		expect(checkConversation(h.session.conversation)).toEqual([]);
	});

	test("a reply that breaks mid stream is dropped, and its started calls get a result event (AC-2, AC-7)", async () => {
		const h = startSession([
			{
				events: [
					{ type: "text_delta", text: "let me look" },
					{ type: "tool_call_start", callId: callId(1), name: "read_file" },
				],
				thenError: { code: "provider.stream_broken" },
			},
		]);
		h.session.submit("hi");
		await h.turns();
		expect(resultTexts(h.events)).toEqual([REPLY_FAILED_TEXT]);
		expect(h.session.conversation.map((m) => m.role)).toEqual(["user"]);
		const end = h.events.at(-1);
		expect(end?.type === "turn_end" && end.error?.code).toBe(
			"provider.stream_broken",
		);
	});

	test("anything else thrown ends the turn with the fixed agent.internal text (AC-7)", async () => {
		const broken: Provider = {
			id: "fake",
			api: "openai_chat",
			// biome-ignore lint/correctness/useYield: a stream that fails before its first event
			async *stream() {
				throw new Error("kaboom at /secret/path");
			},
		};
		const h = startSession([], { provider: broken });
		h.session.submit("hi");
		await h.turns();
		const end = h.events.at(-1);
		expect(end?.type === "turn_end" && end.error).toEqual({
			code: "agent.internal",
			message: INTERNAL_ERROR_TEXT,
		});
		expect(checkConversation(h.session.conversation)).toEqual([]);
	});

	test("empty replies and cut replies get their notices (AC-8)", async () => {
		const h = startSession([
			{ events: [{ type: "stop", reason: "end_turn" }] },
			{
				events: [
					{ type: "text_delta", text: "partial" },
					{ type: "stop", reason: "max_tokens" },
				],
			},
		]);
		h.session.submit("one");
		await h.turns();
		h.session.submit("two");
		await h.turns();
		const codes = h.events.flatMap((e) =>
			e.type === "notice" ? [e.code] : [],
		);
		expect(codes).toEqual(["agent.empty_reply", "agent.output_cut"]);
		expect(h.session.conversation.map((m) => m.role)).toEqual([
			"user",
			"user",
			"assistant",
		]);
	});

	test("usage events carry the model and the provider's cost (AC-9)", async () => {
		const h = startSession([
			{
				events: [
					{ type: "text_delta", text: "hi" },
					{
						type: "usage",
						usage: {
							inputTokens: 1,
							cacheReadTokens: 0,
							cacheWriteTokens: 0,
							outputTokens: 1,
						},
						providerCostMicroUsd: 42,
					},
					{ type: "stop", reason: "end_turn" },
				],
			},
		]);
		h.session.submit("hi");
		const usage = await h.until("usage");
		expect(usage.model).toEqual({ provider: "fake", model: "fake" });
		expect(usage.cost).toEqual({ source: "provider", microUsd: 42 });
	});
});

describe("control (spec 0005)", () => {
	test("prompts submitted during a turn run in order; empty ones are ignored (AC-5)", async () => {
		const h = startSession([textStep("a"), textStep("b"), textStep("c")]);
		h.session.submit("first");
		h.session.submit("   ");
		h.session.submit("second");
		h.session.submit("third");
		await h.turns(3);
		const prompts = h.session.conversation.flatMap((m) =>
			m.role === "user" && m.content[0]?.type === "text"
				? [m.content[0].text]
				: [],
		);
		expect(prompts).toEqual(["first", "second", "third"]);
	});

	test("submit then interrupt in the same tick makes no model call (AC-6)", async () => {
		const h = startSession([textStep("never")]);
		h.session.submit("hi");
		h.session.interrupt();
		await h.turns();
		expect(h.types()).toEqual(["turn_start", "message", "turn_end"]);
		const end = h.events.at(-1);
		expect(end?.type === "turn_end" && end.reason).toBe("interrupted");
		expect(h.fake.requests()).toHaveLength(0);
	});

	test("interrupt while idle does nothing (AC-6)", () => {
		const h = startSession([]);
		h.session.interrupt();
		expect(h.events).toHaveLength(0);
	});

	test("interrupt during a permission wait clears the queue and ends the turn (AC-6, AC-10)", async () => {
		const writer = testTool("write_thing", "write", async () =>
			textOutcome("written", false),
		);
		const h = startSession(
			[toolStep(callEvents(1, "write_thing", { path: "a" }))],
			{ tools: [writer] },
		);
		h.session.submit("write it");
		h.session.submit("queued one");
		h.session.submit("queued two");
		const request = await h.until("permission_request");
		h.session.interrupt();
		await h.turns();
		h.session.respond(request.requestId, { decision: "allow_once" });

		const notice = h.events.find((e) => e.type === "notice");
		expect(notice?.type === "notice" && notice.text).toBe(
			"Dropped 2 queued message(s).",
		);
		expect(resultTexts(h.events)).toEqual([INTERRUPTED_BEFORE_TEXT]);
		expect(h.types()).not.toContain("tool_run_start");
		const end = h.events.at(-1);
		expect(end?.type === "turn_end" && end.reason).toBe("interrupted");
		expect(checkConversation(h.session.conversation)).toEqual([]);
		expect(h.fake.requests()).toHaveLength(1);
	});

	test("a tool outcome that lands after the abort is thrown away, stamps included (AC-6, AC-14)", async () => {
		let release: () => void = () => {};
		const slow = testTool("slow", "read", async () => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return {
				...textOutcome("late", false),
				stamps: [
					{
						path: `${ROOT}/late.txt`,
						mtimeMs: 1,
						size: 1,
						lines: { from: 1, to: 1, total: 1 },
					},
				],
			};
		});
		const h = startSession(
			[
				toolStep(
					callEvents(1, "slow", { path: "a" }),
					callEvents(2, "slow", { path: "b" }),
				),
			],
			{ tools: [slow] },
		);
		h.session.submit("go");
		await h.until("tool_run_start");
		h.session.interrupt();
		release();
		await h.turns();
		expect(resultTexts(h.events)).toEqual([
			INTERRUPTED_DURING_TEXT,
			INTERRUPTED_BEFORE_TEXT,
		]);
		expect(h.session.ledger.size).toBe(0);
		expect(checkConversation(h.session.conversation)).toEqual([]);
	});

	test("an interrupt mid stream keeps the partial reply as aborted (AC-6)", async () => {
		const h = startSession([
			{
				events: [
					{ type: "text_delta", text: "part one" },
					{ type: "text_delta", text: " part two" },
					{ type: "stop", reason: "end_turn" },
				],
				eventDelayMs: 5,
			},
		]);
		h.session.submit("hi");
		await h.until("text_delta");
		h.session.interrupt();
		await h.turns();
		const reply = h.session.conversation.at(-1);
		expect(reply?.role === "assistant" && reply.stopReason).toBe("aborted");
		const end = h.events.at(-1);
		expect(end?.type === "turn_end" && end.reason).toBe("interrupted");
	});

	test("close ends the running turn, then the events", async () => {
		const writer = testTool("write_thing", "write", async () =>
			textOutcome("written", false),
		);
		const h = startSession(
			[toolStep(callEvents(1, "write_thing", { path: "a" }))],
			{ tools: [writer] },
		);
		h.session.submit("write it");
		h.session.submit("queued");
		await h.until("permission_request");
		await h.session.close();
		await h.turns(5); // reads to the end
		const end = h.events.at(-1);
		expect(end?.type === "turn_end" && end.reason).toBe("interrupted");
		expect(h.types()).not.toContain("notice");
		h.session.submit("after close");
		expect(h.events.filter((e) => e.type === "turn_start")).toHaveLength(1);
	});

	test("a second reader of events is a wiring bug", () => {
		const h = startSession([]);
		expect(() => h.session.events[Symbol.asyncIterator]()).toThrow(
			"already has a reader",
		);
	});
});

describe("the permission seam (spec 0005 AC-10)", () => {
	const writer = () =>
		testTool("write_thing", "write", async () => textOutcome("written", false));

	test("allow_session lets the next call run without asking", async () => {
		const h = startSession(
			[
				toolStep(callEvents(1, "write_thing", { path: "a" })),
				toolStep(callEvents(2, "write_thing", { path: "b" })),
				textStep("done"),
			],
			{ tools: [writer()] },
		);
		h.session.submit("write twice");
		const request = await h.until("permission_request");
		expect(request.kind).toBe("write");
		expect(request.call.id).toBe(callId(1));
		h.session.respond(request.requestId, { decision: "allow_session" });
		await h.turns();
		expect(h.types().filter((t) => t === "permission_request")).toHaveLength(1);
		expect(resultTexts(h.events)).toEqual(["written", "written"]);
	});

	test("deny with a note gives the denied text, and stale answers are ignored", async () => {
		const h = startSession(
			[toolStep(callEvents(1, "write_thing", { path: "a" })), textStep("ok")],
			{ tools: [writer()] },
		);
		h.session.submit("write");
		const request = await h.until("permission_request");
		h.session.respond(request.requestId, {
			decision: "deny",
			note: "use the fixture",
		});
		h.session.respond(request.requestId, { decision: "allow_once" });
		await h.turns();
		expect(resultTexts(h.events)).toEqual([
			`${DENIED_TEXT} (note: use the fixture)`,
		]);
		expect(h.types()).not.toContain("tool_run_start");
	});

	test("a write tool with invalid input never prompts (AC-4)", async () => {
		const h = startSession(
			[toolStep(callEvents(1, "write_thing", { path: 3 })), textStep("ok")],
			{ tools: [writer()] },
		);
		h.session.submit("write");
		await h.turns();
		expect(h.types()).not.toContain("permission_request");
		expect(resultTexts(h.events)[0]).toStartWith(
			"Invalid input for write_thing: path:",
		);
	});
});

describe("the read ledger (spec 0005 AC-14)", () => {
	test("the last read wins, an empty file stamps zeros, and a failed read changes nothing", async () => {
		const h = startSession(
			[
				toolStep(callEvents(1, "read_file", { path: "a.txt" })),
				toolStep(callEvents(2, "read_file", { path: "a.txt", offset: 2 })),
				toolStep(callEvents(3, "read_file", { path: "empty.txt" })),
				toolStep(callEvents(4, "read_file", { path: "missing.txt" })),
				textStep("done"),
			],
			{ files: { "a.txt": "1\n2\n3\n", "empty.txt": "" } },
		);
		h.session.submit("read");
		await h.turns();
		expect(h.session.ledger.get(`${ROOT}/a.txt`)?.lines).toEqual({
			from: 2,
			to: 3,
			total: 3,
		});
		expect(h.session.ledger.get(`${ROOT}/empty.txt`)?.lines).toEqual({
			from: 0,
			to: 0,
			total: 0,
		});
		expect(h.session.ledger.size).toBe(2);
		expect(resultTexts(h.events).at(-1)).toBe("missing.txt does not exist.");
	});

	test("foldStamps lets the last read win and never changes the ledger it was given", () => {
		const stamp = (to: number): FileStamp => ({
			path: "/p/a.txt",
			mtimeMs: to,
			size: 1,
			lines: { from: 1, to, total: 9 },
		});
		const before = new Map([["/p/a.txt", stamp(1)]]);
		const after = foldStamps(before, [stamp(2), stamp(3)]);
		expect(after.get("/p/a.txt")?.lines.to).toBe(3);
		expect(before.get("/p/a.txt")?.lines.to).toBe(1);
		expect(foldStamps(before, [])).toEqual(before);
	});
});

describe("more of the event contract (spec 0005)", () => {
	test("seq keeps rising across turns and the conversation is valid at every turn_end (AC-2)", async () => {
		const h = startSession([readHello, textStep("one"), textStep("two")], {
			files: { "hello.txt": "hi" },
		});
		h.session.submit("first");
		await h.turns();
		expect(checkConversation(h.session.conversation)).toEqual([]);
		h.session.submit("second");
		await h.turns();
		expect(checkConversation(h.session.conversation)).toEqual([]);
		expect(h.events[0]?.seq).toBe(0);
		expect(h.events.map((e) => e.seq)).toEqual(h.events.map((_, i) => i));
		expect(h.events.filter((e) => e.type === "turn_end")).toHaveLength(2);
	});

	test("a retry inside withRetry is not a model call toward the limit (AC-3)", async () => {
		const h = startSession(
			[
				{ error: { code: "provider.rate_limited" } },
				readHello,
				textStep("answer"),
			],
			{ files: { "hello.txt": "hi" }, maxTurns: 2 },
		);
		h.session.submit("go");
		await h.turns();
		const end = h.events.at(-1);
		expect(end?.type === "turn_end" && end.reason).toBe("done");
	});

	test("a failure on a later model call keeps the earlier calls' messages (AC-7)", async () => {
		const h = startSession(
			[readHello, { error: { code: "provider.server" } }],
			{ files: { "hello.txt": "hi" }, maxRetries: 0 },
		);
		h.session.submit("go");
		await h.turns();
		expect(h.session.conversation.map((m) => m.role)).toEqual([
			"user",
			"assistant",
			"user",
		]);
		expect(checkConversation(h.session.conversation)).toEqual([]);
	});

	test("a refusal with text ends done with no notice (AC-8)", async () => {
		const h = startSession([
			{
				events: [
					{ type: "text_delta", text: "I can't help with that." },
					{ type: "stop", reason: "refusal" },
				],
			},
		]);
		h.session.submit("hi");
		await h.turns();
		const end = h.events.at(-1);
		expect(end?.type === "turn_end" && end.reason).toBe("done");
		expect(h.types()).not.toContain("notice");
	});

	test("max_tokens with text only ends done after the output cut notice (AC-8)", async () => {
		const h = startSession([
			{
				events: [
					{ type: "text_delta", text: "half" },
					{ type: "stop", reason: "max_tokens" },
				],
			},
		]);
		h.session.submit("hi");
		await h.turns();
		const end = h.events.at(-1);
		expect(end?.type === "turn_end" && end.reason).toBe("done");
	});

	test("end_turn with a call still runs the call, then asks the model again (AC-8)", async () => {
		const h = startSession(
			[
				{
					events: [
						...callEvents(1, "read_file", { path: "hello.txt" }),
						{ type: "stop", reason: "end_turn" },
					],
				},
				textStep("ok"),
			],
			{ files: { "hello.txt": "hi" } },
		);
		h.session.submit("go");
		await h.turns();
		expect(resultTexts(h.events)).toEqual(["     1\thi"]);
		expect(h.fake.requests()).toHaveLength(2);
	});

	test("a usage with no provider cost has an unknown cost (AC-9)", async () => {
		const h = startSession([textStep("hi")]);
		h.session.submit("hi");
		const usage = await h.until("usage");
		expect(usage.cost).toEqual({ source: "unknown" });
	});

	test("an interrupt before any reply content drops the empty aborted reply (AC-6)", async () => {
		// A stream that sends nothing until the turn's signal aborts, then stops "aborted".
		const silent: Provider = {
			id: "fake",
			api: "openai_chat",
			async *stream(_request, { signal }) {
				await new Promise<void>((resolve) => {
					signal.addEventListener("abort", () => resolve(), { once: true });
				});
				yield { type: "stop", reason: "aborted" };
			},
		};
		const h = startSession([], { provider: silent });
		h.session.submit("hi");
		await h.until("message"); // your prompt
		await new Promise((resolve) => setTimeout(resolve, 1));
		h.session.interrupt();
		await h.turns();
		expect(h.session.conversation.map((m) => m.role)).toEqual(["user"]);
		expect(checkConversation(h.session.conversation)).toEqual([]);
		const end = h.events.at(-1);
		expect(end?.type === "turn_end" && end.reason).toBe("interrupted");
	});

	test("close resolves even when nobody reads the events, and later submits do nothing (AC-5, AC-6)", async () => {
		const h = startSession([textStep("a"), textStep("b")]);
		h.session.submit("first");
		h.session.submit("queued");
		const closed = await Promise.race([
			h.session.close().then(() => "closed"),
			new Promise((resolve) => setTimeout(() => resolve("hung"), 500)),
		]);
		expect(closed).toBe("closed");
		await h.session.close(); // safe to call twice
		h.session.submit("after");
		await h.turns(10);
		expect(h.events.filter((e) => e.type === "turn_start")).toHaveLength(1);
		expect(h.fake.requests().length).toBeLessThanOrEqual(1);
	});

	test("two tools with one name is a wiring bug, thrown at once", () => {
		let thrown: unknown;
		try {
			startSession([], { tools: [readFileTool, readFileTool] });
		} catch (error) {
			thrown = error;
		}
		expect(isPkError(thrown) && thrown.code).toBe("agent.duplicate_tool");
	});
});
