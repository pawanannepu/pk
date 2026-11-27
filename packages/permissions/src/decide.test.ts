import { describe, expect, test } from "bun:test";
import { decide } from "./decide.ts";

const none = { sessionAllows: new Set<string>() };

describe("decide (spec 0005 AC-10)", () => {
	test("a read kind tool is allowed", () => {
		expect(decide({ tool: "read_file", kind: "read" }, none)).toEqual({
			decision: "allow",
		});
	});

	test("every other kind asks", () => {
		for (const kind of ["write", "execute", "network"] as const) {
			expect(decide({ tool: "t", kind }, none)).toEqual({ decision: "ask" });
		}
	});

	test("a tool allowed for the session runs without asking", () => {
		const state = { sessionAllows: new Set(["write_file"]) };
		expect(decide({ tool: "write_file", kind: "write" }, state)).toEqual({
			decision: "allow",
		});
		expect(decide({ tool: "bash", kind: "execute" }, state)).toEqual({
			decision: "ask",
		});
	});
});
