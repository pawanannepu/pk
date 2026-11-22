/**
 * The tracer thread of spec 0002 ("Critical test scenarios", happy path): IDs, messages, events,
 * session records, a private JSONL write, a read back, and a fold. Proves the chain before any loop exists.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AgentEvent,
	type AssistantMessage,
	foldSessionRecords,
	MAIN_AGENT_ID,
	type Message,
	SessionHeader,
	sessionRecordFromEvent,
	toStoredMessage,
	type UserMessage,
} from "@pk/schema";
import { appendJsonl, PRIVATE_FILE } from "./files.ts";
import { createIdFactory } from "./ids.ts";
import { paths } from "./paths.ts";
import { projectKey, sha256Hex } from "./project.ts";
import { readSessionFile } from "./session-file.ts";

describe("tracer thread (AC-1, AC-8, AC-14, AC-16)", () => {
	test("messages go out as events, land in a private file, and fold back unchanged", async () => {
		let clock = Date.UTC(2026, 10, 22, 10, 15, 30, 123);
		const now = () => clock++;
		const at = () => new Date(now()).toISOString();
		const newId = createIdFactory({
			now,
			randomBytes: (n) => new Uint8Array(n).fill(3),
		});
		const model = { provider: "openrouter", model: "anthropic/claude-x" };

		const sessionId = newId("ses");
		const callId = newId("call");
		const question: UserMessage = {
			id: newId("msg"),
			role: "user",
			at: at(),
			content: [{ type: "text", text: "What does a.ts export?" }],
		};
		const reply: AssistantMessage = {
			id: newId("msg"),
			role: "assistant",
			at: at(),
			model,
			stopReason: "tool_use",
			content: [
				{
					type: "tool_call",
					id: callId,
					name: "read_file",
					input: { path: "a.ts" },
				},
			],
		};
		const results: UserMessage = {
			id: newId("msg"),
			role: "user",
			at: at(),
			content: [
				{
					type: "tool_result",
					callId,
					isError: false,
					content: [{ type: "text", text: "export const a = 1;" }],
				},
			],
		};
		const messages: Message[] = [question, reply, results];

		const state = paths({
			env: { PK_HOME: mkdtempSync(join(tmpdir(), "pk-tracer-")) },
		}).state;
		const file = join(
			state,
			"sessions",
			projectKey("/work/app"),
			`${sessionId}.jsonl`,
		);
		const header = SessionHeader.parse({
			type: "header",
			v: 1,
			sessionId,
			createdAt: at(),
			cwd: "/work/app",
			projectRoot: "/work/app",
			pkVersion: "0.0.0",
			model,
		});
		await appendJsonl(file, header, PRIVATE_FILE);
		for (const [seq, message] of messages.entries()) {
			const event = AgentEvent.parse({
				seq,
				at: at(),
				agentId: MAIN_AGENT_ID,
				type: "message",
				message,
			});
			const stored = toStoredMessage(message, { sha256: sha256Hex });
			await appendJsonl(
				file,
				sessionRecordFromEvent(event, stored.message),
				PRIVATE_FILE,
			);
		}

		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(statSync(join(state, "sessions")).mode & 0o777).toBe(0o700);

		const read = readSessionFile(readFileSync(file, "utf8"));
		expect(read.header).toEqual(header);
		expect(read.skipped).toBe(0);
		const folded = foldSessionRecords(read.header, read.records, {
			newId,
			blobs: new Map(),
		});
		expect(folded.context).toEqual(messages);
		expect(folded.transcript).toEqual(messages);
		expect(folded.repaired).toBe(0);
	});
});
