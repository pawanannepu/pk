import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ancestorsOf,
	cleanupNativeHome,
	ensureNativeHome,
	isNativeLoadFailure,
	NATIVE_CLEANUP_AGE_MS,
	NATIVE_DIR_MARKER,
	type NativeFs,
	type NativeHomeDeps,
	type NativeStat,
	nativeLoadFailureMessage,
	realNativeFs,
	recheckNativeHome,
	restoreUserEnv,
	USER_BUN_TMPDIR,
} from "./native-home.ts";

const ME = 501;
const OTHER = 777;
const ROOT = 0;
const ID = "0.9.7-abcdef123456";

type Entry = {
	type: "dir" | "file" | "link";
	uid: number;
	mode: number;
	mtimeMs: number;
	target?: string;
};

const errno = (code: string): Error => Object.assign(new Error(code), { code });

/** An in-memory file system with owners, modes and symlinks, so tests can fake root and others. */
function fakeFs(euid = ME) {
	const entries = new Map<string, Entry>();
	const removed: string[] = [];
	const parentOf = (path: string) =>
		path.slice(0, path.lastIndexOf("/")) || "/";
	const resolveLinks = (path: string): string => {
		let current = "";
		for (const part of path.split("/").filter(Boolean)) {
			current = `${current}/${part}`;
			const entry = entries.get(current);
			if (entry?.type === "link" && entry.target) {
				current = resolveLinks(entry.target);
			}
		}
		return current || "/";
	};
	const stat = (entry: Entry): NativeStat => ({
		uid: entry.uid,
		mode: entry.mode,
		mtimeMs: entry.mtimeMs,
		isDirectory: () => entry.type === "dir",
		isSymbolicLink: () => entry.type === "link",
	});

	const fs: NativeFs = {
		lstat: (path) => {
			const parent = resolveLinks(parentOf(path));
			const entry = entries.get(
				path === "/"
					? "/"
					: `${parent === "/" ? "" : parent}/${path.split("/").pop()}`,
			);
			if (!entry) throw errno("ENOENT");
			return stat(entry);
		},
		mkdir: (path, mode) => {
			const real = resolveLinks(parentOf(path));
			const parent = entries.get(real);
			if (parent?.type !== "dir") throw errno("ENOENT");
			if (
				(parent.mode & 0o200) === 0 ||
				(parent.uid !== euid && (parent.mode & 0o002) === 0)
			) {
				throw errno("EACCES");
			}
			const full = `${real === "/" ? "" : real}/${path.split("/").pop()}`;
			if (entries.has(full)) throw errno("EEXIST");
			entries.set(full, { type: "dir", uid: euid, mode, mtimeMs: Date.now() });
		},
		realpath: (path) => {
			const real = resolveLinks(path);
			if (!entries.has(real)) throw errno("ENOENT");
			return real;
		},
		readdir: (path) => {
			const prefix = `${resolveLinks(path)}/`;
			return [...entries.keys()]
				.filter(
					(key) =>
						key.startsWith(prefix) && !key.slice(prefix.length).includes("/"),
				)
				.map((key) => key.slice(prefix.length));
		},
		remove: (path) => {
			removed.push(path);
			for (const key of [...entries.keys()]) {
				if (key === path || key.startsWith(`${path}/`)) entries.delete(key);
			}
		},
	};

	const add = (path: string, entry: Partial<Entry> = {}) => {
		entries.set(path, {
			type: "dir",
			uid: euid,
			mode: 0o700,
			mtimeMs: Date.now(),
			...entry,
		});
	};
	// A plain machine: / and /home are root's, /home/me is yours.
	add("/", { uid: ROOT, mode: 0o755 });
	add("/home", { uid: ROOT, mode: 0o755 });
	add("/home/me", { mode: 0o750 });
	add("/tmp", { uid: ROOT, mode: 0o1777 });
	return { fs, entries, add, removed };
}

