import { describe, expect, test } from "bun:test";
import {
	assistant,
	call,
	EVERY_BLOCK,
	idMaker,
	result,
	text,
	user,
} from "./fixtures.test-support.ts";
import {
	AssistantMessage,
	checkConversation,
	ImageBlock,
	Message,
	REPAIRED_RESULT_TEXT,
	repairConversation,
	UserMessage,
} from "./index.ts";

describe("conversation shapes (AC-1)", () => {
	test("a conversation using every block type parses", () => {
		for (const message of EVERY_BLOCK) {
			expect(Message.parse(JSON.parse(JSON.stringify(message)))).toEqual(
				message,
			);
		}
		expect(checkConversation(EVERY_BLOCK)).toEqual([]);
	});

	test("an assistant message may be empty only when aborted", () => {
		expect(
			AssistantMessage.safeParse(assistant(1, [], "aborted")).success,
		).toBe(true);
		expect(
			AssistantMessage.safeParse(assistant(1, [], "end_turn")).success,
		).toBe(false);
	});

	test("a user message needs at least one block, and holds no tool calls", () => {
		expect(UserMessage.safeParse(user(1, [])).success).toBe(false);
		expect(
			Message.safeParse({ ...user(1, [text("x")]), content: [call(1)] })
				.success,
		).toBe(false);
	});

	test("image data must be base64", () => {
		expect(
			ImageBlock.safeParse({
				type: "image",
				mediaType: "image/png",
				data: "not base64!",
			}).success,
		).toBe(false);
	});

	test("inputError is at most 2,000 characters", () => {
		const long = { ...call(1), input: {}, inputError: "x".repeat(2001) };
		expect(AssistantMessage.safeParse(assistant(1, [long])).success).toBe(
			false,
		);
	});
});

describe("checkConversation (AC-3)", () => {
	test("a pending last assistant message with calls is valid", () => {
		expect(
			checkConversation([user(1, [text("hi")]), assistant(2, [call(3)])]),
		).toEqual([]);
	});

	test("two messages with the same role in a row are valid", () => {
		expect(
			checkConversation([user(1, [text("a")]), user(2, [text("b")])]),
		).toEqual([]);
	});

	test("reports each kind of problem", () => {
		const messages = [
			assistant(1, [call(10), call(11)]),
			user(2, [result(10), result(10), result(12)]),
			assistant(3, [call(10)], "tool_use"),
			user(4, [result(10)]),
		];
		const issues = checkConversation(messages).map((i) => [
			i.code,
			i.messageIndex,
		]);
		expect(issues).toEqual([
			["missing_result", 0],
			["duplicate_result", 1],
			["orphan_result", 1],
			["duplicate_call_id", 2],
		]);
	});

	test("a result is an orphan when its call is not directly before it", () => {
		const messages = [
			assistant(1, [call(10)]),
			user(2, [text("wait")]),
			user(3, [result(10)]),
		];
		expect(checkConversation(messages).map((i) => i.code)).toEqual([
			"missing_result",
			"orphan_result",
		]);
	});
});

describe("repairConversation (AC-3)", () => {
	test("leaves a valid conversation alone", () => {
		const out = repairConversation(EVERY_BLOCK, {
			newId: idMaker(),
			closePendingTail: true,
		});
		expect(out).toEqual({ messages: EVERY_BLOCK, changes: 0 });
	});

	test("adds a missing result into the next user message, after its results", () => {
		const messages = [
			assistant(1, [call(10), call(11)]),
			user(2, [result(10), text("and also")]),
		];
		const out = repairConversation(messages, {
			newId: idMaker(),
			closePendingTail: false,
		});
		expect(out.changes).toBe(1);
		expect(out.messages[1]?.content.map((b) => b.type)).toEqual([
			"tool_result",
			"tool_result",
			"text",
		]);
		expect(out.messages[1]?.content[1]).toEqual({
			type: "tool_result",
			callId: call(11).id,
			isError: true,
			content: [{ type: "text", text: REPAIRED_RESULT_TEXT }],
		});
		expect(checkConversation(out.messages)).toEqual([]);
	});

	test("inserts a new user message when the next message is an assistant", () => {
		const first = assistant(1, [call(10)]);
		const messages = [first, assistant(2, [text("done")], "end_turn")];
		const out = repairConversation(messages, {
			newId: idMaker(),
			closePendingTail: false,
		});
		expect(out.messages).toHaveLength(3);
		expect(out.messages[1]).toMatchObject({
			role: "user",
			at: first.at,
			id: idMaker()("msg"),
		});
		expect(checkConversation(out.messages)).toEqual([]);
	});

	test("fills a pending tail only when asked", () => {
		const messages = [user(1, [text("hi")]), assistant(2, [call(10)])];
		expect(
			repairConversation(messages, {
				newId: idMaker(),
				closePendingTail: false,
			}).changes,
		).toBe(0);
		const closed = repairConversation(messages, {
			newId: idMaker(),
			closePendingTail: true,
		});
		expect(closed.changes).toBe(1);
		expect(closed.messages).toHaveLength(3);
	});

	test("drops orphan and duplicate results, and removes a user message left empty", () => {
		const messages = [
			user(1, [text("hi")]),
			user(2, [result(99)]),
			assistant(3, [call(10)]),
			user(4, [result(10), result(10)]),
		];
		const out = repairConversation(messages, {
			newId: idMaker(),
			closePendingTail: false,
		});
		expect(out.changes).toBe(2);
		expect(out.messages.map((m) => m.id)).toEqual([
			user(1, [text("")]).id,
			assistant(3, []).id,
			user(4, [text("")]).id,
		]);
		expect(checkConversation(out.messages)).toEqual([]);
	});

	test("drops a later call with a reused CallId, and an assistant message left empty", () => {
		const messages = [
			assistant(1, [call(10)]),
			user(2, [result(10)]),
			assistant(3, [call(10)]),
			user(4, [result(10)]),
		];
		const out = repairConversation(messages, {
			newId: idMaker(),
			closePendingTail: false,
		});
		expect(checkConversation(out.messages)).toEqual([]);
		expect(out.messages.map((m) => m.role)).toEqual(["assistant", "user"]);
		expect(out.changes).toBe(2); // the duplicate call, then its now orphan result
	});

	test("never mutates its input", () => {
		const messages = [assistant(1, [call(10)]), user(2, [text("x")])];
		const before = JSON.stringify(messages);
		repairConversation(messages, { newId: idMaker(), closePendingTail: true });
		expect(JSON.stringify(messages)).toBe(before);
	});
});
