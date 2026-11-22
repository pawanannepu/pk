/**
 * Writes the published JSON Schema for settings (spec 0002, AC-15).
 *
 *   bun run schemas           regenerate schemas/settings.schema.json
 *   bun run schemas --check   fail (exit 1) when the committed file is stale; part of `bun run check`
 *
 * The file is generated from the `Settings` Zod schema, tab indented with a trailing newline, and kept
 * out of Biome so formatting never changes it.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { atomicWriteFile } from "@pk/env";
import { settingsJsonSchema } from "@pk/schema";

const ROOT = join(import.meta.dir, "..");
const TARGET = join(ROOT, "schemas", "settings.schema.json");

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: { check: { type: "boolean", default: false } },
});

const expected = `${JSON.stringify(settingsJsonSchema(), null, "\t")}\n`;

if (values.check) {
	const committed = await readFile(TARGET, "utf8").catch(() => undefined);
	if (committed !== expected) {
		console.error(
			`${committed === undefined ? "missing" : "stale"}: schemas/settings.schema.json does not match the Settings schema. Run \`bun run schemas\` and commit the result.`,
		);
		process.exit(1);
	}
	console.log("schemas/settings.schema.json is up to date.");
} else {
	await atomicWriteFile(TARGET, expected);
	console.log("wrote schemas/settings.schema.json");
}
