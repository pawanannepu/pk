import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { LogFields, Logger } from "@pk/env";
import { EXIT } from "./exit-codes.ts";
import {
	createProcessGuard,
	FALLBACK_RESTORE,
	type ProcessGuard,
	type ScreenControl,
} from "./process-guard.ts";

// Spec 0001, "Process behavior": terminal restore, exit codes, Ctrl+Z suspend and resume.
// Signals are delivered with process.emit, so only the guard's own listeners run.

type Entry = { level: string; msg: string; fields?: LogFields };

function fakeLogger(entries: Entry[]): Logger {
	const at =
		(level: string) =>
		(msg: string, fields?: LogFields): void => {
			entries.push({ level, msg, fields });
		};
	const logger: Logger = {
		debug: at("debug"),
		info: at("info"),
		warn: at("warn"),
		error: at("error"),
		child: () => logger,
	};
	return logger;
}

function fakeScreen(
	overrides: Partial<Record<keyof ScreenControl, () => Promise<void>>> = {},
) {
	const calls: string[] = [];
	const step = (name: keyof ScreenControl) => async (): Promise<void> => {
		calls.push(name);
		await overrides[name]?.();
	};
	const screen: ScreenControl = {
		destroy: step("destroy"),
		suspend: step("suspend"),
		resume: step("resume"),
	};
	return { screen, calls };
}

let guards: ProcessGuard[] = [];

function setup(options: { isTTY?: boolean } = {}) {
	const logs: Entry[] = [];
	const exits: number[] = [];
	const out: string[] = [];
	const err: string[] = [];
	let exited: () => void = () => {};
	const exitedOnce = new Promise<void>((resolve) => {
		exited = resolve;
	});
	const guard = createProcessGuard({
		logger: fakeLogger(logs),
		exit: (code) => {
			exits.push(code);
			exited();
		},
		stdout: { isTTY: options.isTTY ?? true, write: (t) => out.push(t) },
		stderr: { write: (t) => err.push(t) },
	});
	guards.push(guard);
	return {
		guard,
		logs,
		exits,
		out: () => out.join(""),
		err: () => err.join(""),
		exitedOnce,
	};
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
	for (const guard of guards) guard.dispose();
	guards = [];
});

describe("createProcessGuard: shutdown", () => {
	test("closes the attached screen before exiting with the given code", async () => {
		const g = setup();
		const { screen, calls } = fakeScreen();
		g.guard.attach(screen);

		await g.guard.shutdown(EXIT.success);

		expect(calls).toEqual(["destroy"]);
		expect(g.exits).toEqual([EXIT.success]);
		expect(g.out()).toBe("");
	});

	test("exits at once when no screen is attached", async () => {
		const g = setup();

		await g.guard.shutdown(EXIT.failure);

		expect(g.exits).toEqual([EXIT.failure]);
	});

	test("a detached screen is not closed", async () => {
		const g = setup();
		const { screen, calls } = fakeScreen();
		g.guard.attach(screen);
		g.guard.detach();

		await g.guard.shutdown(EXIT.success);

		expect(calls).toEqual([]);
		expect(g.exits).toEqual([EXIT.success]);
	});

	test("waits for a screen that is still starting, then closes it", async () => {
		const g = setup();
		const { screen, calls } = fakeScreen();
		let ready: (s: ScreenControl) => void = () => {};
		g.guard.attach(new Promise<ScreenControl>((resolve) => (ready = resolve)));

		const done = g.guard.shutdown(EXIT.success);
		await tick();
		expect(g.exits).toEqual([]);
		ready(screen);
		await done;

		expect(calls).toEqual(["destroy"]);
		expect(g.exits).toEqual([EXIT.success]);
	});

	test("runs only once, even when called again", async () => {
		const g = setup();
		const { screen, calls } = fakeScreen();
		g.guard.attach(screen);

		await Promise.all([
			g.guard.shutdown(EXIT.success),
			g.guard.shutdown(EXIT.failure),
		]);

		expect(calls).toEqual(["destroy"]);
		expect(g.exits).toEqual([EXIT.success]);
	});

	test("shuttingDown turns true once shutdown starts", async () => {
		const g = setup();
		expect(g.guard.shuttingDown).toBe(false);

		await g.guard.shutdown(EXIT.success);

		expect(g.guard.shuttingDown).toBe(true);
	});
});