function deps(
	fs: NativeFs,
	over: Partial<NativeHomeDeps> & {
		env?: Record<string, string | undefined>;
	} = {},
) {
	const execs: Array<{
		file: string;
		args: readonly string[];
		env: Record<string, string>;
	}> = [];
	const d: NativeHomeDeps = {
		env: { PK_HOME: "/home/me/.pk" },
		main: "/$bunfs/root/pk",
		execPath: "/usr/local/bin/pk",
		argv: [
			"/usr/local/bin/pk",
			"/$bunfs/root/pk",
			"__tui-smoke",
			"--duration",
			"5",
		],
		nativeId: ID,
		euid: ME,
		platform: "darwin",
		homedir: () => "/home/me",
		execve: (file, args, env) => {
			execs.push({ file, args, env });
		},
		fs,
		...over,
	};
	return { d, execs };
}

const DIR = `/home/me/.pk/native/${ID}`;

describe("ensureNativeHome: when it runs", () => {
	test("from source it does nothing", () => {
		const { fs, entries } = fakeFs();
		const { d, execs } = deps(fs, { main: "/repo/packages/cli/src/main.ts" });
		expect(ensureNativeHome(d)).toEqual({ kind: "source" });
		expect(execs).toHaveLength(0);
		expect(entries.has("/home/me/.pk")).toBe(false);
	});

	test("a compiled binary without process.execve fails closed", () => {
		const { fs } = fakeFs();
		const { d } = deps(fs, { execve: undefined });
		const result = ensureNativeHome(d);
		expect(result.kind).toBe("failed");
		expect(result.kind === "failed" && result.message).toContain(
			"process.execve",
		);
	});

	test("a binary built without a native id fails closed", () => {
		for (const nativeId of [undefined, "", "..", "a/b"]) {
			const { fs } = fakeFs();
			const result = ensureNativeHome(deps(fs, { nativeId }).d);
			expect(result.kind === "failed" && result.message).toContain(
				"native library id",
			);
		}
	});
});

describe("ensureNativeHome: exec and loop guard", () => {
	test("first run creates the private folder (0700) and execs into it", () => {
		const { fs, entries } = fakeFs();
		const { d, execs } = deps(fs, {
			env: { PK_HOME: "/home/me/.pk", KEEP: "1", GONE: undefined },
		});
		expect(ensureNativeHome(d)).toEqual({ kind: "exec", dir: DIR });
		for (const folder of ["/home/me/.pk", "/home/me/.pk/native", DIR]) {
			expect(entries.get(folder)?.mode).toBe(0o700);
		}
		expect(execs).toHaveLength(1);
		const [exec] = execs;
		expect(exec?.file).toBe("/usr/local/bin/pk");
		// argv[1] (the /$bunfs path) is dropped
		expect(exec?.args).toEqual([
			"/usr/local/bin/pk",
			"__tui-smoke",
			"--duration",
			"5",
		]);
		expect(exec?.env.BUN_TMPDIR).toBe(DIR);
		expect(exec?.env[NATIVE_DIR_MARKER]).toBe(DIR);
		expect(exec?.env[USER_BUN_TMPDIR]).toBe("null");
		expect(exec?.env.KEEP).toBe("1");
		expect("GONE" in (exec?.env ?? {})).toBe(false);
	});

	test("your own BUN_TMPDIR is carried as JSON, keeping empty and set apart", () => {
		for (const [value, json] of [
			["", '""'],
			["/my/tmp", '"/my/tmp"'],
		] as const) {
			const { fs } = fakeFs();
			const { d, execs } = deps(fs, {
				env: { PK_HOME: "/home/me/.pk", BUN_TMPDIR: value },
			});
			ensureNativeHome(d);
			expect(execs[0]?.env[USER_BUN_TMPDIR]).toBe(json);
			expect(execs[0]?.env.BUN_TMPDIR).toBe(DIR);
		}
	});

	test("after the exec it restores your environment and does not exec again", () => {
		for (const [saved, expected] of [
			["null", undefined],
			['""', ""],
			['"/my/tmp"', "/my/tmp"],
		] as const) {
			const { fs } = fakeFs();
			const env: Record<string, string | undefined> = {
				PK_HOME: "/home/me/.pk",
				BUN_TMPDIR: DIR,
				[NATIVE_DIR_MARKER]: DIR,
				[USER_BUN_TMPDIR]: saved,
			};
			const { d, execs } = deps(fs, { env });
			expect(ensureNativeHome(d)).toEqual({
				kind: "ready",
				root: "/home/me/.pk/native",
				dir: DIR,
			});
			expect(execs).toHaveLength(0);
			expect(env.BUN_TMPDIR).toBe(expected);
			expect("BUN_TMPDIR" in env).toBe(expected !== undefined);
			expect(NATIVE_DIR_MARKER in env).toBe(false);
			expect(USER_BUN_TMPDIR in env).toBe(false);
		}
	});

	test("a stale marker alone is not trusted: it still execs", () => {
		for (const bunTmp of [undefined, "/tmp/elsewhere"]) {
			const { fs } = fakeFs();
			const { d, execs } = deps(fs, {
				env: {
					PK_HOME: "/home/me/.pk",
					[NATIVE_DIR_MARKER]: DIR,
					BUN_TMPDIR: bunTmp,
				},
			});
			expect(ensureNativeHome(d).kind).toBe("exec");
			expect(execs[0]?.env.BUN_TMPDIR).toBe(DIR);
			expect(execs[0]?.env[USER_BUN_TMPDIR]).toBe(
				JSON.stringify(bunTmp ?? null),
			);
		}
	});

	test("a binary that vanished mid start asks you to run pk again", () => {
		for (const code of ["ENOENT", "EACCES"]) {
			const { fs } = fakeFs();
			const { d } = deps(fs, {
				execve: () => {
					throw errno(code);
				},
			});
			const result = ensureNativeHome(d);
			expect(result.kind === "failed" && result.message).toBe(
				"pk was updated while starting; run it again",
			);
		}
		const { fs } = fakeFs();
		const result = ensureNativeHome(
			deps(fs, {
				execve: () => {
					throw errno("E2BIG");
				},
			}).d,
		);
		expect(result.kind === "failed" && result.message).toContain(
			"could not restart",
		);
	});
});

