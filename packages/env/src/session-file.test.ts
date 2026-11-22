import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CostRecord,
	checkConversation,
	foldSessionRecords,
	HistoryEntry,
	type MessageId,
	MessageId as MessageIdSchema,
} from "@pk/schema";
import { isPkError } from "./errors.ts";
import { readJsonlRecords } from "./jsonl.ts";
import { readSessionFile } from "./session-file.ts";

const fixture = readFileSync(
	join(import.meta.dir, "fixtures", "session-v1.jsonl"),
	"utf8",
);
const newId = (): MessageId =>
	MessageIdSchema.parse("msg_01JDX8Z3QK5V7W9Y0A2B4C6D99");
const codeOf = (run: () => unknown): string | false => {
	try {
		run();
		return false;
	} catch (error) {
		return isPkError(error) && error.code;
	}
};
const header = fixture.split("\n")[0] ?? "";

describe("readJsonlRecords (AC-8, AC-10)", () => {
	test("skips blank, broken, invalid and unknown lines, and counts all but the blank ones", () => {
		const at = "2026-11-22T10:15:30.123Z";
		const text = [
			JSON.stringify({ v: 1, at, projectRoot: "/w", text: "hi" }),
			"",
			"   ",
			"{not json",
			JSON.stringify({ v: 1, at, projectRoot: "/w" }),
			JSON.stringify({
				v: 1,
				at,
				projectRoot: "/w",
				text: "again",
				extra: "stripped",
			}),
			"null",
		].join("\n");
		const read = readJsonlRecords(text, HistoryEntry);
		expect(read.skipped).toBe(3);
		expect(read.records).toEqual([
			{ v: 1, at, projectRoot: "/w", text: "hi" },
			{ v: 1, at, projectRoot: "/w", text: "again" },
		]);
	});

	test("reads cost records, which carry v: 1", () => {
		const record = {
			v: 1,
			at: "2026-11-22T10:15:30.123Z",
			sessionId: "ses_01JDX8Z3QK5V7W9Y0A2B4C6D00",
			agentId: "main",
			model: { provider: "openrouter", model: "x" },
			usage: {
				inputTokens: 3,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				outputTokens: 2,
			},
			cost: { source: "unknown" },
		};
		const read = readJsonlRecords(
			`${JSON.stringify(record)}\n${JSON.stringify({ ...record, v: 2 })}\n`,
			CostRecord,
		);
		expect(read).toEqual({ records: [record] as never, skipped: 1 });
	});
});

describe("readSessionFile (AC-8)", () => {
	test("the committed v: 1 fixture still parses and folds", () => {
		const read = readSessionFile(fixture);
		expect(read).toMatchObject({ fileVersion: 1, skipped: 0 });
		expect(read.records.map((r) => r.type)).toEqual([
			"message",
			"message",
			"usage",
			"message",
			"todo",
			"model_change",
			"message",
			"turn_end",
		]);
		const state = foldSessionRecords(read.header, read.records, {
			newId,
			blobs: new Map(),
		});
		expect(state.transcript).toHaveLength(4);
		expect(state.models).toEqual({
			main: { provider: "openrouter", model: "anthropic/claude-x" },
			summarize: { provider: "openai", model: "gpt-x-mini" },
		});
		expect(state.todos).toEqual([
			{ content: "Explain a.ts", status: "in_progress" },
		]);
		expect(state.lastTurnEnd?.reason).toBe("done");
		expect(state.missingBlobs).toEqual(["a".repeat(64)]);
		expect(checkConversation(state.context)).toEqual([]);
	});

	test("a damaged file resumes with the damage skipped and the conversation repaired", () => {
		const lines = fixture.trimEnd().split("\n");
		const damaged = [
			lines[0],
			lines[1],
			"{this is not json",
			JSON.stringify({ type: "future_record", at: "2026-11-22T10:15:30.123Z" }),
			lines[2], // the assistant tool call; its result line (lines[4]) was lost
			'{"type":"message","at":"2026-11-22T10:1', // torn last line
		].join("\n");
		const read = readSessionFile(damaged);
		expect(read.skipped).toBe(3);
		const state = foldSessionRecords(read.header, read.records, {
			newId,
			blobs: new Map(),
		});
		expect(checkConversation(state.context)).toEqual([]);
		expect(state.repaired).toBe(1);
	});

	test("a second header line is skipped and counted", () => {
		expect(readSessionFile(`${header}\n${header}\n`).skipped).toBe(1);
	});

	test("no header, or a broken one, throws session.no_header", () => {
		expect(codeOf(() => readSessionFile(""))).toBe("session.no_header");
		expect(codeOf(() => readSessionFile('{"type":"message"}'))).toBe(
			"session.no_header",
		);
		expect(codeOf(() => readSessionFile('{"type":"header","v":"1"}'))).toBe(
			"session.no_header",
		);
		expect(codeOf(() => readSessionFile('{"type":"header","v":1}'))).toBe(
			"session.no_header",
		);
	});

	test("a newer file throws session.too_new, not session.no_header", () => {
		expect(
			codeOf(() => readSessionFile('{"type":"header","v":2,"anything":true}')),
		).toBe("session.too_new");
	});

	test("an older file runs every raw record, header included, through the migration chain", () => {
		const v0 = fixture
			.replace('"v":1', '"v":0')
			.replaceAll('"agentId":"main"', '"agent":"main"');
		const seen: unknown[] = [];
		const read = readSessionFile(v0, {
			version: 1,
			migrations: {
				0: (raw, hdr) => {
					seen.push(hdr);
					if (typeof raw !== "object" || raw === null) return raw;
					const { agent, ...rest } = raw as Record<string, unknown>;
					return Reflect.get(raw, "type") === "header"
						? { ...rest, v: 1 }
						: { ...rest, agentId: agent };
				},
			},
		});
		expect(read.fileVersion).toBe(0);
		expect(read.header.v).toBe(1);
		expect(read.skipped).toBe(0);
		expect(read.records).toHaveLength(8);
		expect(seen.every((h) => Reflect.get(h as object, "v") === 0)).toBe(true);
	});

	test("an older file with no migration throws session.unsupported_version", () => {
		expect(
			codeOf(() => readSessionFile(fixture.replace('"v":1', '"v":0'))),
		).toBe("session.unsupported_version");
	});
});
