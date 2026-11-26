import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	createLogger,
	findProjectRoot,
	isPkError,
	type Logger,
	loadSettings,
	paths,
	readSettingsFile,
} from "@pk/env";
import type { TuiEnv, TuiHandle } from "@pk/tui";
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
import { interactiveRefusal } from "./terminal-check.ts";
import { type RunCommand, readTmuxPassthrough } from "./tmux-check.ts";
import { pkVersion } from "./version.ts";

export interface Io {
	readonly stdin: { isTTY?: boolean };
	readonly stdout: { isTTY?: boolean; write(text: string): unknown };
	readonly stderr: { write(text: string): unknown };
	/** The process environment, passed in so tests never read the real one. */
	readonly env: Readonly<Record<string, string | undefined>>;
}

const realIo = (): Io => ({
	stdin: process.stdin,
	stdout: process.stdout,
	stderr: process.stderr,
	env: process.env,
});

/**
 * Runs pk with `argv` (as in `process.argv`) and resolves with the exit code.
 * This is the composition root: every package is wired together here and nowhere else.
 */
export async function main(
	argv: readonly string[],
	io: Io = realIo(),
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

	const log = (): Logger =>
		getLogger(program.opts<{ debug?: boolean }>().debug === true);

	/**
	 * Runs one full screen: the native library home (which may replace the process), the process guard,
	 * the lazy `@pk/tui` import, and the close. Resolves with the screen's result, or `undefined` when it
	 * failed (exitCode is set) or a signal stopped it (the guard sets the exit code).
	 */
	const runScreen = async <T>(
		label: string,
		start: (
			tui: typeof import("@pk/tui"),
			hooks: { onQuit: () => void; onSuspend: () => void },
			log: Logger,
		) => Promise<TuiHandle<T>>,
	): Promise<{ result: T; nativeDir: string | null } | undefined> => {
		// Before the logger, the guard, or any use of stdin and stdout: this may replace the process.
		const native = ensureNativeHome(nativeDeps());
		if (native.kind === "failed" || native.kind === "exec") {
			io.stderr.write(
				`pk: ${native.kind === "failed" ? native.message : "could not restart itself to load its UI"}\n`,
			);
			exitCode = EXIT.failure;
			return undefined;
		}
		const logger = log();
		const guard = createProcessGuard({ logger });
		try {
			logger.info(`${label} start`);
			if (native.kind === "ready") {
				const changed = recheckNativeHome(nativeDeps(), native);
				if (changed) {
					io.stderr.write(`pk: ${changed}\n`);
					exitCode = EXIT.failure;
					return undefined;
				}
			}
			const hooks = {
				onQuit: () => void guard.shutdown(EXIT.sigint),
				onSuspend: () => process.kill(process.pid, "SIGTSTP"),
			};
			// Lazy: only interactive paths load OpenTUI's native library.
			const starting = import("@pk/tui").then((tui) =>
				start(tui, hooks, logger),
			);
			guard.attach(starting);
			let screen: TuiHandle<T>;
			try {
				screen = await starting;
			} catch (error) {
				guard.detach();
				if (native.kind === "ready" && isNativeLoadFailure(error)) {
					io.stderr.write(`pk: ${nativeLoadFailureMessage(native.dir)}\n`);
					exitCode = EXIT.failure;
					return undefined;
				}
				if (isPkError(error)) {
					io.stderr.write(`pk: ${error.message}\n`);
					exitCode = EXIT.failure;
					return undefined;
				}
				throw error;
			}
			if (native.kind === "ready") cleanupOldNativeLibraries(native, logger);
			const result = await screen.closed;
			guard.detach();
			if (guard.shuttingDown) return undefined;
			logger.info(`${label} done`);
			return { result, nativeDir: native.kind === "ready" ? native.dir : null };
		} finally {
			guard.dispose();
		}
	};

	const program = new Command("pk")
		.description("An open source terminal AI coding agent.")
		.version(pkVersion(), "-v, --version", "print the pk version")
		.option("--debug", "write debug logs and mirror them to stderr")
		// Read by settings loading (spec 0002): skips .pk/settings.json and .pk/settings.local.json.
		.option(
			"--no-project-settings",
			"ignore this project's .pk/settings.json and .pk/settings.local.json",
		)
		.exitOverride()
		.configureOutput({
			writeOut: (text) => io.stdout.write(text),
			writeErr: (text) => io.stderr.write(text),
		})
		.action(() => {
			const refusal = refuseWithoutTerminal(io);
			if (refusal) {
				exitCode = EXIT.usage;
				return;
			}
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
			const ran = await runScreen("tui smoke", (tui, hooks) =>
				tui.startSmokeScreen({
					version: pkVersion(),
					durationMs: options.duration,
					onInterrupt: hooks.onQuit,
					onSuspend: hooks.onSuspend,
				}),
			);
			if (!ran) return;
			const { result, nativeDir } = ran;
			const env = (name: string) => JSON.stringify(process.env[name] ?? null);
			io.stdout.write(
				`pk tui smoke ok: resizes=${result.resizes} size=${result.width}x${result.height}` +
					` pid=${process.pid} native=${JSON.stringify(nativeDir)}` +
					` BUN_TMPDIR=${env("BUN_TMPDIR")} PK_NATIVE_DIR=${env("PK_NATIVE_DIR")}` +
					` PK_USER_BUN_TMPDIR=${env("PK_USER_BUN_TMPDIR")}\n`,
			);
		});

	program
		.command("__tui-demo", { hidden: true })
		.description(
			"play the scripted demo through the real full screen UI (spec 0003)",
		)
		.addOption(
			new Option("--speed <n>", "divide every scripted delay by n")
				.default("1")
				.argParser(parseSpeed),
		)
		.addOption(
			new Option(
				"--exit-after <ms>",
				"close the screen after this long, with exit code 0",
			).argParser(parseDuration),
		)
		.action(async (options: { speed: number; exitAfter?: number }) => {
			// Before the native library exec and before @pk/tui is imported (AC-20).
			if (refuseWithoutTerminal(io)) {
				exitCode = EXIT.usage;
				return;
			}
			const flags = program.opts<{ projectSettings?: boolean }>();
			let timer: ReturnType<typeof setTimeout> | undefined;
			const ran = await runScreen("tui demo", async (tui, hooks, log) => {
				const home = homedir();
				const projectRoot = findProjectRoot(process.cwd(), home, existsSync);
				const loaded = await loadSettings({
					userFile: join(paths().config, "settings.json"),
					projectRoot,
					home,
					flags: {},
					skipProject: flags.projectSettings === false,
					readFile: readSettingsFile,
				});
				for (const warning of loaded.warnings) {
					log.warn("settings warning", {
						code: warning.code,
						message: warning.message,
					});
				}
				const clock = tui.systemClock();
				const handle = await tui.startTui({
					session: tui.createScriptedSession(tui.DEMO_SCRIPT, {
						clock,
						speed: options.speed,
					}),
					info: {
						version: pkVersion(),
						projectRoot,
						home,
						model: { provider: "demo", model: "scripted" },
						mode: "normal",
						contextWindow: 200_000,
					},
					ui: {
						background: loaded.settings.ui?.background ?? "pk",
						ascii: loaded.settings.ui?.ascii ?? false,
					},
					env: terminalEnv(io.env),
					...tmuxPassthroughOption(io.env.TMUX),
					clock,
					logger: log,
					onQuit: hooks.onQuit,
					onSuspend: hooks.onSuspend,
				});
				if (options.exitAfter !== undefined) {
					timer = setTimeout(() => void handle.destroy(), options.exitAfter);
				}
				return handle;
			});
			clearTimeout(timer);
			if (ran) log().info("tui demo done", { reason: ran.result.reason });
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

/** Writes the AC-20 refusal to stderr and returns true when the full screen UI cannot start here. */
function refuseWithoutTerminal(io: Io): boolean {
	const refusal = interactiveRefusal({
		stdinIsTTY: io.stdin.isTTY === true,
		stdoutIsTTY: io.stdout.isTTY === true,
		term: io.env.TERM,
	});
	if (refusal === undefined) return false;
	io.stderr.write(refusal);
	return true;
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

/** Runs a short command with stdin and stderr kept off the terminal; `undefined` on any failure. */
const runQuiet: RunCommand = (command, args) => {
	const out = spawnSync(command, [...args], {
		encoding: "utf8",
		timeout: 500,
		stdio: ["ignore", "pipe", "ignore"],
	});
	return out.status === 0 ? out.stdout : undefined;
};

/** The tmux `allow-passthrough` reader for `TuiOptions`, so the screen knows when tmux would drop a copy (AC-18). */
function tmuxPassthroughOption(tmux: string | undefined): {
	tmuxPassthrough?: () => "on" | "off" | undefined;
} {
	if ((tmux ?? "") === "") return {};
	return { tmuxPassthrough: () => readTmuxPassthrough(tmux, runQuiet) };
}

/** The environment variables the screen reads, picked from the process environment. */
function terminalEnv(env: Io["env"]): TuiEnv {
	const pick = (name: keyof TuiEnv) =>
		env[name] === undefined ? {} : { [name]: env[name] };
	return {
		...pick("NO_COLOR"),
		...pick("COLORTERM"),
		...pick("TERM"),
		...pick("LANG"),
		...pick("LC_ALL"),
		...pick("LC_CTYPE"),
		...pick("TMUX"),
	};
}

function parseSpeed(value: string): number {
	const speed = Number(value);
	if (!Number.isFinite(speed) || speed <= 0) {
		throw new CommanderError(
			EXIT.usage,
			"pk.usage",
			`--speed must be a number above 0, got "${value}"`,
		);
	}
	return speed;
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