describe("ensureNativeHome: trusted path check", () => {
	const failure = (d: NativeHomeDeps): string => {
		const result = ensureNativeHome(d);
		expect(result.kind).toBe("failed");
		return result.kind === "failed" ? result.message : "";
	};

	test("no home folder and no PK_HOME fails closed", () => {
		for (const homedir of [
			() => "",
			() => "relative/home",
			() => {
				throw new Error("no passwd entry");
			},
		]) {
			const { fs } = fakeFs();
			expect(failure(deps(fs, { env: {}, homedir }).d)).toContain(
				"set PK_HOME",
			);
		}
	});

	test("without PK_HOME it uses the platform cache folder", () => {
		const { fs } = fakeFs();
		const linux = deps(fs, { env: {}, platform: "linux" });
		expect(ensureNativeHome(linux.d)).toEqual({
			kind: "exec",
			dir: `/home/me/.cache/pk/native/${ID}`,
		});
	});

	test("a relative PK_HOME is made absolute first", () => {
		const { fs, entries, add } = fakeFs();
		// The real cwd already exists on a real machine, so put it in the fake as yours.
		// Widening "/" is not enough: on a Linux runner cwd is under /home, which the fake seeds as root's 0755.
		for (const dir of ancestorsOf(process.cwd())) {
			if (!entries.has(dir)) add(dir);
		}
		const result = ensureNativeHome(deps(fs, { env: { PK_HOME: "rel/pk" } }).d);
		expect(result.kind).toBe("exec");
		expect(
			result.kind === "exec" &&
				result.dir.startsWith(`${process.cwd()}/rel/pk/`),
		).toBe(true);
	});

	test("a native folder owned by another user fails closed", () => {
		const { fs, add } = fakeFs();
		add("/home/me/.pk");
		add("/home/me/.pk/native", { uid: OTHER });
		expect(failure(deps(fs).d)).toBe(
			"/home/me/.pk/native belongs to another user; set PK_HOME to a folder you own",
		);
	});

	test("loose permissions on either folder fail closed with a chmod hint", () => {
		for (const [folder, mode] of [
			["/home/me/.pk/native", 0o755],
			[DIR, 0o750],
			[DIR, 0o500],
		] as const) {
			const { fs, add } = fakeFs();
			add("/home/me/.pk");
			add("/home/me/.pk/native");
			add(folder, { mode });
			expect(failure(deps(fs).d)).toBe(
				`${folder} is open to other users; run \`chmod 700 ${folder}\``,
			);
		}
	});

	test("a symlink where a folder must be fails closed and nothing is written at its target", () => {
		const { fs, add, entries } = fakeFs();
		add("/home/me/.pk");
		add("/tmp/planted", { uid: ME, mode: 0o700 });
		add("/home/me/.pk/native", { type: "link", target: "/tmp/planted" });
		expect(failure(deps(fs).d)).toContain("/home/me/.pk/native is a symlink");
		expect(
			[...entries.keys()].some((key) => key.startsWith("/tmp/planted/")),
		).toBe(false);
	});

	test("a file where a folder must be fails closed", () => {
		const { fs, add } = fakeFs();
		add("/home/me/.pk");
		add("/home/me/.pk/native", { type: "file", mode: 0o600 });
		expect(failure(deps(fs).d)).toContain("is not a folder");
	});

	test("an ancestor others can change fails closed, unless its sticky bit is set", () => {
		const open = fakeFs();
		open.add("/shared", { uid: ROOT, mode: 0o777 });
		expect(failure(deps(open.fs, { env: { PK_HOME: "/shared/pk" } }).d)).toBe(
			"/shared can be changed by other users; set PK_HOME to a folder only you can change",
		);

		const groupWritable = fakeFs();
		groupWritable.add("/home/me", { mode: 0o770 });
		expect(failure(deps(groupWritable.fs).d)).toContain(
			"/home/me can be changed by other users",
		);

		const sticky = fakeFs();
		const { d } = deps(sticky.fs, { env: { PK_HOME: "/tmp/pk" } });
		expect(ensureNativeHome(d).kind).toBe("exec");
	});

	test("an ancestor owned by another (non root) user fails closed", () => {
		const { fs, add } = fakeFs();
		add("/home/other", { uid: OTHER, mode: 0o755 });
		add("/home/other/pk"); // yours, inside their folder: they could swap it out
		expect(
			failure(deps(fs, { env: { PK_HOME: "/home/other/pk" } }).d),
		).toContain("/home/other belongs to another user");
	});

	test("a symlinked cache parent works and the folder is the resolved path", () => {
		const { fs, add } = fakeFs();
		add("/home/me/dotfiles", { mode: 0o700 });
		add("/home/me/dotfiles/pk", { mode: 0o700 });
		add("/home/me/.pk", { type: "link", target: "/home/me/dotfiles/pk" });
		expect(ensureNativeHome(deps(fs).d)).toEqual({
			kind: "exec",
			dir: `/home/me/dotfiles/pk/native/${ID}`,
		});
	});

	test("a cache folder you cannot create in fails closed", () => {
		const { fs, add } = fakeFs();
		add("/readonly", { uid: ROOT, mode: 0o555 });
		expect(failure(deps(fs, { env: { PK_HOME: "/readonly/pk" } }).d)).toContain(
			"pk cannot create /readonly/pk (EACCES)",
		);
	});

	test("another pk creating the folder first (EEXIST) is fine", () => {
		const { fs, add } = fakeFs();
		const racing: NativeFs = {
			...fs,
			mkdir: (path, mode) => {
				add(path, { mode }); // someone else won the race
				throw errno("EEXIST");
			},
		};
		expect(ensureNativeHome(deps(racing).d)).toEqual({
			kind: "exec",
			dir: DIR,
		});
	});
});

