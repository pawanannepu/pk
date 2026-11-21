import { describe, expect, test } from "bun:test";
import { paths } from "./paths.ts";

const home = "/home/dev";

describe("paths", () => {
	test("PK_HOME wins everywhere and is flat", () => {
		for (const platform of ["darwin", "linux"] as const) {
			expect(paths({ platform, home, env: { PK_HOME: "/tmp/pk" } })).toEqual({
				config: "/tmp/pk",
				state: "/tmp/pk",
				cache: "/tmp/pk",
			});
		}
	});

	test("macOS uses ~/.pk and ignores XDG", () => {
		const env = { XDG_CONFIG_HOME: "/xdg/config" };
		expect(paths({ platform: "darwin", home, env })).toEqual({
			config: "/home/dev/.pk",
			state: "/home/dev/.pk",
			cache: "/home/dev/.pk",
		});
	});

	test("Linux falls back to the XDG defaults", () => {
		expect(paths({ platform: "linux", home, env: {} })).toEqual({
			config: "/home/dev/.config/pk",
			state: "/home/dev/.local/state/pk",
			cache: "/home/dev/.cache/pk",
		});
	});

	test("Linux honors absolute XDG values and ignores relative ones", () => {
		const env = {
			XDG_CONFIG_HOME: "/xdg/config",
			XDG_STATE_HOME: "relative/state",
			XDG_CACHE_HOME: "/xdg/cache",
		};
		expect(paths({ platform: "linux", home, env })).toEqual({
			config: "/xdg/config/pk",
			state: "/home/dev/.local/state/pk",
			cache: "/xdg/cache/pk",
		});
	});

	test("the test preload isolates PK_HOME from your real home", () => {
		expect(process.env.PK_HOME).toBeString();
		expect(paths().config).toBe(process.env.PK_HOME ?? "");
	});
});
