import {
	type CallId,
	JsonObject,
	type NewId,
	type ProviderStreamEvent,
	type StopReason,
	TOOL_NAME_PATTERN,
	type Usage,
} from "@pk/schema";
import type { ChatChunk, ChunkError } from "./chunk.ts";

/** One tool call being assembled from fragments. */
interface CallGroup {
	readonly key: string;
	readonly callId: CallId;
	readonly id: string | undefined;
	readonly name: string | undefined;
	readonly args: string;
}

/** The stream mapper's per call state. Changes only through `mapChunk`. */
export interface MapperState {
	/** In creation order. A group with a `name` has had its `tool_call_start`. */
	readonly calls: readonly CallGroup[];
	readonly finishReason: string | undefined;
	readonly usage: NonNullable<ChatChunk["usage"]> | undefined;
}

/** Why a stream cannot finish normally. The adapter turns it into a `ProviderError`. */
export type StreamFailure =
	| { readonly kind: "error_chunk"; readonly error: ChunkError }
	| { readonly kind: "finish_error" }
	| { readonly kind: "bad_chunk" }
	| { readonly kind: "truncated" };

/** The state before the first chunk. */
export const INITIAL_STATE: MapperState = {
	calls: [],
	finishReason: undefined,
	usage: undefined,
};

const MAX_ERROR_TEXT = 2000;
const CUT_OFF = "reply was cut off at the output limit";
const NO_NAME = "the server sent a tool call with no name";

const nonEmpty = (value: string | null | undefined): string | undefined =>
	value === null || value === undefined || value === "" ? undefined : value;

/** Repairs a tool name to fit `TOOL_NAME_PATTERN`: invalid characters become `_`, cut to 64, empty is `_`. */
function repairName(name: string): string {
	if (TOOL_NAME_PATTERN.test(name)) return name;
	const fixed = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
	return fixed === "" ? "_" : fixed;
}

/**
 * Applies one parsed chunk: text and reasoning deltas, tool call fragments grouped by `index` (by `id`
 * when the index is missing, by `0` when both are), the last finish reason and the last usage. Pure,
 * apart from minting call ids with the injected `newId`.
 */
export function mapChunk(
	state: MapperState,
	chunk: ChatChunk,
	newId: NewId,
): {
	readonly state: MapperState;
	readonly events: readonly ProviderStreamEvent[];
	readonly failure?: StreamFailure;
} {
	if (chunk.error !== null && chunk.error !== undefined) {
		return {
			state,
			events: [],
			failure: { kind: "error_chunk", error: chunk.error },
		};
	}
	const events: ProviderStreamEvent[] = [];
	let calls = [...state.calls];
	let finishReason = state.finishReason;
	const usage = chunk.usage ?? state.usage;

	for (const choice of chunk.choices ?? []) {
		const delta = choice.delta;
		const reasoning =
			nonEmpty(delta?.reasoning_content) ?? nonEmpty(delta?.reasoning);
		if (reasoning !== undefined)
			events.push({ type: "reasoning_delta", text: reasoning });
		const content = nonEmpty(delta?.content);
		if (content !== undefined)
			events.push({ type: "text_delta", text: content });

		for (const fragment of delta?.tool_calls ?? []) {
			const id = nonEmpty(fragment.id);
			const name = nonEmpty(fragment.function?.name);
			const argsText = nonEmpty(fragment.function?.arguments);
			const key =
				fragment.index !== null && fragment.index !== undefined
					? `index:${fragment.index}`
					: id !== undefined
						? `id:${id}`
						: "index:0";
			const openAt = calls.findLastIndex((call) => call.key === key);
			const open = calls[openAt];
			const startsNew =
				open === undefined ||
				(id !== undefined && open.id !== undefined && id !== open.id) ||
				(name !== undefined && open.name !== undefined);
			const at = startsNew ? calls.length : openAt;
			const group: CallGroup =
				startsNew || open === undefined
					? { key, callId: newId("call"), id, name: undefined, args: "" }
					: open;

			let next: CallGroup = { ...group, id: group.id ?? id };
			if (name !== undefined && next.name === undefined) {
				next = { ...next, name: repairName(name) };
				events.push({
					type: "tool_call_start",
					callId: next.callId,
					name: next.name ?? "_",
				});
				if (next.args !== "") {
					events.push({
						type: "tool_call_delta",
						callId: next.callId,
						argsText: next.args,
					});
				}
			}
			if (argsText !== undefined) {
				next = { ...next, args: next.args + argsText };
				if (next.name !== undefined) {
					events.push({
						type: "tool_call_delta",
						callId: next.callId,
						argsText,
					});
				}
			}
			calls = startsNew
				? [...calls, next]
				: calls.map((call, index) => (index === at ? next : call));
		}

		const reason = nonEmpty(choice.finish_reason);
		if (reason === "error") {
			return { state, events: [], failure: { kind: "finish_error" } };
		}
		if (reason !== undefined) finishReason = reason;
	}
	return { state: { calls, finishReason, usage }, events };
}

