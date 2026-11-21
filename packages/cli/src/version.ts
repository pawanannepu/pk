import { readFileSync } from "node:fs";

/** Replaced by scripts/build.ts (`define`) with the root package.json `version`. Undefined when run from source. */
declare const PK_VERSION: string | undefined;

/**
 * pk's version. The root package.json `version` is the single source: the build injects it, and
 * running from source (`bun run dev`) reads it directly.
 */
export function pkVersion(): string {
	if (typeof PK_VERSION === "string") return PK_VERSION;
	try {
		const root = JSON.parse(
			readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
		) as {
			version?: unknown;
		};
		return typeof root.version === "string"
			? `${root.version}-dev`
			: "0.0.0-dev";
	} catch {
		return "0.0.0-dev";
	}
}
