import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { callId, EVERY_BLOCK, PNG, user } from "./fixtures.test-support.ts";
import {
	blobHashesOf,
	fromStoredMessage,
	IMAGE_UNAVAILABLE_TEXT,
	Message,
	StoredMessage,
	toStoredMessage,
} from "./index.ts";

const sha256 = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const pngBytes = Uint8Array.from(Buffer.from(PNG, "base64"));
const pngHash = sha256(pngBytes);

const withImages = user(1, [
	{ type: "image", mediaType: "image/png", data: PNG },
	{
		type: "tool_result",
		callId: callId(2),
		isError: false,
		content: [
			{ type: "text", text: "screenshot" },
			{ type: "image", mediaType: "image/png", data: PNG },
		],
	},
]);

describe("toStoredMessage and fromStoredMessage (AC-9)", () => {
	test("replaces every image, including inside tool results, with a blob reference", () => {
		const { message, blobs } = toStoredMessage(withImages, { sha256 });
		expect(StoredMessage.parse(message)).toEqual(message);
		expect(Message.safeParse(message).success).toBe(false); // a Message never holds a blob reference
		expect(JSON.stringify(message)).not.toContain(PNG);
		expect(blobs).toEqual([{ sha256: pngHash, bytes: pngBytes }]); // the same image is written once
		expect(message.content[0]).toEqual({
			type: "image",
			mediaType: "image/png",
			blob: { sha256: pngHash, bytes: pngBytes.length },
		});
		expect(blobHashesOf(message)).toEqual([pngHash]);
	});

	test("round trips back to base64 when the blob is there", () => {
		const { message } = toStoredMessage(withImages, { sha256 });
		const back = fromStoredMessage(message, new Map([[pngHash, pngBytes]]));
		expect(back).toEqual({ message: withImages, missing: [] });
	});

	test("a missing blob becomes [image unavailable] and is listed once", () => {
		const { message } = toStoredMessage(withImages, { sha256 });
		const back = fromStoredMessage(message, new Map());
		expect(back.missing).toEqual([pngHash]);
		expect(back.message.content[0]).toEqual({
			type: "text",
			text: IMAGE_UNAVAILABLE_TEXT,
		});
		expect(Message.parse(back.message)).toEqual(back.message);
	});

	test("messages without images pass through unchanged", () => {
		for (const m of EVERY_BLOCK.filter((x) => x.role === "assistant")) {
			expect(toStoredMessage(m, { sha256 })).toEqual({ message: m, blobs: [] });
		}
	});
});