describe("recheckNativeHome", () => {
	test("passes when nothing changed and names the problem when something did", () => {
		const { fs, entries } = fakeFs();
		const { d } = deps(fs);
		ensureNativeHome(d);
		expect(recheckNativeHome(d, { dir: DIR })).toBeUndefined();
		const folder = entries.get(DIR);
		if (folder) folder.mode = 0o777;
		expect(recheckNativeHome(d, { dir: DIR })).toContain("chmod 700");
		expect(recheckNativeHome(d, { dir: "/somewhere/else" })).toBeDefined();
	});
});

describe("restoreUserEnv", () => {
	test("unset, empty and set values come back exactly; markers go", () => {
		const cases: Array<[string | undefined, string | undefined]> = [
			[undefined, undefined],
			["null", undefined],
			['""', ""],
			['"/x"', "/x"],
			["not json", undefined],
		];
		for (const [saved, expected] of cases) {
			const env: Record<string, string | undefined> = {
				BUN_TMPDIR: DIR,
				[NATIVE_DIR_MARKER]: DIR,
				[USER_BUN_TMPDIR]: saved,
			};
			restoreUserEnv(env);
			expect(env.BUN_TMPDIR).toBe(expected);
			expect(Object.keys(env).sort()).toEqual(
				expected === undefined ? [] : ["BUN_TMPDIR"],
			);
		}
	});
});

