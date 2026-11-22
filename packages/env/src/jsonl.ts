/** Anything with a Zod style `safeParse`. `@pk/env` stays free of a direct `zod` dependency. */
export interface SafeParser<T> {
	safeParse(
		value: unknown,
	): { success: true; data: T } | { success: false; error: unknown };
}

/** What `readJsonlRecords` returns: the records that parsed, and how many lines did not. */
export interface JsonlRead<T> {
	readonly records: readonly T[];
	readonly skipped: number;
}

/**
 * Reads JSONL text that may be damaged. Splits on `\n`, ignores blank lines, and skips (and counts)
 * lines that are not JSON, that fail `schema`, or whose `type` this pk does not know. `upgrade` runs on
 * each raw record before the schema, for migrating old files. Never throws.
 */
export function readJsonlRecords<T>(
	text: string,
	schema: SafeParser<T>,
	upgrade: (raw: unknown) => unknown = (raw) => raw,
): JsonlRead<T> {
	const lines = text.split("\n").filter((line) => line.trim() !== "");
	const parsed = lines.map((line) => {
		const raw = parseJson(line);
		if (raw === NOT_JSON) return undefined;
		const result = schema.safeParse(upgrade(raw));
		return result.success ? { value: result.data } : undefined;
	});
	const records = parsed.flatMap((p) => (p === undefined ? [] : [p.value]));
	return { records, skipped: lines.length - records.length };
}

/** Marks a line that is not JSON, since `null` is valid JSON. */
export const NOT_JSON: unique symbol = Symbol("not json");

/** `JSON.parse`, returning `NOT_JSON` instead of throwing. */
export function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return NOT_JSON;
	}
}
