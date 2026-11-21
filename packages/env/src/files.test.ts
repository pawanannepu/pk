import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendJsonl, atomicWriteFile } from "./files.ts";

const scratch = () => mkdtempSync(join(tmpdir(), "pk-env-files-"));

describe("atomicWriteFile", () => {
	test("creates parent dirs, replaces content, leaves no temp files", async () => {
		const dir = scratch();
		const file = join(dir, "nested", "settings.json");
		await atomicWriteFile(file, '{"a":1}');
		await atomicWriteFile(file, '{"a":2}');
		expect(readFileSync(file, "utf8")).toBe('{"a":2}');
		expect(readdirSync(join(dir, "nested"))).toEqual(["settings.json"]);
	});

	test("applies the requested mode to a new file", async () => {
		const file = join(scratch(), "secret.json");
		await atomicWriteFile(file, "{}", { mode: 0o600 });
		expect(statSync(file).mode & 0o777).toBe(0o600);
	});
});

describe("appendJsonl", () => {
	test("writes one JSON record per line, in order", async () => {
		const file = join(scratch(), "logs", "history.jsonl");
		await appendJsonl(file, { n: 1 });
		await appendJsonl(file, { n: 2, text: "line\nbreak" });
		const lines = readFileSync(file, "utf8").trimEnd().split("\n");
		expect(lines.map((line) => JSON.parse(line))).toEqual([
			{ n: 1 },
			{ n: 2, text: "line\nbreak" },
		]);
	});

	test("concurrent appends never interleave", async () => {
		const file = join(scratch(), "many.jsonl");
		await Promise.all(
			Array.from({ length: 50 }, (_, n) =>
				appendJsonl(file, { n, pad: "x".repeat(200) }),
			),
		);
		const records = readFileSync(file, "utf8")
			.trimEnd()
			.split("\n")
			.map((line) => JSON.parse(line) as { n: number });
		expect(records.map((r) => r.n).sort((a, b) => a - b)).toEqual(
			Array.from({ length: 50 }, (_, n) => n),
		);
	});

	test("rejects a value JSON cannot represent", async () => {
		await expect(
			appendJsonl(join(scratch(), "x.jsonl"), undefined),
		).rejects.toThrow(TypeError);
	});
});
