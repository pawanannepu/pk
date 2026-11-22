import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import * as schema from "./index.ts";

/** Field names that belong to a vendor's wire format, never to pk's own shapes (AC-2). */
const VENDOR_FIELDS = new Set([
	"tool_use_id",
	"tool_calls",
	"function_call",
	"finish_reason",
	"stop_reason",
	"prompt_tokens",
	"completion_tokens",
	"input_tokens",
	"cache_creation_input_tokens",
	"cache_read_input_tokens",
	"choices",
	"delta",
	"signature",
	"functionCall",
	"functionResponse",
]);

/** Every property name anywhere in a JSON Schema. */
function propertyNames(node: unknown): string[] {
	if (Array.isArray(node)) return node.flatMap(propertyNames);
	if (typeof node !== "object" || node === null) return [];
	return Object.entries(node).flatMap(([key, value]) => [
		...(key === "properties" && typeof value === "object" && value !== null
			? Object.keys(value)
			: []),
		...propertyNames(value),
	]);
}

function vendorFieldsIn(value: z.ZodType): string[] {
	return propertyNames(schema.jsonSchemaOf(value)).filter((name) =>
		VENDOR_FIELDS.has(name),
	);
}

const exportedSchemas = Object.entries(schema).flatMap(([name, value]) =>
	value instanceof z.ZodType ? [[name, value] as const] : [],
);

describe("vendor field guard (AC-2)", () => {
	test("no exported schema has a vendor field", () => {
		expect(exportedSchemas.length).toBeGreaterThan(40);
		const leaks = exportedSchemas.flatMap(([name, s]) =>
			vendorFieldsIn(s).map((f) => `${name}.${f}`),
		);
		expect(leaks).toEqual([]);
	});

	test("the guard catches a vendor field, even nested", () => {
		const leaky = z.object({
			message: schema.AssistantMessage,
			extra: z.object({ finish_reason: z.string() }),
		});
		expect(vendorFieldsIn(leaky)).toEqual(["finish_reason"]);
	});
});

describe("public surface (AC-1)", () => {
	test("every named schema is exported as a Zod schema", () => {
		const names = [
			"Timestamp",
			"JsonValue",
			"SessionId",
			"MessageId",
			"CallId",
			"RequestId",
			"TurnId",
			"AgentId",
			"ProviderId",
			"ApiStyle",
			"ModelRole",
			"ModelRef",
			"ModelRefInput",
			"TextBlock",
			"ImageBlock",
			"ReasoningBlock",
			"ToolCallBlock",
			"ToolResultBlock",
			"UserMessage",
			"AssistantMessage",
			"Message",
			"StopReason",
			"ToolKind",
			"ToolDefinition",
			"ModelRequest",
			"ProviderStreamEvent",
			"Usage",
			"Cost",
			"AgentEvent",
			"PermissionAnswer",
			"TodoItem",
			"StoredImageBlock",
			"StoredMessage",
			"SessionHeader",
			"SessionRecord",
			"MessageRecord",
			"UsageRecord",
			"TodoRecord",
			"ModelChangeRecord",
			"CompactionRecord",
			"TurnEndRecord",
			"CostRecord",
			"HistoryEntry",
			"Settings",
		];
		const exported = new Set(exportedSchemas.map(([name]) => name));
		expect(names.filter((n) => !exported.has(n))).toEqual([]);
	});

	test("every export of a source file is documented", () => {
		const dir = import.meta.dir;
		const files = [
			"primitives",
			"conversation",
			"repair",
			"provider",
			"stream-order",
			"events",
			"stored",
			"session",
			"records",
			"settings",
			"json-schema",
		];
		const undocumented = files.flatMap((file) => {
			const lines = readFileSync(join(dir, `${file}.ts`), "utf8").split("\n");
			return lines.flatMap((line, i) => {
				if (!/^export (const|function|type|interface|class) /.test(line))
					return [];
				const before = lines
					.slice(0, i)
					.reverse()
					.find((l) => l.trim() !== "");
				return before?.trim().endsWith("*/") ? [] : [`${file}.ts:${i + 1}`];
			});
		});
		expect(undocumented).toEqual([]);
	});
});
