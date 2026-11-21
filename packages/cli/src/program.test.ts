import { describe, expect, test } from "bun:test";
import { EXIT } from "./exit-codes.ts";
import { unsupportedPlatformMessage } from "./platform-check.ts";
import { main } from "./program.ts";
import { pkVersion } from "./version.ts";

function capture(isTTY = false) {
	const out: string[] = [];
	const err: string[] = [];
	return {
		io: {
			stdout: { isTTY, write: (text: string) => out.push(text) },
			stderr: { write: (text: string) => err.push(text) },
		},
		out: () => out.join(""),
		err: () => err.join(""),
	};
}

const argv = (...args: string[]) => ["bun", "pk", ...args];

describe("pk cli", () => {
	test("--version prints the version and exits 0", async () => {
		const c = capture();
		expect(await main(argv("--version"), c.io)).toBe(EXIT.success);
		expect(c.out().trim()).toBe(pkVersion());
	});

	test("from source the version is the root version plus -dev", () => {
		expect(pkVersion()).toMatch(/^\d+\.\d+\.\d+.*-dev$/);
	});

	test("--help exits 0 and hides the smoke command", async () => {
		const c = capture();
		expect(await main(argv("--help"), c.io)).toBe(EXIT.success);
		expect(c.out()).toContain("Usage: pk");
		expect(c.out()).not.toContain("__tui-smoke");
	});

	test("an unknown flag is a usage error (exit 2)", async () => {
		const c = capture();
		expect(await main(argv("--nope"), c.io)).toBe(EXIT.usage);
		expect(c.err()).toContain("unknown option");
	});

	test("__tui-smoke refuses to run without a terminal", async () => {
		const c = capture(false);
		expect(await main(argv("__tui-smoke"), c.io)).toBe(EXIT.failure);
		expect(c.err()).toContain("needs a terminal");
	});

	test("__tui-smoke rejects a bad duration as a usage error", async () => {
		const c = capture(true);
		expect(await main(argv("__tui-smoke", "--duration", "soon"), c.io)).toBe(
			EXIT.usage,
		);
	});
});

describe("unsupportedPlatformMessage", () => {
	const probe = (
		platform: NodeJS.Platform,
		files: string[] = [],
		dirs: Record<string, string[]> = {},
	) => ({
		platform,
		fileExists: (path: string) => files.includes(path),
		listDir: (path: string) => dirs[path] ?? [],
	});

	test("macOS and glibc Linux are supported", () => {
		expect(unsupportedPlatformMessage(probe("darwin"))).toBeUndefined();
		expect(
			unsupportedPlatformMessage(
				probe("linux", [], { "/lib": ["ld-linux-x86-64.so.2"] }),
			),
		).toBeUndefined();
	});

	test("musl Linux and Windows get a clear message", () => {
		expect(
			unsupportedPlatformMessage(probe("linux", ["/etc/alpine-release"])),
		).toContain("musl");
		expect(
			unsupportedPlatformMessage(
				probe("linux", [], { "/lib": ["ld-musl-aarch64.so.1"] }),
			),
		).toContain("musl");
		expect(unsupportedPlatformMessage(probe("win32"))).toContain("Windows");
	});

	test("a musl loader in /usr/lib alone is enough to refuse", () => {
		expect(
			unsupportedPlatformMessage(
				probe("linux", [], {
					"/lib": ["ld-linux-x86-64.so.2"],
					"/usr/lib": ["ld-musl-x86_64.so.1"],
				}),
			),
		).toContain("musl");
	});

	test("Linux with unreadable or empty library folders is treated as glibc", () => {
		expect(unsupportedPlatformMessage(probe("linux"))).toBeUndefined();
	});

	test("macOS never looks for musl files", () => {
		const looked: string[] = [];
		const watching = {
			platform: "darwin" as const,
			fileExists: (path: string) => {
				looked.push(path);
				return true;
			},
			listDir: (path: string) => {
				looked.push(path);
				return ["ld-musl-x.so.1"];
			},
		};

		expect(unsupportedPlatformMessage(watching)).toBeUndefined();
		expect(looked).toEqual([]);
	});
});
