import { describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPkError } from "./errors.ts";
import {
	appendJsonl,
	atomicWriteFile,
	ensurePrivateDir,
	PRIVATE_FILE,
} from "./files.ts";

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

	test("a failed rename throws and leaves no temp file behind", async () => {
		const dir = scratch();
		const target = join(dir, "taken");
		mkdirSync(join(target, "inside"), { recursive: true }); // a non empty folder cannot be renamed over
		const error = await atomicWriteFile(target, "data").catch(
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(Error);
		expect(readdirSync(dir)).toEqual(["taken"]);
		expect(readdirSync(target)).toEqual(["inside"]);
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

	test("rejects a value JSON cannot represent with env.not_serializable", async () => {
		const error = await appendJsonl(
			join(scratch(), "x.jsonl"),
			undefined,
		).catch((e: unknown) => e);
		expect(isPkError(error) && error.code).toBe("env.not_serializable");
	});

	test("never glues a record onto a torn last line (AC-16)", async () => {
		const file = join(scratch(), "torn.jsonl");
		writeFileSync(file, '{"n":1}\n{"n":2,"tex');
		await appendJsonl(file, { n: 3 });
		expect(readFileSync(file, "utf8")).toBe('{"n":1}\n{"n":2,"tex\n{"n":3}\n');
	});

	test("an existing empty file gets no leading blank line", async () => {
		const file = join(scratch(), "empty.jsonl");
		writeFileSync(file, "");
		await appendJsonl(file, { n: 1 });
		expect(readFileSync(file, "utf8")).toBe('{"n":1}\n');
	});
});

const mode = (path: string) => statSync(path).mode & 0o777;

describe("private files (AC-16)", () => {
	test("PRIVATE_FILE creates 0600 files in 0700 folders", async () => {
		const dir = scratch();
		const jsonl = join(dir, "sessions", "app-1234", "s.jsonl");
		const blob = join(dir, "blobs", "abc");
		await appendJsonl(jsonl, { n: 1 }, PRIVATE_FILE);
		await atomicWriteFile(blob, new Uint8Array([1, 2]), PRIVATE_FILE);
		expect(mode(jsonl)).toBe(0o600);
		expect(mode(join(dir, "sessions"))).toBe(0o700);
		expect(mode(join(dir, "sessions", "app-1234"))).toBe(0o700);
		expect(mode(blob)).toBe(0o600);
		expect(mode(join(dir, "blobs"))).toBe(0o700);
	});

	test("ensurePrivateDir creates a 0700 folder, or tightens an existing one", async () => {
		const dir = scratch();
		const fresh = join(dir, "costs");
		expect(await ensurePrivateDir(fresh)).toBe(fresh);
		expect(mode(fresh)).toBe(0o700);
		const loose = join(dir, "loose");
		mkdirSync(loose);
		chmodSync(loose, 0o755);
		await ensurePrivateDir(loose);
		expect(mode(loose)).toBe(0o700);
	});
});
