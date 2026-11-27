import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@pk/agent";
import { isPkError, silentLogger } from "@pk/env";
import { type AgentEvent, Settings } from "@pk/schema";
import { closeWithin, prepareSession } from "./session-setup.ts";

const CALL = "call_01JDX8Z3QK5V7W9Y0A2B4C6D01";

/** A fake script step that calls read_file on `path`. */
const readStep = (path: string) => ({
	events: [
		{ type: "tool_call_start", callId: CALL, name: "read_file" },
		{ type: "tool_call_end", callId: CALL, input: { path } },
		{ type: "stop", reason: "tool_use" },
	],
});
const answerStep = {
	events: [
		{ type: "text_delta", text: "It says hello." },
		{ type: "stop", reason: "end_turn" },
	],
};

let base = "";
let root = "";

beforeAll(() => {
	base = mkdtempSync(join(tmpdir(), "pk-session-setup-"));
	root = realpathSync(base);
	writeFileSync(join(root, "hello.txt"), "hello\n");
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

function scriptFile(name: string, steps: readonly unknown[]): string {
	const path = join(root, name);
	writeFileSync(path, JSON.stringify({ v: 1, steps }));
	return path;
}

const input = (
	settings: Settings,
	env: Readonly<Record<string, string>> = {},
) => ({
	settings,
	projectRoot: root,
	getEnv: (name: string) => env[name],
	userSettingsPath: "/home/you/.config/pk/settings.json",
	logger: silentLogger,
});

/** Reads events until the first `turn_end`. */
async function oneTurn(session: AgentSession): Promise<AgentEvent[]> {
	const events: AgentEvent[] = [];
	for await (const event of session.events) {
		events.push(event);
		if (event.type === "turn_end") break;
	}
	return events;
}

describe("prepareSession (spec 0005 AC-1, AC-16)", () => {
	test("a fake script drives a real read_file on the real disk, then the answer", async () => {
		const path = scriptFile("ok.json", [readStep("hello.txt"), answerStep]);
		const { session, model } = await prepareSession(
			input(Settings.parse({}), { PK_FAKE_SCRIPT: path }),
		);
		expect(model).toEqual({ provider: "fake", model: "fake" });
		session.submit("what is in hello.txt?");
		const events = await oneTurn(session);
		const result = events.find((e) => e.type === "tool_result");
		const [block] = result?.type === "tool_result" ? result.result.content : [];
		expect(block?.type === "text" && block.text).toBe("     1\thello");
		const end = events.at(-1);
		expect(end?.type === "turn_end" && end.reason).toBe("done");
		expect(session.ledger.has(join(root, "hello.txt"))).toBe(true);
		await closeWithin(session);
	});

	test("limits.maxTurns from settings stops the loop (value sourcing: maxTurns)", async () => {
		const path = scriptFile("loop.json", [
			readStep("hello.txt"),
			readStep("hello.txt"),
			answerStep,
		]);
		const { session } = await prepareSession(
			input(Settings.parse({ limits: { maxTurns: 1 } }), {
				PK_FAKE_SCRIPT: path,
			}),
		);
		session.submit("loop");
		const end = (await oneTurn(session)).at(-1);
		expect(end?.type === "turn_end" && end.reason).toBe("turn_limit");
		await closeWithin(session);
	});

	test("an unknown provider fails before any session exists, naming the settings file", async () => {
		const error = await prepareSession(
			input(Settings.parse({ model: { main: "nope/some-model" } })),
		).catch((e: unknown) => e);
		expect(isPkError(error) && error.code).toBe("provider.unknown_provider");
		expect(error instanceof Error && error.message).toContain(
			"/home/you/.config/pk/settings.json",
		);
	});

	test("no model and no fake script is provider.no_model", async () => {
		const error = await prepareSession(input(Settings.parse({}))).catch(
			(e: unknown) => e,
		);
		expect(isPkError(error) && error.code).toBe("provider.no_model");
	});

	test("an invalid fake script is refused before the model is looked at", async () => {
		const path = join(root, "bad.json");
		writeFileSync(path, "{not json");
		const error = await prepareSession(
			input(Settings.parse({ model: { main: "nope/x" } }), {
				PK_FAKE_SCRIPT: path,
			}),
		).catch((e: unknown) => e);
		expect(isPkError(error) && error.code).toBe("provider.fake_script_invalid");
	});
});

describe("closeWithin", () => {
	const stuck = (close: () => Promise<void>): AgentSession => ({
		events: {
			[Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
		},
		submit: () => {},
		respond: () => {},
		interrupt: () => {},
		close,
		conversation: [],
		ledger: new Map(),
	});

	test("gives up on a close that never ends, after the bound", async () => {
		const started = performance.now();
		await closeWithin(
			stuck(() => new Promise(() => {})),
			20,
		);
		expect(performance.now() - started).toBeLessThan(500);
	});

	test("returns as soon as a quick close ends", async () => {
		let closed = false;
		await closeWithin(
			stuck(async () => {
				closed = true;
			}),
			10_000,
		);
		expect(closed).toBe(true);
	});
});
