import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, LOG_FILE } from "./logger.ts";
import { REDACTED } from "./redact.ts";

const scratch = () => mkdtempSync(join(tmpdir(), "pk-env-logs-"));
const fixedNow = () => new Date("2026-11-21T00:00:00.000Z");
const readRecords = (dir: string, file = LOG_FILE) =>
	readFileSync(join(dir, file), "utf8")
		.trimEnd()
		.split("\n")
		.map((line) => JSON.parse(line) as Record<string, unknown>);

describe("createLogger", () => {
	test("writes redacted JSONL records at or above the level", () => {
		const dir = join(scratch(), "logs");
		const log = createLogger({
			dir,
			now: fixedNow,
			secrets: () => ["loaded-secret-1"],
		});
		log.debug("hidden at info");
		log.info("hello", { key: "loaded-secret-1", apiKey: "x" });
		log.child({ turn: 3 }).warn("child");
		expect(readRecords(dir)).toEqual([
			{
				ts: "2026-11-21T00:00:00.000Z",
				level: "info",
				msg: "hello",
				key: REDACTED,
				apiKey: REDACTED,
			},
			{ ts: "2026-11-21T00:00:00.000Z", level: "warn", msg: "child", turn: 3 },
		]);
	});

	test("creates nothing until the first write", () => {
		const root = scratch();
		createLogger({ dir: join(root, "logs") });
		expect(readdirSync(root)).toEqual([]);
	});

	test("rotates at the size cap and keeps maxFiles files", () => {
		const dir = scratch();
		const log = createLogger({ dir, maxBytes: 200, maxFiles: 3 });
		for (let n = 0; n < 30; n++) log.info("record", { n, pad: "x".repeat(40) });
		expect(readdirSync(dir).sort()).toEqual(["pk.1.log", "pk.2.log", "pk.log"]);
		const newest = readRecords(dir).at(-1);
		expect(newest?.n).toBe(29);
	});

	test("mirrors to stderr only when asked, and never throws on an unwritable dir", () => {
		const root = scratch();
		chmodSync(root, 0o500);
		const lines: string[] = [];
		const log = createLogger({
			dir: join(root, "logs"),
			level: "debug",
			mirrorToStderr: true,
			stderr: { write: (text: string) => lines.push(text) },
		});
		expect(() => log.debug("still works")).not.toThrow();
		chmodSync(root, 0o700);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('"msg":"still works"');
	});
});
