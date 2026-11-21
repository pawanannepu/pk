import * as nodeFs from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { paths } from "@pk/env";

/**
 * The OpenTUI native library home (spec 0001, "Process behavior", "Native library home").
 *
 * A compiled pk embeds OpenTUI's native library, and Bun can only load it from a real file. Bun
 * writes that file into `BUN_TMPDIR` (else `TMPDIR`), read once at startup, and trusts a file that
 * is already there if only its size matches. A shared `/tmp` would let another local user plant a
 * library, so pk keeps it in a private folder, `<cache>/native/<id>/`, and replaces itself
 * (`process.execve`, same PID) with `BUN_TMPDIR` pointing there. The folder is trusted because only
 * your user id can write to it, not because of any content check.
 */

/** Replaced by scripts/build.ts (`define`) with `<opentui version>-<12 hex of the library's SHA 256>`. */
declare const PK_NATIVE_ID: string | undefined;

/** The image after the exec has this set to the private folder. Deleted again by the restore. */
export const NATIVE_DIR_MARKER = "PK_NATIVE_DIR";
/** Your own `BUN_TMPDIR` as JSON (`null` when unset), carried across the exec and restored. */
export const USER_BUN_TMPDIR = "PK_USER_BUN_TMPDIR";

/** How old another native library folder must be before pk removes it. */
export const NATIVE_CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface NativeStat {
	readonly uid: number;
	readonly mode: number;
	readonly mtimeMs: number;
	isDirectory(): boolean;
	isSymbolicLink(): boolean;
}

/** The file system calls the native home needs. Injectable so tests can fake owners and modes. */
export interface NativeFs {
	lstat(path: string): NativeStat;
	mkdir(path: string, mode: number): void;
	realpath(path: string): string;
	readdir(path: string): readonly string[];
	/** Removes a file, link or folder without following links. */
	remove(path: string): void;
}

export const realNativeFs: NativeFs = {
	lstat: (path) => nodeFs.lstatSync(path),
	mkdir: (path, mode) => nodeFs.mkdirSync(path, { mode }),
	realpath: (path) => nodeFs.realpathSync(path),
	readdir: (path) => nodeFs.readdirSync(path),
	remove: (path) => nodeFs.rmSync(path, { recursive: true, force: true }),
};

export type ExecveFn = (
	file: string,
	args: readonly string[],
	env: Record<string, string>,
) => void;

export interface NativeHomeDeps {
	/** The live environment. The restore edits it in place. */
	readonly env: Record<string, string | undefined>;
	/** `Bun.main`. A compiled binary's starts with `/$bunfs/`. */
	readonly main: string;
	readonly execPath: string;
	readonly argv: readonly string[];
	readonly nativeId: string | undefined;
	readonly euid: number;
	readonly platform: NodeJS.Platform;
	readonly homedir: () => string;
	readonly execve: ExecveFn | undefined;
	readonly fs: NativeFs;
}

export function realNativeHomeDeps(): NativeHomeDeps {
	return {
		env: process.env,
		main: Bun.main,
		execPath: process.execPath,
		argv: process.argv,
		nativeId: typeof PK_NATIVE_ID === "string" ? PK_NATIVE_ID : undefined,
		euid: process.geteuid?.() ?? -1,
		platform: process.platform,
		homedir,
		execve:
			typeof process.execve === "function"
				? (file, args, env) => process.execve?.(file, args, env)
				: undefined,
		fs: realNativeFs,
	};
}

export type NativeHome =
	/** From source: OpenTUI loads from node_modules, nothing to do. */
	| { readonly kind: "source" }
	/** After the exec and the restore: the library will load from `dir`. */
	| { readonly kind: "ready"; readonly root: string; readonly dir: string }
	/** An exec was started. The real `execve` never returns, so only tests see this. */
	| { readonly kind: "exec"; readonly dir: string }
	/** Fail closed: print `message` (one line) and exit 1. */
	| { readonly kind: "failed"; readonly message: string };

/** Thrown inside this module to carry one fail closed message to the top. */
class NativeHomeError extends Error {}
const fail = (message: string): never => {
	throw new NativeHomeError(message);
};

export const COMPILED_PREFIX = "/$bunfs/";

/**
 * Makes sure OpenTUI's native library will load from pk's private folder. Runs first thing in every
 * action handler that loads `@pk/tui`, before the logger, the process guard, or any use of stdio.
 * In a compiled binary it either replaces the process (exec) or, in the image after the exec,
 * restores your environment and returns the folder.
 */
