import { describe, expect, test } from "bun:test";
import { constants } from "node:os";
import { EXIT } from "./exit-codes.ts";

// Spec 0001, "Exit codes": 0 success, 1 failure, 2 usage error; signal exits are 128 plus the
// signal number, so a script running pk can tell Ctrl+C from a failure.

describe("EXIT", () => {
	test("the base codes are 0 success, 1 failure, 2 usage", () => {
		expect(EXIT.success).toBe(0);
		expect(EXIT.failure).toBe(1);
		expect(EXIT.usage).toBe(2);
	});

	test("signal exits are 128 plus this platform's signal number", () => {
		expect<number>(EXIT.sigint).toBe(128 + constants.signals.SIGINT);
		expect<number>(EXIT.sigterm).toBe(128 + constants.signals.SIGTERM);
		expect<number>(EXIT.sighup).toBe(128 + constants.signals.SIGHUP);
	});

	test("every code is distinct", () => {
		const codes = Object.values(EXIT);

		expect(new Set(codes).size).toBe(codes.length);
	});
});
