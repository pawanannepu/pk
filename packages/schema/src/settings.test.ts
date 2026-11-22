import { describe, expect, test } from "bun:test";
import {
	API_KEY_IN_FILE_MESSAGE,
	applySettingsRenames,
	dropUserOnlySettings,
	parseSettingsLayer,
	settingsJsonSchema,
} from "./index.ts";

describe("parseSettingsLayer (AC-11)", () => {
	test("accepts every key in the design", () => {
		const result = parseSettingsLayer({
			$schema: "https://example.invalid/settings.schema.json",
			model: {
				main: "openrouter/anthropic/claude-x",
				summarize: { provider: "openai", model: "gpt-x" },
			},
			providers: {
				openrouter: {
					api: "openai_chat",
					baseURL: "https://openrouter.ai/api/v1",
					apiKey: { env: "OPENROUTER_API_KEY" },
				},
				local: { api: "openai_chat", baseURL: "http://localhost:11434/v1" },
				anthropic: { api: "anthropic_messages", apiKey: { keychain: true } },
			},
			permissions: {
				mode: "accept_edits",
				allow: ["Read(*)"],
				deny: ["Bash(rm *)"],
				ask: ["Bash(git push *)"],
			},
			limits: { maxTurns: 50 },
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.settings.model?.main).toEqual({
				provider: "openrouter",
				model: "anthropic/claude-x",
			});
			expect(result.unknownKeys).toEqual([]);
		}
	});

	test("an unknown key is a warning: stripped and reported, at any depth", () => {
		const result = parseSettingsLayer({
			theme: "dark",
			limits: { maxTurns: 5, speed: 1 },
		});
		expect(result).toEqual({
			success: true,
			settings: { limits: { maxTurns: 5 } },
			unknownKeys: [
				{ path: "limits.speed", message: 'unknown key "limits.speed"' },
				{ path: "theme", message: 'unknown key "theme"' },
			],
		});
	});

	test("a wrong type is an error, and every issue is reported", () => {
		const result = parseSettingsLayer({
			limits: { maxTurns: 0 },
			permissions: { mode: "yolo" },
			model: { main: "nope" },
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.issues.map((i) => i.path).sort()).toEqual([
				"limits.maxTurns",
				"model.main",
				"permissions.mode",
			]);
		}
	});

	test("a plain string API key is rejected, and the message never holds the value", () => {
		const result = parseSettingsLayer({
			providers: { openai: { api: "openai_chat", apiKey: "sk-live-abc" } },
		});
		expect(result).toEqual({
			success: false,
			issues: [
				{ path: "providers.openai.apiKey", message: API_KEY_IN_FILE_MESSAGE },
			],
		});
		expect(JSON.stringify(result)).not.toContain("sk-live-abc");
	});

	test("baseURL must be http or https", () => {
		expect(
			parseSettingsLayer({
				providers: { x: { api: "openai_chat", baseURL: "file:///etc/passwd" } },
			}).success,
		).toBe(false);
	});
});

describe("per layer helpers", () => {
	test("dropUserOnlySettings removes providers, permissions.mode and permissions.allow only", () => {
		const out = dropUserOnlySettings({
			providers: {
				openai: { api: "openai_chat", baseURL: "https://evil.example" },
			},
			permissions: {
				mode: "skip_all",
				allow: ["Bash(*)"],
				deny: ["Bash(rm *)"],
			},
			limits: { maxTurns: 3 },
		});
		expect(out.raw).toEqual({
			permissions: { deny: ["Bash(rm *)"] },
			limits: { maxTurns: 3 },
		});
		expect(out.dropped.map((d) => d.path)).toEqual([
			"providers",
			"permissions.mode",
			"permissions.allow",
		]);
		expect(JSON.stringify(out.dropped)).not.toContain("evil.example");
	});

	test("renames move a deprecated key, and the new key wins when both are set", () => {
		const renames = { "limits.turns": "limits.maxTurns" };
		expect(applySettingsRenames({ limits: { turns: 4 } }, renames).raw).toEqual(
			{ limits: { maxTurns: 4 } },
		);
		const both = applySettingsRenames(
			{ limits: { turns: 4, maxTurns: 9 } },
			renames,
		);
		expect(both.raw).toEqual({ limits: { maxTurns: 9 } });
		expect(both.changes).toHaveLength(1);
		expect(applySettingsRenames({ limits: { maxTurns: 9 } }).changes).toEqual(
			[],
		);
	});
});

describe("settingsJsonSchema (AC-15)", () => {
	test("is draft 2020-12, allows the string model form, and marks strict objects", () => {
		const schema = settingsJsonSchema();
		expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
		expect(schema.additionalProperties).toBe(false);
		const text = JSON.stringify(schema);
		expect(text).toContain("^[a-z0-9][a-z0-9_-]{0,31}/.+$");
		expect(text).not.toContain("readOnly");
	});
});
