import { z } from "zod";

/**
 * One file a tool call read or changed, for the screen's FILES panel. `path` is relative to the
 * project root when the file is inside it, absolute otherwise. `added` and `removed` count lines.
 */
export const FileTouch = z
	.object({
		path: z.string().min(1),
		action: z.enum(["read", "write", "edit"]),
		added: z.number().int().min(0).optional(),
		removed: z.number().int().min(0).optional(),
	})
	.readonly();
/** One file a tool call read or changed. */
export type FileTouch = z.infer<typeof FileTouch>;

/**
 * What a tool puts in `ToolResultBlock.details` so the screen can show it (spec 0003): the files it
 * touched and a unified patch (the `diff -u` text format). Not strict: a tool may add other keys,
 * and the screen ignores them.
 */
export const ToolDisplayDetails = z
	.object({
		files: z.array(FileTouch).readonly().optional(),
		diff: z.string().optional(),
	})
	.readonly();
/** What a tool puts in `ToolResultBlock.details` for the screen. */
export type ToolDisplayDetails = z.infer<typeof ToolDisplayDetails>;
