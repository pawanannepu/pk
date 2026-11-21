import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/** Where pk keeps its files. File and folder names inside are the same on every platform. */
export interface PkPaths {
	/** `settings.json` lives here. */
	readonly config: string;
	/** `sessions/`, `history.jsonl`, `costs/`, `logs/` live here. */
	readonly state: string;
	/** Anything safe to delete. */
	readonly cache: string;
}

export interface PathsInput {
	readonly platform?: NodeJS.Platform;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly home?: string;
}

/**
 * Resolves pk's data directories.
 *
 * - `PK_HOME` set: config, state and cache are all `PK_HOME` itself (flat). Used by tests and bench runs.
 * - macOS: all three are `~/.pk`. `XDG_*` is ignored.
 * - Linux: `$XDG_CONFIG_HOME/pk`, `$XDG_STATE_HOME/pk`, `$XDG_CACHE_HOME/pk`, falling back to the
 *   XDG defaults. Per the XDG spec, a relative `XDG_*` value is ignored.
 *
 * Inputs are injectable so tests never read the real environment or home directory.
 */
export function paths(input: PathsInput = {}): PkPaths {
	const env = input.env ?? process.env;
	const platform = input.platform ?? process.platform;
	const home = input.home ?? homedir();

	const pkHome = env.PK_HOME;
	if (pkHome) {
		return { config: pkHome, state: pkHome, cache: pkHome };
	}

	if (platform === "linux") {
		const xdg = (name: string, fallback: string): string => {
			const value = env[name];
			return join(
				value && isAbsolute(value) ? value : join(home, fallback),
				"pk",
			);
		};
		return {
			config: xdg("XDG_CONFIG_HOME", ".config"),
			state: xdg("XDG_STATE_HOME", join(".local", "state")),
			cache: xdg("XDG_CACHE_HOME", ".cache"),
		};
	}

	// macOS, and any platform pk does not officially support yet.
	const dir = join(home, ".pk");
	return { config: dir, state: dir, cache: dir };
}