export function ensureNativeHome(deps: NativeHomeDeps): NativeHome {
	if (!deps.main.startsWith(COMPILED_PREFIX)) return { kind: "source" };
	try {
		if (typeof deps.execve !== "function") {
			fail(
				"this pk build cannot restart itself (process.execve is missing), so it cannot load its UI safely",
			);
		}
		const id = deps.nativeId;
		if (!id || !/^[A-Za-z0-9._-]+$/.test(id) || id === "." || id === "..") {
			fail(
				"this pk binary was built without a native library id; rebuild it with scripts/build.ts",
			);
		}
		const { root, dir } = prepareNativeDir(deps, id as string);

		if (deps.env[NATIVE_DIR_MARKER] === dir && deps.env.BUN_TMPDIR === dir) {
			// The image after the exec: Bun already read BUN_TMPDIR, so hand you your own back.
			// The caller runs recheckNativeHome() once more right before importing @pk/tui.
			restoreUserEnv(deps.env);
			return { kind: "ready", root, dir };
		}

		execIntoNativeHome(deps, dir);
		return { kind: "exec", dir };
	} catch (error) {
		if (error instanceof NativeHomeError) {
			return { kind: "failed", message: error.message };
		}
		throw error;
	}
}

/**
 * The trusted path check once more, right before `import("@pk/tui")` in the image after the exec.
 * Returns a fail closed message, or undefined when the folder is still the one Bun was given.
 */
export function recheckNativeHome(
	deps: NativeHomeDeps,
	home: { readonly dir: string },
): string | undefined {
	try {
		const id = deps.nativeId ?? "";
		const { dir } = prepareNativeDir(deps, id);
		if (dir !== home.dir) {
			fail(
				`the pk cache folder moved while pk was starting (${home.dir}); run pk again`,
			);
		}
		return undefined;
	} catch (error) {
		if (error instanceof NativeHomeError) return error.message;
		throw error;
	}
}

/** Resolves the absolute cache folder pk uses, failing closed when there is no usable home. */
export function resolveCacheDir(deps: NativeHomeDeps): string {
	const pkHome = deps.env.PK_HOME;
	let home = "";
	if (!pkHome) {
		try {
			home = deps.homedir();
		} catch {
			home = "";
		}
		if (!home || !isAbsolute(home)) {
			fail("pk cannot find your home folder; set PK_HOME to a folder you own");
		}
	}
	const cache = paths({ env: deps.env, platform: deps.platform, home }).cache;
	return resolve(cache);
}

/**
 * Creates `<cache>/native/<id>/` if missing and checks the whole path can be trusted. Returns the
 * resolved native root and target folder (no links anywhere in them).
 */
export function prepareNativeDir(
	deps: NativeHomeDeps,
	id: string,
): { root: string; dir: string } {
	const cache = resolveCacheDir(deps);
	createMissing(deps.fs, cache);
	let realCache: string;
	try {
		realCache = deps.fs.realpath(cache);
	} catch (error) {
		return fail(
			`pk cannot open ${cache} (${errorCode(error)}); set PK_HOME to a folder you own`,
		);
	}
	checkAncestors(deps, realCache);

	const root = join(realCache, "native");
	const dir = join(root, id);
	for (const folder of [root, dir]) {
		makeFolder(deps.fs, folder);
		checkPrivateFolder(deps, folder);
	}
	return { root, dir };
}

