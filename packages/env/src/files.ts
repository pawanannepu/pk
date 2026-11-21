import { randomBytes } from "node:crypto";
import { appendFile, mkdir, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface AtomicWriteOptions {
	/** File mode for a newly created file, for example `0o600` for anything sensitive. */
	readonly mode?: number;
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
	await mkdir(dir, { recursive: true });
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
 * leave at worst a torn last line, never interleaved records. Readers should skip a final line that
 * does not parse. Callers redact before appending.
 */
export async function appendJsonl(
	path: string,
	record: unknown,
): Promise<void> {
	const line = JSON.stringify(record);
	if (line === undefined) {
		throw new TypeError("appendJsonl: record is not JSON serializable");
	}
	await mkdir(dirname(path), { recursive: true });
	await appendFile(path, `${line}\n`, { encoding: "utf8", flag: "a" });
}
