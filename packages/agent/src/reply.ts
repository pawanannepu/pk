import type {
	ApiStyle,
	AssistantContentBlock,
	CallId,
	JsonObject,
	ModelRef,
	ProviderStreamEvent,
	StopReason,
	ToolName,
	Usage,
} from "@pk/schema";

/** One block of a reply being built, in arrival order. */
type Part =
	| { readonly kind: "text"; readonly text: string }
	| {
			readonly kind: "reasoning";
			readonly text: string;
			readonly replay?: string;
			/** Closed by a `reasoning_replay`: the next reasoning delta starts a new block. */
			readonly closed: boolean;
	  }
	| {
			readonly kind: "call";
			readonly callId: CallId;
			readonly name: ToolName;
			/** Set at `tool_call_end`. A call that never ended is dropped. */
			readonly end?: {
				readonly input: JsonObject;
				readonly inputError?: string;
			};
	  };

/** A reply being folded from stream events. Replaced on every event, never changed in place. */
export interface ReplyFold {
	readonly parts: readonly Part[];
	readonly usage?: {
		readonly usage: Usage;
		readonly providerCostMicroUsd?: number;
	};
	readonly stop?: StopReason;
}

/** The fold before the first event. */
export const EMPTY_FOLD: ReplyFold = { parts: [] };

function replaceLast(parts: readonly Part[], part: Part): readonly Part[] {
	return [...parts.slice(0, -1), part];
}

/**
 * Folds one provider event into the reply (spec 0005 AC-8). Text deltas in a row merge into one
 * text block and reasoning deltas into one reasoning block; `reasoning_replay` sets `replay` on the
 * open reasoning block (or a new empty one) and closes it; a call takes the position of its
 * `tool_call_start` and its input from `tool_call_end`. Pure.
 */
export function foldEvent(
	fold: ReplyFold,
	event: ProviderStreamEvent,
): ReplyFold {
	const last = fold.parts.at(-1);
	switch (event.type) {
		case "text_delta":
			return {
				...fold,
				parts:
					last?.kind === "text"
						? replaceLast(fold.parts, {
								kind: "text",
								text: last.text + event.text,
							})
						: [...fold.parts, { kind: "text", text: event.text }],
			};
		case "reasoning_delta":
			return {
				...fold,
				parts:
					last?.kind === "reasoning" && !last.closed
						? replaceLast(fold.parts, { ...last, text: last.text + event.text })
						: [
								...fold.parts,
								{ kind: "reasoning", text: event.text, closed: false },
							],
			};
		case "reasoning_replay":
			return {
				...fold,
				parts:
					last?.kind === "reasoning" && !last.closed
						? replaceLast(fold.parts, {
								...last,
								replay: event.data,
								closed: true,
							})
						: [
								...fold.parts,
								{
									kind: "reasoning",
									text: "",
									replay: event.data,
									closed: true,
								},
							],
			};
		case "tool_call_start":
			return {
				...fold,
				parts: [
					...fold.parts,
					{ kind: "call", callId: event.callId, name: event.name },
				],
			};
		case "tool_call_delta":
			return fold;
		case "tool_call_end":
			return {
				...fold,
				parts: fold.parts.map((part) =>
					part.kind === "call" && part.callId === event.callId
						? {
								...part,
								end: {
									input: event.input,
									...(event.inputError === undefined
										? {}
										: { inputError: event.inputError }),
								},
							}
						: part,
				),
			};
		case "usage":
			return {
				...fold,
				usage: {
					usage: event.usage,
					...(event.providerCostMicroUsd === undefined
						? {}
						: { providerCostMicroUsd: event.providerCostMicroUsd }),
				},
			};
		case "stop":
			return { ...fold, stop: event.reason };
		default: {
			const _exhaustive: never = event;
			return _exhaustive;
		}
	}
}

/** Where a reasoning replay token came from, added when the block is built. */
export interface ReplayOrigin {
	readonly api: ApiStyle;
	readonly model: ModelRef;
}

/** The finished blocks, in arrival order. Calls that started but never ended are dropped. Pure. */
export function replyBlocks(
	fold: ReplyFold,
	origin: ReplayOrigin,
): readonly AssistantContentBlock[] {
	return fold.parts.flatMap((part): AssistantContentBlock[] => {
		switch (part.kind) {
			case "text":
				return [{ type: "text", text: part.text }];
			case "reasoning":
				return [
					{
						type: "reasoning",
						text: part.text,
						...(part.replay === undefined
							? {}
							: { replay: { ...origin, data: part.replay } }),
					},
				];
			case "call":
				return part.end === undefined
					? []
					: [
							{
								type: "tool_call",
								id: part.callId,
								name: part.name,
								input: part.end.input,
								...(part.end.inputError === undefined
									? {}
									: { inputError: part.end.inputError }),
							},
						];
			default: {
				const _exhaustive: never = part;
				return _exhaustive;
			}
		}
	});
}
