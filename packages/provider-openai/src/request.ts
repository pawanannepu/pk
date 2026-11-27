import type {
	AssistantMessage,
	CallId,
	ImageBlock,
	ModelRequest,
	UserMessage,
} from "@pk/schema";
import type OpenAI from "openai";

/** The chat request body `toChatRequest` builds. */
export type ChatRequest =
	OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type UserPart = OpenAI.Chat.Completions.ChatCompletionContentPart;
type ToolCall = OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;

/** A chat message before merging: user content stays as parts until the end. */
type Draft =
	| { readonly role: "user"; readonly parts: readonly UserPart[] }
	| { readonly role: "tool"; readonly callId: CallId; readonly content: string }
	| {
			readonly role: "assistant";
			readonly texts: readonly string[];
			readonly calls: readonly ToolCall[];
	  };

const imagePart = (image: ImageBlock): UserPart => ({
	type: "image_url",
	image_url: { url: `data:${image.mediaType};base64,${image.data}` },
});

const textPart = (text: string): UserPart => ({ type: "text", text });

/** One user message as drafts: its tool results, then their images, then its own content. */
function userDrafts(message: UserMessage): Draft[] {
	const tools: Draft[] = [];
	const toolImages: UserPart[] = [];
	const own: UserPart[] = [];
	for (const block of message.content) {
		switch (block.type) {
			case "tool_result": {
				const texts = block.content.flatMap((c) =>
					c.type === "text" && c.text !== "" ? [c.text] : [],
				);
				const body =
					texts.length > 0 ? texts.join("\n") : "[image output follows]";
				tools.push({
					role: "tool",
					callId: block.callId,
					content: block.isError ? `Error: ${body}` : body,
				});
				for (const c of block.content) {
					if (c.type === "image") {
						toolImages.push(
							textPart(`Image output of tool call ${block.callId}:`),
							imagePart(c),
						);
					}
				}
				continue;
			}
			case "text":
				if (block.text !== "") own.push(textPart(block.text));
				continue;
			case "image":
				own.push(imagePart(block));
				continue;
			default: {
				const _exhaustive: never = block;
				continue;
			}
		}
	}
	return [
		...tools,
		...(toolImages.length > 0
			? [{ role: "user", parts: toolImages } as const]
			: []),
		...(own.length > 0 ? [{ role: "user", parts: own } as const] : []),
	];
}

/** One assistant message as a draft, or none when it has no text and no calls. Reasoning is never sent. */
function assistantDrafts(message: AssistantMessage): Draft[] {
	const texts: string[] = [];
	const calls: ToolCall[] = [];
	for (const block of message.content) {
		switch (block.type) {
			case "text":
				if (block.text !== "") texts.push(block.text);
				continue;
			case "tool_call":
				calls.push({
					id: block.id,
					type: "function",
					function: {
						name: block.name,
						arguments:
							block.inputError === undefined
								? JSON.stringify(block.input)
								: "{}",
					},
				});
				continue;
			case "reasoning":
				continue;
			default: {
				const _exhaustive: never = block;
				continue;
			}
		}
	}
	return texts.length === 0 && calls.length === 0
		? []
		: [{ role: "assistant", texts, calls }];
}

/** Merges consecutive drafts of the same role (never `tool`). */
function merge(drafts: readonly Draft[]): Draft[] {
	// Fresh local arrays only: runs of same role drafts, each combined into one.
	const runs: [Draft, ...Draft[]][] = [];
	for (const draft of drafts) {
		const run = runs.at(-1);
		if (run?.[0]?.role === draft.role && draft.role !== "tool") run.push(draft);
		else runs.push([draft]);
	}
	return runs.map(combine);
}

function combine(run: readonly [Draft, ...Draft[]]): Draft {
	const users = run.flatMap((d) => (d.role === "user" ? [d] : []));
	const assistants = run.flatMap((d) => (d.role === "assistant" ? [d] : []));
	if (users.length > 1) {
		return { role: "user", parts: users.flatMap((d) => d.parts) };
	}
	if (assistants.length > 1) {
		return {
			role: "assistant",
			texts: assistants.flatMap((d) => d.texts),
			calls: assistants.flatMap((d) => d.calls),
		};
	}
	return run[0];
}

function toMessage(draft: Draft): ChatMessage {
	switch (draft.role) {
		case "user": {
			const allText = draft.parts.every((p) => p.type === "text");
			return {
				role: "user",
				content: allText
					? draft.parts
							.map((p) => (p.type === "text" ? p.text : ""))
							.join("\n\n")
					: [...draft.parts],
			};
		}
		case "tool":
			return {
				role: "tool",
				tool_call_id: draft.callId,
				content: draft.content,
			};
		case "assistant":
			return {
				role: "assistant",
				content: draft.texts.length > 0 ? draft.texts.join("\n\n") : null,
				...(draft.calls.length > 0 ? { tool_calls: [...draft.calls] } : {}),
			};
		default: {
			const _exhaustive: never = draft;
			return _exhaustive;
		}
	}
}

/** True when `baseURL` is OpenAI's own API, which wants `max_completion_tokens`. */
function isOpenAIHost(baseURL: string): boolean {
	try {
		return new URL(baseURL).hostname === "api.openai.com";
	} catch {
		return false;
	}
}

/**
 * Builds the chat request for a conversation that already passes `checkConversation` (spec 0004 AC-3).
 * Pure. Splits tool results into `tool` messages, skips empty messages, then merges same role runs.
 * Sends only `model`, `messages`, `tools`, `stream`, `stream_options` and a max tokens field.
 */
export function toChatRequest(
	request: ModelRequest,
	options: { readonly baseURL: string },
): ChatRequest {
	const drafts = request.messages.flatMap((message) =>
		message.role === "user" ? userDrafts(message) : assistantDrafts(message),
	);
	const messages: ChatMessage[] = [
		...(request.system === ""
			? []
			: [{ role: "system", content: request.system } as const]),
		...merge(drafts).map(toMessage),
	];
	const maxTokens =
		request.maxOutputTokens === undefined
			? {}
			: isOpenAIHost(options.baseURL)
				? { max_completion_tokens: request.maxOutputTokens }
				: { max_tokens: request.maxOutputTokens };
	return {
		model: request.model.model,
		messages,
		...(request.tools.length > 0
			? {
					tools: request.tools.map((tool) => ({
						type: "function" as const,
						function: {
							name: tool.name,
							description: tool.description,
							parameters: { ...tool.inputSchema },
						},
					})),
				}
			: {}),
		stream: true,
		stream_options: { include_usage: true },
		...maxTokens,
	};
}