/** Creates each missing folder from the top down, one level at a time, mode 0700. */
function createMissing(fs: NativeFs, target: string): void {
	const missing: string[] = [];
	let current = target;
	while (!exists(fs, current)) {
		missing.unshift(current);
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	for (const folder of missing) makeFolder(fs, folder);
}

function exists(fs: NativeFs, path: string): boolean {
	try {
		fs.lstat(path);
		return true;
	} catch (error) {
		if (errorCode(error) === "ENOENT") return false;
		return fail(
			`pk cannot read ${path} (${errorCode(error)}); set PK_HOME to a folder you own`,
		);
	}
}

/** mkdir with mode 0700, tolerating a folder another pk created first. */
function makeFolder(fs: NativeFs, folder: string): void {
	try {
		fs.mkdir(folder, 0o700);
	} catch (error) {
		if (errorCode(error) === "EEXIST") return;
		fail(
			`pk cannot create ${folder} (${errorCode(error)}); set PK_HOME to a folder you can write to`,
		);
	}
}

/**
 * Every folder from `/` down to `path` must be owned by you or by root, and must not be writable by
 * group or others unless its sticky bit is set.
 */
export function checkAncestors(deps: NativeHomeDeps, path: string): void {
	for (const folder of ancestorsOf(path)) {
		const info = lstatOrFail(deps.fs, folder);
		if (info.uid !== deps.euid && info.uid !== 0) {
			fail(
				`${folder} belongs to another user; set PK_HOME to a folder you own`,
			);
		}
		const sticky = (info.mode & 0o1000) !== 0;
		if ((info.mode & 0o022) !== 0 && !sticky) {
			fail(
				`${folder} can be changed by other users; set PK_HOME to a folder only you can change`,
			);
		}
	}
}

/** `/a/b/c` → `["/", "/a", "/a/b", "/a/b/c"]`. */
export function ancestorsOf(path: string): string[] {
	const parts = path.split(sep).filter(Boolean);
	const out: string[] = [sep];
	let current = "";
	for (const part of parts) {
		current = `${current}${sep}${part}`;
		out.push(current);
	}
	return out;
}

/** `<native>` and `<native>/<id>` must be real folders you own, mode 0700 exactly in the user bits. */
export function checkPrivateFolder(deps: NativeHomeDeps, folder: string): void {
	const info = lstatOrFail(deps.fs, folder);
	if (info.isSymbolicLink()) {
		fail(
			`${folder} is a symlink, but pk needs a real folder there; remove it and run pk again`,
		);
	}
	if (!info.isDirectory()) {
		fail(`${folder} is not a folder; remove it and run pk again`);
	}
	if (info.uid !== deps.euid) {
		fail(`${folder} belongs to another user; set PK_HOME to a folder you own`);
	}
	if ((info.mode & 0o700) !== 0o700 || (info.mode & 0o077) !== 0) {
		fail(`${folder} is open to other users; run \`chmod 700 ${folder}\``);
	}
}

function lstatOrFail(fs: NativeFs, folder: string): NativeStat {
	try {
		return fs.lstat(folder);
	} catch (error) {
		return fail(
			`pk cannot read ${folder} (${errorCode(error)}); set PK_HOME to a folder you own`,
		);
	}
}

/** Replaces the process with itself, `BUN_TMPDIR` set to the private folder. */
function execIntoNativeHome(deps: NativeHomeDeps, dir: string): void {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(deps.env)) {
		if (typeof value === "string") env[key] = value;
	}
	env.BUN_TMPDIR = dir;
	env[NATIVE_DIR_MARKER] = dir;
	env[USER_BUN_TMPDIR] = JSON.stringify(deps.env.BUN_TMPDIR ?? null);
	// argv[1] in a compiled binary is the internal /$bunfs/... path, so it is dropped.
	const args = [deps.execPath, ...deps.argv.slice(2)];
	try {
		deps.execve?.(deps.execPath, args, env);
	} catch (error) {
		const code = errorCode(error);
		if (code === "ENOENT" || code === "EACCES") {
			fail("pk was updated while starting; run it again");
		}
		fail(`pk could not restart itself to load its UI (${code})`);
	}
}

/** Puts your own `BUN_TMPDIR` back (unset, empty or a value) and removes pk's markers. */
export function restoreUserEnv(env: Record<string, string | undefined>): void {
	const saved = env[USER_BUN_TMPDIR];
	let original: unknown = null;
	try {
		original = saved === undefined ? null : JSON.parse(saved);
	} catch {
		original = null;
	}
	if (typeof original === "string") env.BUN_TMPDIR = original;
	else delete env.BUN_TMPDIR;
	delete env[USER_BUN_TMPDIR];
	delete env[NATIVE_DIR_MARKER];
}

/**
 * Removes other entries in `<native>` more than 7 days old that you own, never following links.
 * Best effort: returns what it could not remove so the caller can log a warning.
 */
export function cleanupNativeHome(
	fs: NativeFs,
	home: { root: string; dir: string },
	euid: number,
	now: number = Date.now(),
): { removed: string[]; failed: string[] } {
	const removed: string[] = [];
	const failed: string[] = [];
	let names: readonly string[];
	try {
		names = fs.readdir(home.root);
	} catch {
		return { removed, failed: [home.root] };
	}
	for (const name of names) {
		const entry = join(home.root, name);
		if (entry === home.dir) continue;
		try {
			const info = fs.lstat(entry);
			if (info.uid !== euid || now - info.mtimeMs <= NATIVE_CLEANUP_AGE_MS)
				continue;
			fs.remove(entry);
			removed.push(entry);
		} catch {
			failed.push(entry);
		}
	}
	return { removed, failed };
}

/** True when `error` looks like the OS refusing to load the native library from the folder. */
export function isNativeLoadFailure(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /failed to open library|dlopen|cannot open shared object|operation not permitted/i.test(
		message,
	);
}

export function nativeLoadFailureMessage(dir: string): string {
	return `pk could not load its UI library from ${dir}; the cache folder may be on a noexec mount; set PK_HOME`;
}

function errorCode(error: unknown): string {
	if (error && typeof error === "object" && "code" in error) {
		return String((error as { code: unknown }).code);
	}
	return error instanceof Error ? error.message : String(error);
}