describe("createProcessGuard: fallback restore", () => {
	test("writes the raw restore sequences when the screen's own restore fails", async () => {
		const g = setup({ isTTY: true });
		const { screen } = fakeScreen({
			destroy: () => Promise.reject(new Error("renderer gone")),
		});
		g.guard.attach(screen);

		await g.guard.shutdown(EXIT.failure);

		expect(g.out()).toBe(FALLBACK_RESTORE);
		expect(g.logs.map((e) => e.level)).toContain("warn");
		expect(g.exits).toEqual([EXIT.failure]);
	});

	test("a screen that never starts still gets the fallback", async () => {
		const g = setup({ isTTY: true });
		g.guard.attach(Promise.reject(new Error("start failed")));

		await g.guard.shutdown(EXIT.failure);

		expect(g.out()).toBe(FALLBACK_RESTORE);
	});

	test("does not write escape sequences when stdout is not a terminal", async () => {
		const g = setup({ isTTY: false });
		const { screen } = fakeScreen({
			destroy: () => Promise.reject(new Error("renderer gone")),
		});
		g.guard.attach(screen);

		await g.guard.shutdown(EXIT.failure);

		expect(g.out()).toBe("");
		expect(g.exits).toEqual([EXIT.failure]);
	});

	test("gives up on a restore that hangs and falls back after the timeout", async () => {
		const g = setup({ isTTY: true });
		const { screen } = fakeScreen({ destroy: () => new Promise(() => {}) });
		g.guard.attach(screen);

		const started = Date.now();
		await g.guard.shutdown(EXIT.sigterm);

		expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
		expect(g.out()).toBe(FALLBACK_RESTORE);
		expect(g.exits).toEqual([EXIT.sigterm]);
	}, 5000);

	test("the fallback leaves the alternate screen, shows the cursor and turns mouse and paste modes off", () => {
		for (const sequence of [
			"\x1b[?1049l", // leave the alternate screen
			"\x1b[?25h", // show the cursor
			"\x1b[?1000l", // mouse click reporting off
			"\x1b[?1003l", // mouse motion reporting off
			"\x1b[?1006l", // SGR mouse off
			"\x1b[?2004l", // bracketed paste off
		]) {
			expect(FALLBACK_RESTORE).toContain(sequence);
		}
		// The cursor comes back last, after the screen switch.
		expect(FALLBACK_RESTORE.endsWith("\x1b[?25h")).toBe(true);
	});
});

describe("createProcessGuard: signals", () => {
	for (const [signal, code] of [
		["SIGINT", EXIT.sigint],
		["SIGTERM", EXIT.sigterm],
		["SIGHUP", EXIT.sighup],
	] as const) {
		test(`${signal} closes the screen and exits ${code}`, async () => {
			const g = setup();
			const { screen, calls } = fakeScreen();
			g.guard.attach(screen);

			process.emit(signal, signal);
			await g.exitedOnce;

			expect(calls).toEqual(["destroy"]);
			expect(g.exits).toEqual([code]);
			expect(g.guard.shuttingDown).toBe(true);
		});
	}

	test("a second Ctrl+C during shutdown does not exit twice", async () => {
		const g = setup();
		const { screen } = fakeScreen();
		g.guard.attach(screen);

		process.emit("SIGINT", "SIGINT");
		process.emit("SIGINT", "SIGINT");
		await g.exitedOnce;
		await tick();

		expect(g.exits).toEqual([EXIT.sigint]);
	});

	test("dispose removes every process listener the guard added", () => {
		const events = [
			"SIGINT",
			"SIGTERM",
			"SIGHUP",
			"SIGTSTP",
			"SIGCONT",
			"uncaughtException",
			"unhandledRejection",
		] as const;
		const count = () => events.map((e) => process.listenerCount(e));
		const before = count();

		const g = setup();
		expect(count()).toEqual(before.map((n) => n + 1));
		g.guard.dispose();

		expect(count()).toEqual(before);
	});
});

