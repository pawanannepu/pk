import {
	appendFileSync,
	existsSync,
	mkdirSync,
	renameSync,
	rmSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import { redact } from "./redact.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Readonly<Record<string, unknown>>;

const LEVEL_RANK: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

export interface Logger {
	debug(msg: string, fields?: LogFields): void;
	info(msg: string, fields?: LogFields): void;
	warn(msg: string, fields?: LogFields): void;
	error(msg: string, fields?: LogFields): void;
	/** A logger that adds `fields` to every record, sharing the same file and rotation. */
	child(fields: LogFields): Logger;
}

export interface LoggerOptions {
	/** Directory for the log files, normally `<state>/logs`. Created on the first write. */
	readonly dir: string;
	/** Lowest level written. Default `info`, which by policy never carries prompts, model output or file contents. */
	readonly level?: LogLevel;
	/** Also print each record to stderr (`--debug`). pk's logger never writes to stdout. */
	readonly mirrorToStderr?: boolean;
	/** Rotate when the current file passes this size. Default 5 MiB. */
	readonly maxBytes?: number;
	/** Files kept, including the current one (`pk.log`, `pk.1.log`, ...). Default 3. */
	readonly maxFiles?: number;
	/** Exact secret values to scrub, read at write time so newly loaded keys are covered. */
	readonly secrets?: () => Iterable<string>;
	readonly now?: () => Date;
	readonly stderr?: { write(text: string): unknown };
}

export const LOG_FILE = "pk.log";

/**
 * pk's own JSONL logger. One line per record: `{ ts, level, msg, ...fields }`, redacted.
 *
 * Writes are synchronous so records stay in order and survive a crash right after them.
 * A failure to write a log never throws into the caller: logging must not break pk.
 */
export function createLogger(options: LoggerOptions): Logger {
	const state = {
		level: LEVEL_RANK[options.level ?? "info"],
		file: join(options.dir, LOG_FILE),
		maxBytes: options.maxBytes ?? 5 * 1024 * 1024,
		maxFiles: Math.max(1, options.maxFiles ?? 3),
		size: -1,
		disabled: false,
	};
	const now = options.now ?? (() => new Date());
	const stderr = options.stderr ?? process.stderr;

	const rotate = (): void => {
		const name = (n: number) =>
			join(options.dir, n === 0 ? LOG_FILE : `pk.${n}.log`);
		rmSync(name(state.maxFiles - 1), { force: true });
		for (let n = state.maxFiles - 2; n >= 0; n--) {
			if (existsSync(name(n))) renameSync(name(n), name(n + 1));
		}
		state.size = 0;
	};

	const write = (
		level: LogLevel,
		msg: string,
		base: LogFields,
		fields: LogFields | undefined,
	): void => {
		if (LEVEL_RANK[level] < state.level) return;
		const record = redact(
			{ ts: now().toISOString(), level, msg, ...base, ...fields },
			{ secrets: options.secrets?.() ?? [] },
		);
		const line = `${safeStringify(record)}\n`;

		if (options.mirrorToStderr) {
			try {
				stderr.write(`[pk ${level}] ${line}`);
			} catch {
				// ignored on purpose
			}
		}

		if (state.disabled) return;
		try {
			if (state.size < 0) {
				mkdirSync(options.dir, { recursive: true });
				state.size = existsSync(state.file) ? statSync(state.file).size : 0;
			}
			const bytes = Buffer.byteLength(line);
			if (state.size > 0 && state.size + bytes > state.maxBytes) rotate();
			appendFileSync(state.file, line, { encoding: "utf8", mode: 0o600 });
			state.size += bytes;
		} catch {
			// The log dir is unwritable (read only home, full disk). Stop trying; pk keeps working.
			state.disabled = true;
		}
	};

	const make = (base: LogFields): Logger => ({
		debug: (msg, fields) => write("debug", msg, base, fields),
		info: (msg, fields) => write("info", msg, base, fields),
		warn: (msg, fields) => write("warn", msg, base, fields),
		error: (msg, fields) => write("error", msg, base, fields),
		child: (fields) => make({ ...base, ...fields }),
	});

	return make({});
}

/** A logger that drops everything. Handy for tests and for code paths that run before setup. */
export const silentLogger: Logger = {
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
	child: () => silentLogger,
};

function safeStringify(value: unknown): string {
	try {
		return (
			JSON.stringify(value, (_key, v) =>
				typeof v === "bigint" ? v.toString() : v,
			) ?? "null"
		);
	} catch {
		return JSON.stringify({ msg: "unserializable log record" });
	}
}
