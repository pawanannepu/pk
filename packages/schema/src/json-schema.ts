import { z } from "zod";
import { JsonObject } from "./primitives.ts";

/**
 * The one place pk turns a Zod schema into JSON Schema: draft 2020-12, `io: "input"` (so the
 * `"provider/model"` string form shows), strict objects as `additionalProperties: false`.
 * `readOnly` marks from `.readonly()` are dropped: they describe pk's in memory types, not the file.
 */
export function jsonSchemaOf(schema: z.ZodType): JsonObject {
	const out = z.toJSONSchema(schema, {
		io: "input",
		override: (ctx) => {
			Reflect.deleteProperty(ctx.jsonSchema, "readOnly");
		},
	});
	return JsonObject.parse(out);
}

/** JSON Schema for a tool's input, for `ToolDefinition.inputSchema`. Same as `jsonSchemaOf`, without the top level `$schema`. */
export function toolInputJsonSchema(schema: z.ZodType): JsonObject {
	const { $schema: _dialect, ...rest } = jsonSchemaOf(schema);
	return rest;
}
