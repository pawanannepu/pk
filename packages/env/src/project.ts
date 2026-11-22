import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";

/**
 * The project root for `cwd`: the nearest folder, starting at `cwd`, that holds `.pk` or `.git`. Your
 * home folder never counts (on macOS `~/.pk` is pk's own data folder), and inside home the walk stops
 * below it. Outside home it walks up to `/`. With no match it returns `cwd`.
 *
 * `cwd` is already a realpath from the caller, and `exists` is synchronous.
 */
export function findProjectRoot(
	cwd: string,
	home: string,
	exists: (path: string) => boolean,
): string {
	const homeDir = resolve(home);
	let dir = resolve(cwd);
	// `dirname` walks whole path segments, so `/Users/ab` never matches a home of `/Users/a`.
	while (dir !== homeDir) {
		if (exists(join(dir, ".pk")) || exists(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return cwd;
}

/**
 * The project's folder name under `<state>/sessions/`: `<slug>-<8 hex>`. The slug is the root's
 * basename, lowercased, with every run outside `a-z0-9` turned into `-`, trimmed of `-`, cut to 40
 * characters and trimmed again (`root` if empty). The hex is the start of the SHA 256 of `root`
 * exactly as given, so two folders with the same name get different keys.
 */
export function projectKey(root: string): string {
	const trim = (s: string) => s.replace(/^-+|-+$/g, "");
	const slug =
		trim(
			trim(
				basename(root)
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, "-"),
			).slice(0, 40),
		) || "root";
	const hex = createHash("sha256").update(root).digest("hex").slice(0, 8);
	return `${slug}-${hex}`;
}

/** The SHA 256 of some bytes as lowercase hex, for blob names (`toStoredMessage`). */
export function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}
