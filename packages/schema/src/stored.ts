import { z } from "zod";
import {
	AssistantMessage,
	ImageMediaType,
	type Message,
	messageFields,
	TextBlock,
	type ToolResultContentBlock,
	toolResultFields,
	type UserContentBlock,
} from "./conversation.ts";

/** The text an image becomes when its blob file is missing. */
export const IMAGE_UNAVAILABLE_TEXT = "[image unavailable]";

/** A blob's address: the SHA 256 of the image bytes (64 lowercase hex) and their length. */
export const BlobRef = z
	.object({
		sha256: z
			.string()
			.regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hex characters"),
		bytes: z.number().int().min(0),
	})
	.readonly();
/** A blob's address. */
export type BlobRef = z.infer<typeof BlobRef>;

/** An image as saved: a reference to `<sessions>/<projectKey>/blobs/<sha256>`, never base64. */
export const StoredImageBlock = z
	.object({
		type: z.literal("image"),
		mediaType: ImageMediaType,
		blob: BlobRef,
	})
	.readonly();
/** An image as saved. */
export type StoredImageBlock = z.infer<typeof StoredImageBlock>;

/** A block inside a saved tool result. */
export const StoredToolResultContentBlock = z.discriminatedUnion("type", [
	TextBlock,
	StoredImageBlock,
]);
/** A block inside a saved tool result. */
export type StoredToolResultContentBlock = z.infer<
	typeof StoredToolResultContentBlock
>;

/** A tool result as saved, with `StoredImageBlock` in place of `ImageBlock`. */
export const StoredToolResultBlock = z
	.object({
		...toolResultFields,
		content: z.array(StoredToolResultContentBlock).readonly(),
	})
	.readonly();
/** A tool result as saved. */
export type StoredToolResultBlock = z.infer<typeof StoredToolResultBlock>;

/** A block in a saved user message. */
export const StoredUserContentBlock = z.discriminatedUnion("type", [
	TextBlock,
	StoredImageBlock,
	StoredToolResultBlock,
]);
/** A block in a saved user message. */
export type StoredUserContentBlock = z.infer<typeof StoredUserContentBlock>;

/** A user message as saved. */
export const StoredUserMessage = z
	.object({
		...messageFields,
		role: z.literal("user"),
		content: z.array(StoredUserContentBlock).min(1).readonly(),
	})
	.readonly();
/** A user message as saved. */
export type StoredUserMessage = z.infer<typeof StoredUserMessage>;

/** A `Message` as saved: images are blob references. Assistant messages never hold images, so they are saved as is. */
export const StoredMessage = z.discriminatedUnion("role", [
	StoredUserMessage,
	AssistantMessage,
]);
/** A `Message` as saved. */
export type StoredMessage = z.infer<typeof StoredMessage>;

/** Image bytes for the caller to write as a blob file. */
export interface BlobToWrite {
	readonly sha256: string;
	readonly bytes: Uint8Array;
}

/** What `toStoredMessage` needs: a SHA 256 function returning lowercase hex (`node:crypto` in `@pk/env`). */
export interface ToStoredOptions {
	readonly sha256: (bytes: Uint8Array) => string;
}

/**
 * Replaces every image in `message` (including images inside tool results) with a blob reference.
 * Pure and synchronous: it returns the blobs, once each, and the caller writes them.
 */
export function toStoredMessage(
	message: Message,
	options: ToStoredOptions,
): { message: StoredMessage; blobs: readonly BlobToWrite[] } {
	if (message.role === "assistant") return { message, blobs: [] };

	const blobs = new Map<string, Uint8Array>();
	const store = (block: {
		mediaType: ImageMediaType;
		data: string;
	}): StoredImageBlock => {
		const bytes = Uint8Array.from(Buffer.from(block.data, "base64"));
		const sha256 = options.sha256(bytes);
		blobs.set(sha256, bytes);
		return {
			type: "image",
			mediaType: block.mediaType,
			blob: { sha256, bytes: bytes.length },
		};
	};
	const storeInner = (
		block: ToolResultContentBlock,
	): StoredToolResultContentBlock =>
		block.type === "image" ? store(block) : block;

	const content = message.content.map(
		(block: UserContentBlock): StoredUserContentBlock => {
			switch (block.type) {
				case "text":
					return block;
				case "image":
					return store(block);
				case "tool_result":
					return { ...block, content: block.content.map(storeInner) };
				default: {
					const unhandled: never = block;
					return unhandled;
				}
			}
		},
	);
	return {
		message: { ...message, content },
		blobs: [...blobs].map(([sha256, bytes]) => ({ sha256, bytes })),
	};
}

/**
 * Turns a saved message back into a `Message`, restoring base64 data from `blobs` (keyed by SHA 256).
 * An image whose blob is missing becomes the text `[image unavailable]`, and its hash is listed in
 * `missing`, once.
 */
export function fromStoredMessage(
	stored: StoredMessage,
	blobs: ReadonlyMap<string, Uint8Array>,
): { message: Message; missing: readonly string[] } {
	if (stored.role === "assistant") return { message: stored, missing: [] };

	const missing = new Set<string>();
	const restore = (block: StoredImageBlock): ToolResultContentBlock => {
		const bytes = blobs.get(block.blob.sha256);
		if (bytes === undefined) {
			missing.add(block.blob.sha256);
			return { type: "text", text: IMAGE_UNAVAILABLE_TEXT };
		}
		return {
			type: "image",
			mediaType: block.mediaType,
			data: Buffer.from(bytes).toString("base64"),
		};
	};
	const restoreInner = (
		block: StoredToolResultContentBlock,
	): ToolResultContentBlock =>
		block.type === "image" ? restore(block) : block;

	const content = stored.content.map(
		(block: StoredUserContentBlock): UserContentBlock => {
			switch (block.type) {
				case "text":
					return block;
				case "image":
					return restore(block);
				case "tool_result":
					return { ...block, content: block.content.map(restoreInner) };
				default: {
					const unhandled: never = block;
					return unhandled;
				}
			}
		},
	);
	return { message: { ...stored, content }, missing: [...missing] };
}

/** Every blob hash a saved message refers to, so a reader knows which blob files to load. */
export function blobHashesOf(stored: StoredMessage): readonly string[] {
	if (stored.role === "assistant") return [];
	const hashes = stored.content.flatMap((block) => {
		switch (block.type) {
			case "text":
				return [];
			case "image":
				return [block.blob.sha256];
			case "tool_result":
				return block.content.flatMap((inner) =>
					inner.type === "image" ? [inner.blob.sha256] : [],
				);
			default: {
				const unhandled: never = block;
				return unhandled;
			}
		}
	});
	return [...new Set(hashes)];
}
