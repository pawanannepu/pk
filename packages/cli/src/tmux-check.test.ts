import { describe, expect, test } from "bun:test";
import {
	parseTmuxPassthrough,
	readTmuxPassthrough,
	TMUX_PASSTHROUGH_ARGS,
} from "./tmux-check.ts";

describe("tmux allow-passthrough (spec 0003 AC-18)", () => {
	test("on and all let the copy through, off drops it, anything else is unknown", () => {
		expect(parseTmuxPassthrough("on\n")).toBe("on");
		expect(parseTmuxPassthrough("all\n")).toBe("on");
		expect(parseTmuxPassthrough("off\n")).toBe("off");
		expect(parseTmuxPassthrough("")).toBeUndefined();
		expect(
			parseTmuxPassthrough("invalid option: allow-passthrough"),
		).toBeUndefined();
		expect(parseTmuxPassthrough(undefined)).toBeUndefined();
	});

	test("asks tmux only when TMUX is set", () => {
		const calls: (readonly string[])[] = [];
		const run = (command: string, args: readonly string[]) => {
			calls.push([command, ...args]);
			return "off\n";
		};
		expect(readTmuxPassthrough(undefined, run)).toBeUndefined();
		expect(readTmuxPassthrough("", run)).toBeUndefined();
		expect(calls).toEqual([]);
		expect(readTmuxPassthrough("/tmp/tmux-501/default,1,0", run)).toBe("off");
		expect(calls).toEqual([["tmux", ...TMUX_PASSTHROUGH_ARGS]]);
	});

	test("a failed tmux call is unknown", () => {
		expect(
			readTmuxPassthrough("/tmp/tmux-501/default,1,0", () => undefined),
		).toBeUndefined();
	});
});
