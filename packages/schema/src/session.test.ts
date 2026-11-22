import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	AT,
	assistant,
	call,
	idMaker,
	MODEL,
	msgId,
	PNG,
	result,
	text,
	user,
} from "./fixtures.test-support.ts";
import {
	AgentEvent,
	AgentId,
	checkConversation,
	foldSessionRecords,
	IMAGE_UNAVAILABLE_TEXT,
	MAIN_AGENT_ID,
	type Message,
	SessionHeader,
	type SessionRecord,
	sessionBlobHashes,
	sessionRecordFromEvent,
	TurnId,
	toStoredMessage,
} from "./index.ts";

const stored = (message: Message) =>
	toStoredMessage(message, {
		sha256: (b) => createHash("sha256").update(b).digest("hex"),
	}).message;

const header = SessionHeader.parse({
	type: "header",
	v: 1,
	sessionId: "ses_01JDX8Z3QK5V7W9Y0A2B4C6D00",
	createdAt: AT,
	cwd: "/work/app",
	projectRoot: "/work/app",
	pkVersion: "0.0.0",
	model: MODEL,
});
const other = AgentId.parse("agent_01JDX8Z3QK5V7W9Y0A2B4C6D77");
const record = (message: Message, agentId = MAIN_AGENT_ID): SessionRecord => ({
	type: "message",
	at: AT,
	agentId,
	message: stored(message),
});
const fold = (
	records: readonly SessionRecord[],
	blobs = new Map<string, Uint8Array>(),
) => foldSessionRecords(header, records, { newId: idMaker(), blobs });

describe("sessionRecordFromEvent (AC-8)", () => {
	const envelope = { seq: 3, at: AT, agentId: MAIN_AGENT_ID };
	const turnId = TurnId.parse("turn_01JDX8Z3QK5V7W9Y0A2B4C6D01");

	test("maps message, usage, todo_update, model_change and turn_end", () => {
		const message = user(1, [text("hi")]);
		const events = [
			{ ...envelope, type: "message", message },
			{
				...envelope,
				type: "usage",
				model: MODEL,
				usage: {},
				cost: { source: "unknown" },
			},
			{
				...envelope,
				type: "todo_update",
				todos: [{ content: "x", status: "pending" }],
			},
			{ ...envelope, type: "model_change", role: "summarize", model: MODEL },
			{
				...envelope,
				type: "turn_end",
				turnId,
				reason: "error",
				error: { code: "provider.down", message: "down" },
			},
		].map((e) => AgentEvent.parse(e));
		expect(
			events.map((e) => sessionRecordFromEvent(e, stored(message))?.type),
		).toEqual(["message", "usage", "todo", "model_change", "turn_end"]);
		expect(
			sessionRecordFromEvent(events[0] as AgentEvent, stored(message)),
		).toEqual(record(message));
	});

	test("returns undefined for every other event", () => {
		const event = AgentEvent.parse({ ...envelope, type: "turn_start", turnId });
		expect(sessionRecordFromEvent(event)).toBeUndefined();
	});
});

describe("foldSessionRecords (AC-8)", () => {
	test("rebuilds the conversation, models, todos and last turn end", () => {
		const messages = [
			user(1, [text("hi")]),
			assistant(2, [text("hello")], "end_turn"),
		];
		const turnEnd: SessionRecord = {
			type: "turn_end",
			at: AT,
			agentId: MAIN_AGENT_ID,
			turnId: TurnId.parse("turn_01JDX8Z3QK5V7W9Y0A2B4C6D01"),
			reason: "done",
		};
		const state = fold([
			...messages.map((m) => record(m)),
			{
				type: "model_change",
				at: AT,
				role: "main",
				model: { provider: "openai", model: "gpt-x" },
			},
			{ type: "todo", at: AT, todos: [{ content: "a", status: "done" }] },
			turnEnd,
		]);
		expect(state.transcript).toEqual(messages);
		expect(state.context).toEqual(messages);
		expect(state.models).toEqual({
			main: { provider: "openai", model: "gpt-x" },
		});
		expect(state.todos).toEqual([{ content: "a", status: "done" }]);
		expect(state.lastTurnEnd).toEqual(turnEnd);
		expect(state).toMatchObject({ repaired: 0, skipped: 0, missingBlobs: [] });
	});

	test("models.main starts from the header", () => {
		expect(fold([]).models).toEqual({ main: MODEL });
	});

	test("uses only the main agent's records, and skips repeated message IDs", () => {
		const hi = user(1, [text("hi")]);
		const state = fold([
			record(hi),
			record(hi),
			record(user(2, [text("sub")]), other),
		]);
		expect(state.transcript).toEqual([hi]);
		expect(state.skipped).toBe(1);
	});

	test("a compaction replaces everything through replacesThrough with its summary", () => {
		const m = [
			user(1, [text("a")]),
			assistant(2, [text("b")], "end_turn"),
			user(3, [text("c")]),
		];
		const summary = user(4, [text("Summary of a and b.")]);
		const state = fold([
			...m.map((x) => record(x)),
			record(summary),
			{
				type: "compaction",
				at: AT,
				summaryMessageId: summary.id,
				replacesThrough: msgId(2),
			},
			{
				type: "compaction",
				at: AT,
				summaryMessageId: msgId(55),
				replacesThrough: msgId(2),
			},
		]);
		expect(state.context.map((x) => x.id)).toEqual([summary.id, msgId(3)]);
		expect(state.transcript).toHaveLength(4);
		expect(state.skipped).toBe(1); // the compaction naming an unknown message
	});

	test("the context is always repaired, closing a pending tail", () => {
		const state = fold([
			record(user(1, [text("hi")])),
			record(assistant(2, [call(3)])),
			record(user(9, [result(77)])),
		]);
		expect(checkConversation(state.context)).toEqual([]);
		expect(state.repaired).toBe(2); // one result added, one dropped
	});

	test("restores images from blobs, and lists the missing ones", () => {
		const hash = "a".repeat(64);
		const stored = {
			id: msgId(1),
			role: "user",
			at: AT,
			content: [
				{
					type: "image",
					mediaType: "image/png",
					blob: { sha256: hash, bytes: 3 },
				},
			],
		} as const;
		const records: SessionRecord[] = [
			{ type: "message", at: AT, agentId: MAIN_AGENT_ID, message: stored },
		];
		expect(sessionBlobHashes(records)).toEqual([hash]);
		const missing = fold(records);
		expect(missing.missingBlobs).toEqual([hash]);
		expect(missing.transcript[0]?.content[0]).toEqual({
			type: "text",
			text: IMAGE_UNAVAILABLE_TEXT,
		});
		const bytes = Uint8Array.from(Buffer.from(PNG, "base64"));
		const found = fold(records, new Map([[hash, bytes]]));
		expect(found.transcript[0]?.content[0]).toEqual({
			type: "image",
			mediaType: "image/png",
			data: PNG,
		});
	});
});
