import { describe, expect, test } from "bun:test";
import {
	interactiveRefusal,
	NOT_A_TERMINAL_MESSAGE,
} from "./terminal-check.ts";

const tty = { stdinIsTTY: true, stdoutIsTTY: true, term: "xterm-256color" };

describe("interactiveRefusal (spec 0003 AC-20)", () => {
	test("a TTY on both ends with a real TERM may start the full screen UI", () => {
		expect(interactiveRefusal(tty)).toBeUndefined();
	});

	test("TERM unset is not a refusal; only dumb is", () => {
		expect(interactiveRefusal({ ...tty, term: undefined })).toBeUndefined();
		expect(interactiveRefusal({ ...tty, term: "dumb" })).toBe(
			NOT_A_TERMINAL_MESSAGE,
		);
	});

	test("a pipe on either end refuses", () => {
		expect(interactiveRefusal({ ...tty, stdinIsTTY: false })).toBe(
			NOT_A_TERMINAL_MESSAGE,
		);
		expect(interactiveRefusal({ ...tty, stdoutIsTTY: false })).toBe(
			NOT_A_TERMINAL_MESSAGE,
		);
	});

	test("the refusal is two lines and points to pk -p", () => {
		expect(NOT_A_TERMINAL_MESSAGE.split("\n")).toEqual([
			"pk: interactive mode needs a terminal.",
			'For scripts and pipes use: pk -p "<prompt>"',
			"",
		]);
	});
});
