/**
 * @pk/provider-openai: the OpenAI compatible chat adapter. One code path for any server that speaks
 * the chat completions format (OpenAI, OpenRouter, Groq, Ollama, LM Studio), chosen by base URL, key
 * and model. Spec: docs/specs/0004-provider-layer-openai-adapter.
 *
 * The only package that imports `openai`. No vendor type crosses its exports.
 */

/** The adapter factory, its config, and the `fetch` shape tests inject. */
export {
	createOpenAIProvider,
	type FetchLike,
	type OpenAIProviderConfig,
} from "./adapter.ts";
/** Maps any call failure to a `ProviderError`, per the spec's *Error mapping* table. */
export { type ErrorContext, toProviderError } from "./errors.ts";
/** Builds the chat request body from a pk `ModelRequest` (pure). */
export { type ChatRequest, toChatRequest } from "./request.ts";
/** The pure stream mapper: chunk by chunk, then once at the end. */
export {
	finish,
	INITIAL_STATE,
	type MapperState,
	mapChunk,
	type StreamFailure,
} from "./stream-map.ts";