describe("createProcessGuard: Ctrl+Z", () => {
	test("SIGTSTP suspends the screen, then stops the process", async () => {
		const kill = spyOn(process, "kill").mockImplementation(() => true);
		try {
			const g = setup();
			const { screen, calls } = fakeScreen();
			g.guard.attach(screen);

			process.emit("SIGTSTP", "SIGTSTP");
			await tick();
			await tick();

			expect(calls).toEqual(["suspend"]);
			expect(kill).toHaveBeenCalledWith(process.pid, "SIGSTOP");
			expect(g.exits).toEqual([]);
		} finally {
			kill.mockRestore();
		}
	});

	test("SIGTSTP with no screen stops the process at once", () => {
		const kill = spyOn(process, "kill").mockImplementation(() => true);
		try {
			setup();

			process.emit("SIGTSTP", "SIGTSTP");

			expect(kill).toHaveBeenCalledWith(process.pid, "SIGSTOP");
		} finally {
			kill.mockRestore();
		}
	});

	test("SIGTSTP still stops the process when suspend fails", async () => {
		const kill = spyOn(process, "kill").mockImplementation(() => true);
		try {
			const g = setup();
			const { screen } = fakeScreen({
				suspend: () => Promise.reject(new Error("no tty")),
			});
			g.guard.attach(screen);

			process.emit("SIGTSTP", "SIGTSTP");
			await tick();
			await tick();

			expect(kill).toHaveBeenCalledWith(process.pid, "SIGSTOP");
		} finally {
			kill.mockRestore();
		}
	});

	test("SIGCONT redraws the screen", async () => {
		const g = setup();
		const { screen, calls } = fakeScreen();
		g.guard.attach(screen);

		process.emit("SIGCONT", "SIGCONT");
		await tick();

		expect(calls).toEqual(["resume"]);
		expect(g.exits).toEqual([]);
	});

	test("a failed redraw on SIGCONT is logged, not thrown", async () => {
		const g = setup();
		const { screen } = fakeScreen({
			resume: () => Promise.reject(new Error("resize lost")),
		});
		g.guard.attach(screen);

		process.emit("SIGCONT", "SIGCONT");
		await tick();
		await tick();

		expect(g.logs).toContainEqual(
			expect.objectContaining({ level: "warn", msg: "resume failed" }),
		);
		expect(g.exits).toEqual([]);
	});
});

describe("createProcessGuard: fatal errors", () => {
	test("an uncaught error restores the screen, prints a short message and exits 1", async () => {
		const g = setup();
		const { screen, calls } = fakeScreen();
		g.guard.attach(screen);

		process.emit("uncaughtException", new Error("boom"));
		await g.exitedOnce;

		expect(calls).toEqual(["destroy"]);
		expect(g.err()).toBe("pk: unexpected error: boom\n");
		expect(g.exits).toEqual([EXIT.failure]);
		expect(g.logs).toContainEqual(
			expect.objectContaining({ level: "error", msg: "fatal error" }),
		);
	});

	test("an unhandled rejection with a non Error reason is handled the same way", async () => {
		const g = setup();

		process.emit("unhandledRejection", "plain reason", Promise.resolve());
		await g.exitedOnce;

		expect(g.err()).toBe("pk: unexpected error: plain reason\n");
		expect(g.exits).toEqual([EXIT.failure]);
	});

	test("a secret in the error message is redacted before it reaches the terminal", async () => {
		const g = setup();
		const key = "sk-proj-abcdefghijklmnopqrstuvwx";

		process.emit(
			"uncaughtException",
			new Error(`request failed with key ${key}`),
		);
		await g.exitedOnce;

		expect(g.err()).not.toContain(key);
		expect(g.err()).toContain("pk: unexpected error: request failed with key");
	});

	test("a fatal error marks the guard as shutting down", async () => {
		const g = setup();

		process.emit("uncaughtException", new Error("boom"));
		await g.exitedOnce;

		expect(g.guard.shuttingDown).toBe(true);
	});
});
