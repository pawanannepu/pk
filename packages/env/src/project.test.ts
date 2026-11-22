import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { findProjectRoot, projectKey } from "./project.ts";

const home = "/Users/dev";
const has = (...paths: string[]) => {
	const set = new Set(paths);
	return (path: string) => set.has(path);
};

describe("findProjectRoot (AC-13)", () => {
	test("finds the nearest folder with .git or .pk", () => {
		const exists = has("/Users/dev/code/app/.git", "/Users/dev/code/.pk");
		expect(findProjectRoot("/Users/dev/code/app/src/deep", home, exists)).toBe(
			"/Users/dev/code/app",
		);
		expect(findProjectRoot("/Users/dev/code/other", home, exists)).toBe(
			"/Users/dev/code",
		);
	});

	test("home never counts, even though ~/.pk exists", () => {
		const exists = has("/Users/dev/.pk", "/Users/dev/.git");
		expect(findProjectRoot(home, home, exists)).toBe(home);
		expect(findProjectRoot("/Users/dev/notes", home, exists)).toBe(
			"/Users/dev/notes",
		);
	});

	test("inside home the walk stops below home; outside it walks to /", () => {
		expect(findProjectRoot("/Users/dev/a/b", home, has("/Users/.git"))).toBe(
			"/Users/dev/a/b",
		);
		expect(findProjectRoot("/srv/work/app", home, has("/.git"))).toBe("/");
	});

	test("home is matched on whole path segments", () => {
		expect(
			findProjectRoot("/Users/devops/app", home, has("/Users/devops/.git")),
		).toBe("/Users/devops");
		expect(findProjectRoot("/Users/devops/app", home, has("/Users/.pk"))).toBe(
			"/Users",
		);
	});

	test("with no match it returns cwd", () => {
		expect(findProjectRoot("/tmp/x", home, has())).toBe("/tmp/x");
	});
});

describe("projectKey (AC-13)", () => {
	const hex = (root: string) =>
		createHash("sha256").update(root).digest("hex").slice(0, 8);

	test("is a readable slug plus 8 hex of the path", () => {
		expect(projectKey("/Users/dev/My App!")).toBe(
			`my-app-${hex("/Users/dev/My App!")}`,
		);
	});

	test("two folders with the same name get different keys", () => {
		expect(projectKey("/a/app")).not.toBe(projectKey("/b/app"));
		expect(projectKey("/a/App")).not.toBe(projectKey("/a/app")); // no case folding in the hash
	});

	test("cuts the slug to 40 characters, trims dashes, and falls back to root", () => {
		const long = `/w/${"a".repeat(39)}--b`;
		expect(projectKey(long)).toBe(`${"a".repeat(39)}-${hex(long)}`);
		expect(projectKey("/w/---")).toBe(`root-${hex("/w/---")}`);
		expect(projectKey("/")).toBe(`root-${hex("/")}`);
	});
});
