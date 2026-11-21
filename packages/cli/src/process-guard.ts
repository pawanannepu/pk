import { type Logger, redact } from "@pk/env";
import { EXIT } from "./exit-codes.ts";

/** The part of a running full screen UI the guard needs. `@pk/tui`'s handle satisfies it. */
export interface ScreenControl {
	destroy(): Promise<void>;
	suspend(): Promise<void>;
	resume(): Promise<void>;
}

/**
 * Written only when OpenTUI's own restore failed or hung: reset attributes, turn every mouse,
 * paste and focus mode off, leave the alternate screen, show the cursor.
 */
export const FALLBACK_RESTORE =
	"\x1b[0m\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[?1004l\x1b[?1049l\x1b[?25h";

const RESTORE_TIMEOUT_MS = 2000;

export interface ProcessGuard {
	/**
	 * The screen to restore if pk is stopped, suspended or crashes. Pass the promise of a screen that
	 * is still starting, so a signal that lands mid startup still restores the terminal.
	 */
	attach(screen: ScreenControl | Promise<ScreenControl>): void;
	detach(): void;
	/** Closes any screen cleanly, then exits. */
	shutdown(code: number): Promise<void>;
	/** True once a signal or fatal error started shutting pk down. */
	readonly shuttingDown: boolean;
	/** Removes the process listeners (tests). */
	dispose(): void;
}

export interface ProcessGuardDeps {
	readonly logger: Logger;
	readonly exit?: (code: number) => void;
	readonly stderr?: { write(text: string): unknown };
	readonly stdout?: { isTTY?: boolean; write(text: string): unknown };
}

/**
 * Owns how the pk process ends (spec 0001, "Process behavior"). On a normal exit, SIGINT, SIGTERM,
 * SIGHUP, an uncaught error or an unhandled rejection the terminal leaves the alternate screen,
 * shows the cursor, turns mouse reporting off and leaves raw mode before pk exits. Ctrl+Z hands the
 * terminal back and redraws on resume.
 */
export function createProcessGuard(deps: ProcessGuardDeps): ProcessGuard {
	const exit = deps.exit ?? ((code: number) => process.exit(code));
	const stderr = deps.stderr ?? process.stderr;
	const stdout = deps.stdout ?? process.stdout;
	let screen: Promise<ScreenControl> | undefined;
	let exiting = false;

	const closeScreen = async (): Promise<void> => {
		const pending = screen;
		screen = undefined;
		if (!pending) return;
		const restored = await Promise.race([
			pending
				.then((current) => current.destroy())
				.then(
					() => true,
					() => false,
				),
			new Promise<boolean>((resolve) =>
				setTimeout(() => resolve(false), RESTORE_TIMEOUT_MS).unref?.(),
			),
		]);
		if (!restored) {
			deps.logger.warn("terminal restore fell back to raw escape sequences");
			if (stdout.isTTY) stdout.write(FALLBACK_RESTORE);
			if (process.stdin.isTTY) process.stdin.setRawMode?.(false);
		}
	};

	const shutdown = async (code: number): Promise<void> => {
		if (exiting) return;
		exiting = true;
		await closeScreen();
		exit(code);
	};

	const onSignal = (code: number) => () => void shutdown(code);
	const onSigint = onSignal(EXIT.sigint);
	const onSigterm = onSignal(EXIT.sigterm);
	const onSighup = onSignal(EXIT.sighup);

	const onSigtstp = (): void => {
		const pending = screen;
		const stop = (): void => {
			process.kill(process.pid, "SIGSTOP");
		};
		if (!pending) {
			stop();
			return;
		}
		pending.then((current) => current.suspend()).then(stop, stop);
	};
	const onSigcont = (): void => {
		void screen
			?.then((current) => current.resume())
			.catch((error: unknown) => deps.logger.warn("resume failed", { error }));
	};

	const onFatal = (error: unknown): void => {
		deps.logger.error("fatal error", { error });
		void closeScreen().finally(() => {
			const message = error instanceof Error ? error.message : String(error);
			stderr.write(`pk: unexpected error: ${redact(message)}\n`);
			exiting = true;
			exit(EXIT.failure);
		});
	};

	process.on("SIGINT", onSigint);
	process.on("SIGTERM", onSigterm);
	process.on("SIGHUP", onSighup);
	process.on("SIGTSTP", onSigtstp);
	process.on("SIGCONT", onSigcont);
	process.on("uncaughtException", onFatal);
	process.on("unhandledRejection", onFatal);

	return {
		attach: (next) => {
			screen = Promise.resolve(next);
		},
		detach: () => {
			screen = undefined;
		},
		shutdown,
		get shuttingDown() {
			return exiting;
		},
		dispose: () => {
			process.off("SIGINT", onSigint);
			process.off("SIGTERM", onSigterm);
			process.off("SIGHUP", onSighup);
			process.off("SIGTSTP", onSigtstp);
			process.off("SIGCONT", onSigcont);
			process.off("uncaughtException", onFatal);
			process.off("unhandledRejection", onFatal);
		},
	};
}
