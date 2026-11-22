import { randomBytes } from "node:crypto";
import {
	appendFile,
	chmod,
	mkdir,
	open,
	rename,
	rm,
	stat,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { PkError } from "./errors.ts";

/** Options for `atomicWriteFile` and `appendJsonl`. Both apply only to paths they create. */
export interface AtomicWriteOptions {
	/** File mode for a newly created file, for example `0o600` for anything sensitive. */
	readonly mode?: number;
	/** Mode for each folder created on the way, for example `0o700`. */
	readonly dirMode?: number;
}

/**
 * The options for every state file holding your code, prompts or costs (sessions, blobs, costs,
 * history): files only you can read, inside folders only you can open.
 */
export const PRIVATE_FILE = { mode: 0o600, dirMode: 0o700 } as const;

/**
 * Creates `path` (and missing parents) as `0700`, or tightens an existing folder you own to `0700`.
 * A file inside a `0700` folder is out of reach for others even if the file itself is older and looser,
 * so session, cost and history writers call this for their folder. Returns `path`.
 */
export async function ensurePrivateDir(path: string): Promise<string> {
	await mkdir(path, { recursive: true, mode: PRIVATE_FILE.dirMode });
	const info = await stat(path);
	const mine = process.getuid === undefined || info.uid === process.getuid();
	if (mine && (info.mode & 0o777) !== PRIVATE_FILE.dirMode) {
		await chmod(path, PRIVATE_FILE.dirMode);
	}
	return path;
}

/**
 * Replaces `path` with `data` so a reader sees either the old file or the new one, never half of it.
 *
 * Writes a temp file in the same directory, flushes it to disk, then renames it over the target.
 * Parent directories are created as needed. Every settings and index write in pk goes through here.
 */
export async function atomicWriteFile(
	path: string,
	data: string | Uint8Array,
	options: AtomicWriteOptions = {},
): Promise<void> {
	const dir = dirname(path);
	await mkdir(dir, { recursive: true, mode: options.dirMode });
	const temp = join(
		dir,
		`.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
	);

	const handle = await open(temp, "wx", options.mode ?? 0o644);
	try {
		await handle.writeFile(data);
		await handle.sync();
	} catch (error) {
		await handle.close().catch(() => {});
		await rm(temp, { force: true });
		throw error;
	}
	await handle.close();

	try {
		await rename(temp, path);
	} catch (error) {
		await rm(temp, { force: true });
		throw error;
	}

	// Make the rename itself durable. Best effort: some file systems refuse to open a directory.
	try {
		const dirHandle = await open(dir, "r");
		try {
			await dirHandle.sync();
		} finally {
			await dirHandle.close();
		}
	} catch {
		// ignored on purpose
	}
}

/**
 * Appends one record as a single JSON line.
 *
 * The whole line goes out in one append (`O_APPEND`) write, so concurrent pk processes and crashes
 * leave at worst a torn last line, never interleaved records. Readers skip a line that does not parse.
 * When a non empty file does not end in a newline (a torn line from a crash), the write starts with
 * one, so the new record never glues onto the torn one. Callers redact before appending.
 */
export async function appendJsonl(
	path: string,
	record: unknown,
	options: AtomicWriteOptions = {},
): Promise<void> {
	const line = JSON.stringify(record);
	if (line === undefined) {
		throw new PkError(
			"env.not_serializable",
			"appendJsonl: the record is not JSON serializable",
		);
	}
	await mkdir(dirname(path), { recursive: true, mode: options.dirMode });
	const lead = (await endsTorn(path)) ? "\n" : "";
	await appendFile(path, `${lead}${line}\n`, {
		encoding: "utf8",
		flag: "a",
		mode: options.mode ?? 0o644,
	});
}

/** True when `path` exists, is not empty, and its last byte is not a newline. */
async function endsTorn(path: string): Promise<boolean> {
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(path, "r");
	} catch {
		return false; // missing: the append creates it
	}
	try {
		const { size } = await handle.stat();
		if (size === 0) return false;
		const last = Buffer.alloc(1);
		await handle.read(last, 0, 1, size - 1);
		return last[0] !== 0x0a;
	} finally {
		await handle.close();
	}
}