describe("cleanupNativeHome", () => {
	test("removes only your own entries older than 7 days, never the current one", () => {
		const { fs, add, removed } = fakeFs();
		const now = Date.now();
		const old = now - NATIVE_CLEANUP_AGE_MS - 1000;
		add("/home/me/.pk");
		add("/home/me/.pk/native");
		add(DIR, { mtimeMs: old });
		add("/home/me/.pk/native/0.9.6-old", { mtimeMs: old });
		add("/home/me/.pk/native/stray-file", { type: "file", mtimeMs: old });
		add("/home/me/.pk/native/stray-link", {
			type: "link",
			target: "/home/me",
			mtimeMs: old,
		});
		add("/home/me/.pk/native/0.9.8-fresh", { mtimeMs: now - 1000 });
		add("/home/me/.pk/native/theirs", { uid: OTHER, mtimeMs: old });
		const result = cleanupNativeHome(
			fs,
			{ root: "/home/me/.pk/native", dir: DIR },
			ME,
			now,
		);
		expect(result.failed).toEqual([]);
		expect(removed.sort()).toEqual([
			"/home/me/.pk/native/0.9.6-old",
			"/home/me/.pk/native/stray-file",
			"/home/me/.pk/native/stray-link",
		]);
	});

	test("never follows a link: the folder it points at survives (real fs)", () => {
		const scratch = mkdtempSync(join(tmpdir(), "pk-native-"));
		try {
			const root = join(scratch, "native");
			const target = join(scratch, "keep");
			mkdirSync(root);
			mkdirSync(target);
			Bun.write(join(target, "file"), "x");
			symlinkSync(target, join(root, "link"));
			const result = cleanupNativeHome(
				realNativeFs,
				{ root, dir: join(root, "current") },
				process.geteuid?.() ?? -1,
				Date.now() + NATIVE_CLEANUP_AGE_MS * 2,
			);
			expect(result.removed).toEqual([join(root, "link")]);
			expect(realNativeFs.readdir(target)).toEqual(["file"]);
		} finally {
			rmSync(scratch, { recursive: true, force: true });
		}
	});
});

describe("helpers", () => {
	test("ancestorsOf lists every folder from the root down", () => {
		expect(ancestorsOf("/a/b/c")).toEqual(["/", "/a", "/a/b", "/a/b/c"]);
		expect(ancestorsOf("/")).toEqual(["/"]);
	});

	test("a library load failure is recognized and gets the noexec hint", () => {
		expect(
			isNativeLoadFailure(new Error('Failed to open library "x.so"')),
		).toBe(true);
		expect(isNativeLoadFailure(new Error("something else"))).toBe(false);
		expect(nativeLoadFailureMessage("/c/native/id")).toContain(
			"noexec mount; set PK_HOME",
		);
	});
});