const cut = (text: string): string => text.slice(0, MAX_ERROR_TEXT);

/** A call's parsed input, or `{}` with the reason it could not be used. */
function parseArgs(
	args: string,
	cutOff: boolean,
): { readonly input: JsonObject; readonly inputError?: string } {
	if (cutOff) return { input: {}, inputError: CUT_OFF };
	if (args.trim() === "") return { input: {} };
	let value: unknown;
	try {
		value = JSON.parse(args);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			input: {},
			inputError: cut(`arguments are not valid JSON: ${message}`),
		};
	}
	const parsed =
		typeof value === "object" && value !== null && !Array.isArray(value)
			? JsonObject.safeParse(value)
			: undefined;
	return parsed?.success === true
		? { input: parsed.data }
		: { input: {}, inputError: "arguments must be a JSON object" };
}

function stopReason(
	finishReason: string | undefined,
	anyCall: boolean,
): StopReason {
	if (finishReason === "length") return "max_tokens";
	if (anyCall) return "tool_use";
	switch (finishReason) {
		case undefined:
		case "stop":
			return "end_turn";
		case "content_filter":
			return "refusal";
		case "tool_calls":
		case "function_call":
			return "tool_use";
		default:
			return "other";
	}
}

const tokens = (value: number | null | undefined): number =>
	value === null || value === undefined || !Number.isFinite(value)
		? 0
		: Math.max(0, Math.round(value));

function usageEvent(
	usage: NonNullable<MapperState["usage"]>,
): ProviderStreamEvent {
	const cached = tokens(usage.prompt_tokens_details?.cached_tokens);
	const reasoning = usage.completion_tokens_details?.reasoning_tokens;
	const value: Usage = {
		inputTokens: Math.max(0, tokens(usage.prompt_tokens) - cached),
		cacheReadTokens: cached,
		cacheWriteTokens: 0,
		outputTokens: tokens(usage.completion_tokens),
		...(reasoning === null || reasoning === undefined
			? {}
			: { reasoningTokens: tokens(reasoning) }),
	};
	const cost = usage.cost;
	return {
		type: "usage",
		usage: value,
		...(cost !== null &&
		cost !== undefined &&
		Number.isFinite(cost) &&
		cost >= 0
			? { providerCostMicroUsd: Math.round(cost * 1e6) }
			: {}),
	};
}

/**
 * Runs once when the SSE stream ends: ends every call in start order (unnamed groups start as
 * `unknown_tool` and end with an error), then one `usage` when the server sent it, then one `stop`.
 * A body that ended with no `[DONE]` and no finish reason is a `truncated` failure instead.
 */
export function finish(
	state: MapperState,
	options: { readonly sawDone: boolean },
):
	| { readonly events: readonly ProviderStreamEvent[] }
	| { readonly failure: StreamFailure } {
	if (!options.sawDone && state.finishReason === undefined) {
		return { failure: { kind: "truncated" } };
	}
	const cutOff = state.finishReason === "length";
	const named = state.calls.filter((call) => call.name !== undefined);
	const unnamed = state.calls.filter((call) => call.name === undefined);
	const events: ProviderStreamEvent[] = [
		...named.map(
			(call): ProviderStreamEvent => ({
				type: "tool_call_end",
				callId: call.callId,
				...parseArgs(call.args, cutOff),
			}),
		),
		...unnamed.flatMap((call): ProviderStreamEvent[] => [
			{ type: "tool_call_start", callId: call.callId, name: "unknown_tool" },
			{
				type: "tool_call_end",
				callId: call.callId,
				input: {},
				inputError: NO_NAME,
			},
		]),
		...(state.usage === undefined ? [] : [usageEvent(state.usage)]),
		{
			type: "stop",
			reason: stopReason(state.finishReason, state.calls.length > 0),
		},
	];
	return { events };
}
