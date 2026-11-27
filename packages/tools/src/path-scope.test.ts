import { describe, expect, test } from "bun:test";
import { isPkError } from "@pk/env";
import { resolveInProject } from "./path-scope.ts";
import type { FileSystem } from "./tool.ts";

const fsError = (code: string) => Object.assign(new Error(code), { code });

/**
 * A fake file system: `links` maps a path to its real path, `existing` lists the real paths that
 * exist. Every realpath call is recorded.
 */
function fakeFs(
	existing: readonly string[],
	links: Readonly<Record<string, string>> = {},
	fail: Readonly<Record<string, string>> = {},
): FileSystem & { calls: string[] } {
	const calls: string[] = [];
	const linkOf = (path: string): string => {
		for (const [from, to] of Object.entries(links)) {
			if (path === from) return to;
			if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
		}
		return path;
	};
	return {
		calls,
		realpath: async (path) => {
			calls.push(path);
			const code = fail[path];
			if (code !== undefined) throw fsError(code);
			const real = linkOf(path);
			if (existing.includes(real)) return real;
			throw fsError("ENOENT");
		},
		stat: async () => {
			throw new Error("not used");
		},
		readFile: async () => {
			throw new Error("not used");
		},
	};
}

const ROOT = "/proj";
const FILES = ["/", ROOT, `${ROOT}/a.txt`, `${ROOT}/src`, "/etc", "/etc/hosts"];

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
	try {
		await promise;
		return undefined;
	} catch (error) {
		return isPkError(error) ? error.code : "not a PkError";
	}
}

describe("resolveInProject (spec 0005 AC-12)", () => {
	test("a relative path inside resolves to its real path and a root relative display", async () => {
		const scoped = await resolveInProject("a.txt", ROOT, fakeFs(FILES), "t");
		expect(scoped).toEqual({
			real: `${ROOT}/a.txt`,
			display: "a.txt",
			exists: true,
		});
	});

	test("the root itself displays as .", async () => {
		const scoped = await resolveInProject(".", ROOT, fakeFs(FILES), "t");
		expect(scoped.display).toBe(".");
	});

	test("a .. that stays inside is fine, relative or absolute", async () => {
		const fs = fakeFs(FILES);
		expect(
			(await resolveInProject("src/../a.txt", ROOT, fs, "t")).display,
		).toBe("a.txt");
		expect(
			(await resolveInProject(`${ROOT}/src/../a.txt`, ROOT, fs, "t")).display,
		).toBe("a.txt");
	});

	test("a relative path leaving through .. is refused before the disk is touched", async () => {
		const fs = fakeFs(FILES);
		expect(await codeOf(resolveInProject("../etc/hosts", ROOT, fs, "t"))).toBe(
			"tool.outside_project",
		);
		expect(await codeOf(resolveInProject("..", ROOT, fs, "t"))).toBe(
			"tool.outside_project",
		);
		expect(fs.calls).toEqual([]);
	});

	test("the refusal text names the input, the root and the tool", async () => {
		let message = "";
		try {
			await resolveInProject("/etc/hosts", ROOT, fakeFs(FILES), "read_file");
		} catch (error) {
			message = error instanceof Error ? error.message : "";
		}
		expect(message).toBe(
			"/etc/hosts is outside the project (/proj). read_file can only read files inside the project for now.",
		);
	});

	test("a sibling folder whose name starts with the root's name is still outside", async () => {
		const fs = fakeFs([...FILES, "/proj2", "/proj2/x.txt"]);
		expect(await codeOf(resolveInProject("/proj2/x.txt", ROOT, fs, "t"))).toBe(
			"tool.outside_project",
		);
	});

	test("a missing file inside is not outside: it resolves with exists false", async () => {
		const scoped = await resolveInProject(
			"src/new/deep.txt",
			ROOT,
			fakeFs(FILES),
			"t",
		);
		expect(scoped).toEqual({
			real: `${ROOT}/src/new/deep.txt`,
			display: "src/new/deep.txt",
			exists: false,
		});
	});

	test("a missing file under a symlinked folder that points out is refused", async () => {
		const fs = fakeFs(FILES, { [`${ROOT}/out`]: "/etc" });
		expect(await codeOf(resolveInProject("out/nope.txt", ROOT, fs, "t"))).toBe(
			"tool.outside_project",
		);
	});

	test("a root under a symlink (like /tmp on macOS) accepts both absolute forms", async () => {
		const real = ["/", "/private/tmp/p", "/private/tmp/p/a.txt"];
		const links = { "/tmp": "/private/tmp" };
		for (const input of ["/tmp/p/a.txt", "/private/tmp/p/a.txt", "a.txt"]) {
			const scoped = await resolveInProject(
				input,
				"/tmp/p",
				fakeFs(real, links),
				"t",
			);
			expect(scoped).toEqual({
				real: "/private/tmp/p/a.txt",
				display: "a.txt",
				exists: true,
			});
		}
	});

	test("no permission on the path is tool.access_denied", async () => {
		const fs = fakeFs(FILES, {}, { [`${ROOT}/a.txt`]: "EACCES" });
		expect(await codeOf(resolveInProject("a.txt", ROOT, fs, "t"))).toBe(
			"tool.access_denied",
		);
	});

	test("an unexpected file system error is not hidden as a tool error", async () => {
		const fs = fakeFs(FILES, {}, { [`${ROOT}/a.txt`]: "ELOOP" });
		expect(await codeOf(resolveInProject("a.txt", ROOT, fs, "t"))).toBe(
			"not a PkError",
		);
	});

	test("~ is not expanded: it is a folder name inside the project", async () => {
		const scoped = await resolveInProject("~/x", ROOT, fakeFs(FILES), "t");
		expect(scoped.display).toBe("~/x");
		expect(scoped.exists).toBe(false);
	});
});
