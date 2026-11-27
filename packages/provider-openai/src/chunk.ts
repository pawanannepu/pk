import { z } from "zod";

/** Real servers send `null` freely, so every field reads `null` as absent. Unknown keys are allowed. */
const count = z.number().nullish();
const text = z.string().nullish();

const ToolCallFragment = z.looseObject({
	index: z.number().int().nullish(),
	id: text,
	function: z.looseObject({ name: text, arguments: text }).nullish(),
});

/**
 * One streamed chat completion chunk, as lenient as real servers need. A known key with a wrong type
 * fails the parse, which the adapter reports as `provider.stream_broken`. Not exported from the package.
 */
export const ChatChunk = z.looseObject({
	choices: z
		.array(
			z.looseObject({
				delta: z
					.looseObject({
						role: text,
						content: text,
						reasoning_content: text,
						reasoning: text,
						tool_calls: z.array(ToolCallFragment).nullish(),
					})
					.nullish(),
				finish_reason: text,
			}),
		)
		.nullish(),
	usage: z
		.looseObject({
			prompt_tokens: count,
			completion_tokens: count,
			prompt_tokens_details: z.looseObject({ cached_tokens: count }).nullish(),
			completion_tokens_details: z
				.looseObject({ reasoning_tokens: count })
				.nullish(),
			cost: count,
		})
		.nullish(),
	error: z
		.looseObject({
			message: text,
			code: z.union([z.string(), z.number()]).nullish(),
		})
		.nullish(),
});
/** One streamed chat completion chunk. */
export type ChatChunk = z.infer<typeof ChatChunk>;

/** The `error` payload a server can send inside a stream. */
export type ChunkError = NonNullable<ChatChunk["error"]>;
