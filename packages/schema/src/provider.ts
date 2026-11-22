import { z } from "zod";
import { Message, StopReason, ToolName } from "./conversation.ts";
import { CallId, JsonObject, ModelRef } from "./primitives.ts";

/** What a tool can do, for `@pk/permissions`. Never sent to the model. MCP tools (#36) default to `execute`. */
export const ToolKind = z.enum(["read", "write", "execute", "network"]);
/** What a tool can do. */
export type ToolKind = z.infer<typeof ToolKind>;

/** A tool as the model sees it, plus its `kind`. `inputSchema` is a JSON Schema object (see `toolInputJsonSchema`). */
export const ToolDefinition = z
	.object({
		name: ToolName,
		description: z.string(),
		inputSchema: JsonObject,
		kind: ToolKind,
	})
	.readonly();
/** A tool as the model sees it, plus its `kind`. */
export type ToolDefinition = z.infer<typeof ToolDefinition>;

/**
 * Everything an adapter needs for one model call. The system prompt is never a message; adapters put
 * it where their API wants it. Tool names are unique within one request.
 */
export const ModelRequest = z
	.object({
		model: ModelRef,
		system: z.string(),
		messages: z.array(Message).readonly(),
		tools: z
			.array(ToolDefinition)
			.refine(
				(tools) => new Set(tools.map((t) => t.name)).size === tools.length,
				"tool names must be unique in one request",
			)
			.readonly(),
		maxOutputTokens: z.number().int().positive().optional(),
	})
	.readonly();
/** Everything an adapter needs for one model call. */
export type ModelRequest = z.infer<typeof ModelRequest>;

const tokenCount = z.number().int().min(0);

/**
 * Token counts for one model call. `inputTokens` is uncached input only (the OpenAI compatible
 * adapter subtracts its cached count from its prompt count). `outputTokens` includes reasoning;
 * `reasoningTokens` is for information only.
 */
export const Usage = z
	.object({
		inputTokens: tokenCount.default(0),
		cacheReadTokens: tokenCount.default(0),
		cacheWriteTokens: tokenCount.default(0),
		outputTokens: tokenCount.default(0),
		reasoningTokens: tokenCount.optional(),
	})
	.readonly();
/** Token counts for one model call. */
export type Usage = z.infer<typeof Usage>;

/** Whole micro US dollars: 1 is $0.000001. A dollar figure converts with `Math.round(usd * 1e6)`. */
export const MicroUsd = z.number().int().min(0);
/** Whole micro US dollars. */
export type MicroUsd = z.infer<typeof MicroUsd>;

/**
 * What one model call cost, and where the figure came from. `unknown` has no amount, so it can never
 * be summed as zero.
 */
export const Cost = z.discriminatedUnion("source", [
	z.object({ source: z.literal("provider"), microUsd: MicroUsd }).readonly(),
	z.object({ source: z.literal("catalog"), microUsd: MicroUsd }).readonly(),
	z
		.object({ source: z.literal("unknown"), microUsd: z.never().optional() })
		.readonly(),
]);
/** What one model call cost, and where the figure came from. */
export type Cost = z.infer<typeof Cost>;

/** Adds usage field by field. An empty list gives all zeros. `reasoningTokens` is present only when an input has it. */
export function sumUsage(usages: readonly Usage[]): Usage {
	const total = usages.reduce(
		(sum, u) => ({
			inputTokens: sum.inputTokens + u.inputTokens,
			cacheReadTokens: sum.cacheReadTokens + u.cacheReadTokens,
			cacheWriteTokens: sum.cacheWriteTokens + u.cacheWriteTokens,
			outputTokens: sum.outputTokens + u.outputTokens,
		}),
		{
			inputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			outputTokens: 0,
		},
	);
	const withReasoning = usages.filter((u) => u.reasoningTokens !== undefined);
	if (withReasoning.length === 0) return total;
	return {
		...total,
		reasoningTokens: withReasoning.reduce(
			(sum, u) => sum + (u.reasoningTokens ?? 0),
			0,
		),
	};
}

/** A sum of costs: the known amount, and how many calls had no known cost. */
export const CostTotals = z
	.object({ knownMicroUsd: MicroUsd, unknownCalls: z.number().int().min(0) })
	.readonly();
/** A sum of costs. */
export type CostTotals = z.infer<typeof CostTotals>;

/** Adds `provider` and `catalog` amounts alike, and counts `unknown` costs instead of adding them as zero. */
export function sumCosts(costs: readonly Cost[]): CostTotals {
	return {
		knownMicroUsd: costs.reduce(
			(sum, cost) => (cost.source === "unknown" ? sum : sum + cost.microUsd),
			0,
		),
		unknownCalls: costs.filter((cost) => cost.source === "unknown").length,
	};
}

/**
 * One event of a provider's streamed reply, in pk's own terms. The adapter mints each `callId` with the
 * injected `newId("call")`. Exactly one `stop` comes last (see `checkStreamOrder`).
 *
 * Text and reasoning deltas may come anywhere before `stop`. A `reasoning_replay` closes the current
 * reasoning block, so the next `reasoning_delta` starts a new one; the loop adds `api` and `model`
 * from the request when it builds the block.
 */
export const ProviderStreamEvent = z.discriminatedUnion("type", [
	z.object({ type: z.literal("text_delta"), text: z.string() }).readonly(),
	z.object({ type: z.literal("reasoning_delta"), text: z.string() }).readonly(),
	z
		.object({ type: z.literal("reasoning_replay"), data: z.string() })
		.readonly(),
	z
		.object({
			type: z.literal("tool_call_start"),
			callId: CallId,
			name: ToolName,
		})
		.readonly(),
	z
		.object({
			type: z.literal("tool_call_delta"),
			callId: CallId,
			argsText: z.string(),
		})
		.readonly(),
	z
		.object({
			type: z.literal("tool_call_end"),
			callId: CallId,
			input: JsonObject,
			inputError: z.string().max(2000).optional(),
		})
		.readonly(),
	z
		.object({
			type: z.literal("usage"),
			usage: Usage,
			providerCostMicroUsd: MicroUsd.optional(),
		})
		.readonly(),
	z.object({ type: z.literal("stop"), reason: StopReason }).readonly(),
]);
/** One event of a provider's streamed reply. */
export type ProviderStreamEvent = z.infer<typeof ProviderStreamEvent>;
