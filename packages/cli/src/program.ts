import { join } from "node:path";
import { createLogger, type Logger, paths } from "@pk/env";
import { Command, CommanderError, Option } from "commander";
import { EXIT } from "./exit-codes.ts";
import {
	cleanupNativeHome,
	ensureNativeHome,
	isNativeLoadFailure,
	nativeLoadFailureMessage,
	realNativeHomeDeps,
	recheckNativeHome,
} from "./native-home.ts";
import { unsupportedPlatformMessage } from "./platform-check.ts";
import { createProcessGuard } from "./process-guard.ts";
import { pkVersion } from "./version.ts";

export interface Io {
	readonly stdout: { isTTY?: boolean; write(text: string): unknown };
	readonly stderr: { write(text: string): unknown };
}

const realIo: Io = { stdout: process.stdout, stderr: process.stderr };

/**
 * Runs pk with `argv` (as in `process.argv`) and resolves with the exit code.
 * This is the composition root: every package is wired together here and nowhere else.
 */
export async function main(
	argv: readonly string[],
	io: Io = realIo,
): Promise<number> {
	const unsupported = unsupportedPlatformMessage();
	if (unsupported) {
		io.stderr.write(`pk: ${unsupported}\n`);
		return EXIT.failure;
	}

	let exitCode: number = EXIT.success;
	let logger: Logger | undefined;
	const getLogger = (debug: boolean): Logger => {
		logger ??= createLogger({
			dir: join(paths().state, "logs"),
			level: debug ? "debug" : "info",
			mirrorToStderr: debug,
		});
		return logger;
	};

	const program = new Command("pk")
		.description("An open source terminal AI coding agent.")
		.version(pkVersion(), "-v, --version", "print the pk version")
		.option("--debug", "write debug logs and mirror them to stderr")
		.exitOverride()
		.configureOutput({
			writeOut: (text) => io.stdout.write(text),
			writeErr: (text) => io.stderr.write(text),
		})
		.action(() => {
			// Interactive mode arrives with #6 (agent loop) on top of the #4 UI foundation.
			io.stderr.write(
				"pk: interactive mode is not built yet. See `pk --help`.\n",
			);
			program.outputHelp({ error: true });
		});

	program
		.command("__tui-smoke", { hidden: true })
		.description(
			"render the OpenTUI smoke screen, survive one resize, then exit (stack proof, spec 0001)",
		)
		.addOption(
			new Option("--duration <ms>", "how long the screen stays up")
				.default("1500")
				.argParser(parseDuration),
		)
		.action(async (options: { duration: number }) => {
			if (!io.stdout.isTTY) {
				io.stderr.write(
					"pk: __tui-smoke needs a terminal (stdout is not a TTY).\n",
				);
				exitCode = EXIT.failure;
				return;
			}
			// Before the logger, the guard, or any use of stdin and stdout: this may replace the process.
			const native = ensureNativeHome(nativeDeps());
			if (native.kind === "failed" || native.kind === "exec") {
				io.stderr.write(
					`pk: ${native.kind === "failed" ? native.message : "could not restart itself to load its UI"}\n`,
				);
				exitCode = EXIT.failure;
				return;
			}
			const log = getLogger(program.opts<{ debug?: boolean }>().debug === true);
			const guard = createProcessGuard({ logger: log });
			try {
				log.info("tui smoke start", { durationMs: options.duration });
				if (native.kind === "ready") {
					const changed = recheckNativeHome(nativeDeps(), native);
					if (changed) {
						io.stderr.write(`pk: ${changed}\n`);
						exitCode = EXIT.failure;
						return;
					}
				}
				// Lazy: only interactive paths load OpenTUI's native library.
				const starting = import("@pk/tui").then((tui) =>
					tui.startSmokeScreen({
						version: pkVersion(),
						durationMs: options.duration,
						onInterrupt: () => void guard.shutdown(EXIT.sigint),
						onSuspend: () => process.kill(process.pid, "SIGTSTP"),
					}),
				);
				guard.attach(starting);
				let screen: Awaited<typeof starting>;
				try {
					screen = await starting;
				} catch (error) {
					guard.detach();
					if (native.kind === "ready" && isNativeLoadFailure(error)) {
						io.stderr.write(`pk: ${nativeLoadFailureMessage(native.dir)}\n`);
						exitCode = EXIT.failure;
						return;
					}
					throw error;
				}
				if (native.kind === "ready") cleanupOldNativeLibraries(native, log);
				const result = await screen.closed;
				guard.detach();
				if (guard.shuttingDown) return; // stopped by a signal: the guard sets the exit code
				log.info("tui smoke done", { ...result });
				const env = (name: string) => JSON.stringify(process.env[name] ?? null);
				const nativeDir = native.kind === "ready" ? native.dir : null;
				io.stdout.write(
					`pk tui smoke ok: resizes=${result.resizes} size=${result.width}x${result.height}` +
						` pid=${process.pid} native=${JSON.stringify(nativeDir)}` +
						` BUN_TMPDIR=${env("BUN_TMPDIR")} PK_NATIVE_DIR=${env("PK_NATIVE_DIR")}` +
						` PK_USER_BUN_TMPDIR=${env("PK_USER_BUN_TMPDIR")}\n`,
				);
			} finally {
				guard.dispose();
			}
		});

	try {
		await program.parseAsync([...argv]);
		return exitCode;
	} catch (error) {
		if (error instanceof CommanderError) {
			// --help and --version surface here with exitCode 0; anything else is a usage error.
			return error.exitCode === 0 ? EXIT.success : EXIT.usage;
		}
		throw error;
	}
}

/** Built on demand, never at module load: module level code in cli stays free of side effects. */
const nativeDeps = realNativeHomeDeps;

/** Best effort: a failure is only a logged warning. */
function cleanupOldNativeLibraries(
	native: { root: string; dir: string },
	log: Logger,
): void {
	const deps = nativeDeps();
	const { failed } = cleanupNativeHome(deps.fs, native, deps.euid);
	if (failed.length > 0) {
		log.warn("could not remove old native library folders", { failed });
	}
}

function parseDuration(value: string): number {
	const ms = Number(value);
	if (!Number.isInteger(ms) || ms < 0) {
		throw new CommanderError(
			EXIT.usage,
			"pk.usage",
			`--duration must be a whole number of milliseconds, got "${value}"`,
		);
	}
	return ms;
}
