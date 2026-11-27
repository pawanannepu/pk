import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineTool, type ToolContext, textOutcome } from "./tool.ts";

const runs: unknown[] = [];
const echo = defineTool({
	name: "echo",
	description: "echoes",
	kind: "read",
	input: z.object({
		word: z.string().min(1),
		times: z.number().int().optional(),
	}),
	run: async (input) => {
		runs.push(input);
		return textOutcome(input.word, false);
	},
});

const ctx: ToolContext = {
	signal: new AbortController().signal,
	projectRoot: "/p",
	fs: {
		realpath: async (p) => p,
		stat: async () => ({ kind: "file", size: 0, mtimeMs: 0 }),
		readFile: async () => new Uint8Array(),
	},
	ledger: new Map(),
};

const text = (outcome: { content: readonly { type: string }[] }) =>
	outcome.content.map((b) => ("text" in b ? b.text : "")).join("");

describe("defineTool (spec 0005 AC-4)", () => {
	test("the definition carries the name, kind and a JSON Schema of the input", () => {
		expect(echo.definition.name).toBe("echo");
		expect(echo.definition.kind).toBe("read");
		expect(echo.definition.inputSchema).toMatchObject({
			type: "object",
			properties: { word: { type: "string" } },
			required: ["word"],
		});
	});

	test("validate accepts good input and execute runs it", async () => {
		const v = echo.validate({ word: "hi" });
		expect(v.ok).toBe(true);
		if (!v.ok) return;
		const outcome = await echo.execute(v.input, ctx);
		expect(text(outcome)).toBe("hi");
	});

	test("bad input is an error outcome, one path: message line per issue", () => {
		const v = echo.validate({ word: "", times: 1.5 });
		expect(v.ok).toBe(false);
		if (v.ok) return;
		expect(v.outcome.isError).toBe(true);
		const lines = text(v.outcome).split("\n");
		expect(lines[0]).toStartWith("Invalid input for echo: word: ");
		expect(lines[1]).toStartWith("times: ");
	});

	test("execute on a value validate never made returns the invalid input outcome and never runs", async () => {
		runs.length = 0;
		const outcome = await echo.execute({ nope: true }, ctx);
		expect(outcome.isError).toBe(true);
		expect(text(outcome)).toStartWith("Invalid input for echo: word: ");
		expect(runs).toEqual([]);
	});

	test("a top level issue reads input: message", () => {
		const strict = defineTool({
			name: "strict",
			description: "",
			kind: "write",
			input: z.strictObject({}),
			run: async () => textOutcome("", false),
		});
		const v = strict.validate({ extra: 1 });
		expect(!v.ok && text(v.outcome)).toStartWith(
			"Invalid input for strict: input: ",
		);
	});
});
