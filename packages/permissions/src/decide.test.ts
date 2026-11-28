import { describe, expect, test } from "bun:test";
import type { PermissionMode, ToolKind } from "@pk/schema";
import { decide } from "./decide.ts";

const MODES: readonly PermissionMode[] = [
	"normal",
	"accept_edits",
	"plan",
	"skip_all",
];
const KINDS: readonly ToolKind[] = ["read", "write", "execute", "network"];

type Expected = "allow" | "ask" | "block";

/** The spec 0006 AC-1 table, without a session allow. */
const TABLE: Record<ToolKind, Record<PermissionMode, Expected>> = {
	read: {
		normal: "allow",
		accept_edits: "allow",
		plan: "allow",
		skip_all: "allow",
	},
	write: {
		normal: "ask",
		accept_edits: "allow",
		plan: "block",
		skip_all: "allow",
	},
	execute: {
		normal: "ask",
		accept_edits: "ask",
		plan: "block",
		skip_all: "allow",
	},
	network: {
		normal: "ask",
		accept_edits: "ask",
		plan: "ask",
		skip_all: "allow",
	},
};

const KEY = "t:ls";

describe("decide (spec 0006 AC-1)", () => {
	for (const kind of KINDS) {
		for (const mode of MODES) {
			const expected = TABLE[kind][mode];
			test(`${kind} in ${mode} → ${expected}`, () => {
				const got = decide(
					{ tool: "t", kind, key: KEY },
					{ mode, sessionAllows: new Set() },
				);
				expect(got.decision).toBe(expected);
				if (got.decision === "block") expect(got.reason).toBe("plan_mode");
			});

			// A session allow turns ask into allow; a plan block still wins.
			const withAllow = expected === "ask" ? "allow" : expected;
			test(`${kind} in ${mode} with a matching session allow → ${withAllow}`, () => {
				const got = decide(
					{ tool: "t", kind, key: KEY },
					{ mode, sessionAllows: new Set([KEY]) },
				);
				expect(got.decision).toBe(withAllow);
			});
		}
	}

	test("a session allow matches on the exact key, not the tool name", () => {
		const state = { mode: "normal" as const, sessionAllows: new Set(["t:ls"]) };
		expect(
			decide({ tool: "t", kind: "execute", key: "t:ls -la" }, state).decision,
		).toBe("ask");
		expect(
			decide({ tool: "t", kind: "execute", key: "t" }, state).decision,
		).toBe("ask");
	});
});
