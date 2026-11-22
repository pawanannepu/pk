import { describe, expect, test } from "bun:test";
import {
	NOT_JSON,
	parseJson,
	readJsonlRecords,
	type SafeParser,
} from "./jsonl.ts";

/** A tiny schema: accepts `{ n: number }` only. Stands in for a Zod schema, as `@pk/env` has no zod. */
const NumberRecord: SafeParser<{ n: number }> = {
	safeParse(value) {
		if (
			typeof value === "object" &&
			value !== null &&
			"n" in value &&
			typeof value.n === "number"
		) {
			return { success: true, data: { n: value.n } };
		}
		return { success: false, error: "not a number record" };
	},
};

describe("parseJson", () => {
	test("returns the parsed value for valid JSON, including null", () => {
		expect(parseJson('{"n":1}')).toEqual({ n: 1 });
		expect(parseJson("null")).toBeNull();
	});

	test("returns NOT_JSON instead of throwing for text that is not JSON", () => {
		expect(parseJson('{"n":')).toBe(NOT_JSON);
		expect(parseJson("")).toBe(NOT_JSON);
	});
});

describe("readJsonlRecords (AC-8, AC-10)", () => {
	test("empty or blank only text reads as nothing, with nothing skipped", () => {
		expect(readJsonlRecords("", NumberRecord)).toEqual({
			records: [],
			skipped: 0,
		});
		expect(readJsonlRecords("\n  \n\t\n", NumberRecord)).toEqual({
			records: [],
			skipped: 0,
		});
	});

	test("a JSON null line goes to the schema and is skipped by it, never crashes", () => {
		expect(readJsonlRecords('null\n{"n":1}\n', NumberRecord)).toEqual({
			records: [{ n: 1 }],
			skipped: 1,
		});
	});

	test("lines ending in CRLF still read", () => {
		expect(readJsonlRecords('{"n":1}\r\n{"n":2}\r\n', NumberRecord)).toEqual({
			records: [{ n: 1 }, { n: 2 }],
			skipped: 0,
		});
	});

	test("a torn last line from a crash is skipped and counted, earlier records kept", () => {
		expect(readJsonlRecords('{"n":1}\n{"n":2}\n{"n":', NumberRecord)).toEqual({
			records: [{ n: 1 }, { n: 2 }],
			skipped: 1,
		});
	});

	test("upgrade runs on each raw record before the schema", () => {
		const seen: unknown[] = [];
		const upgrade = (raw: unknown): unknown => {
			seen.push(raw);
			return typeof raw === "object" && raw !== null && "count" in raw
				? { n: raw.count }
				: raw;
		};
		const read = readJsonlRecords(
			'{"count":7}\n{"n":8}\n',
			NumberRecord,
			upgrade,
		);
		expect(read).toEqual({ records: [{ n: 7 }, { n: 8 }], skipped: 0 });
		expect(seen).toEqual([{ count: 7 }, { n: 8 }]);
	});

	test("upgrade never sees a line that is not JSON", () => {
		const seen: unknown[] = [];
		readJsonlRecords("not json\n", NumberRecord, (raw) => {
			seen.push(raw);
			return raw;
		});
		expect(seen).toEqual([]);
	});
});
