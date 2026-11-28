import {
	type JsonObject,
	type ToolDefinition,
	type ToolDisplayDetails,
	type ToolKind,
	type ToolName,
	type ToolResultContentBlock,
	toolInputJsonSchema,
} from "@pk/schema";
import type { z } from "zod";

/** What a tool learned about a file it read, kept in the session's read ledger for the edit tools (#8). */
export interface FileStamp {
	/** The real absolute path. */
	readonly path: string;
	readonly mtimeMs: number;
	readonly size: number;
	/** The lines returned, from 1, and the file's line count. An empty file is `{ 0, 0, 0 }`. */
	readonly lines: {
		readonly from: number;
		readonly to: number;
		readonly total: number;
	};
}

/** What `FileSystem.stat` reports. */
export interface FileStat {
	readonly kind: "file" | "directory" | "other";
	readonly size: number;
	readonly mtimeMs: number;
}

/**
 * The file system port tools read through, built by `cli` from `node:fs/promises`. Failures throw
 * errors with a Node `code` (`ENOENT`, `EACCES`, `EPERM`, `ENOTDIR`, `ELOOP`).
 */
export interface FileSystem {
	realpath(path: string): Promise<string>;
	stat(path: string): Promise<FileStat>;
	readFile(path: string): Promise<Uint8Array>;
}

/** What the loop hands a tool for one call. Tools never change session state; they return stamps. */
export interface ToolContext {
	/** The turn's one signal. */
	readonly signal: AbortSignal;
	/** The project root, as a real path. */
	readonly projectRoot: string;
	readonly fs: FileSystem;
	/** The session's read ledger, real path to latest stamp. Read only. */
	readonly ledger: ReadonlyMap<string, FileStamp>;
}

/** A tool's answer to one call. The loop wraps it into a `ToolResultBlock` with the call's `callId`. */
export interface ToolOutcome {
	readonly content: readonly ToolResultContentBlock[];
	readonly isError: boolean;
	readonly details?: ToolDisplayDetails;
	/** Files read, folded into the session's ledger by the loop. */
	readonly stamps?: readonly FileStamp[];
}

/** The fields every tool spec has, whatever its kind. */
interface ToolSpecBase<I> {
	readonly name: ToolName;
	readonly description: string;
	readonly input: z.ZodType<I>;
	/** Runs the call. Throw a `ToolError` for a failure the model should see as an error result. */
	run(input: I, ctx: ToolContext): Promise<ToolOutcome>;
}

/** An `execute` kind spec must say what `[a] this command` allows: the exact string, used as is. */
interface ExecuteToolSpec<I> extends ToolSpecBase<I> {
	readonly kind: "execute";
	/** The session allow key for one call, like the exact command string (spec 0006 AC-2). */
	sessionKey(input: I): string;
}

/** Every other kind keys session allows by tool name, so it cannot declare `sessionKey`. */
interface NamedToolSpec<I> extends ToolSpecBase<I> {
	readonly kind: Exclude<ToolKind, "execute">;
	readonly sessionKey?: never;
}

/**
 * What a tool author writes: the model facing definition, the Zod input schema, and `run`. The kind
 * must be a literal: `execute` needs `sessionKey`, and no other kind may have it (spec 0006 AC-2).
 */
export type ToolSpec<I> = ExecuteToolSpec<I> | NamedToolSpec<I>;

/** The result of `Tool.validate`: input ready for `execute`, or the error outcome to send back. */
export type ToolValidation =
	| { readonly ok: true; readonly input: unknown }
	| { readonly ok: false; readonly outcome: ToolOutcome };

/** A tool as the loop sees it. Made by `defineTool`, so the loop never needs `zod`. */
export interface Tool {
	readonly definition: ToolDefinition;
	/** Parses the model's raw input. Called before the permission check, so bad input never prompts. */
	validate(raw: JsonObject): ToolValidation;
	/** Runs the call on a value `validate` produced. */
	execute(input: unknown, ctx: ToolContext): Promise<ToolOutcome>;
	/**
	 * The key `decide` checks and `allow_session` stores, for a value `validate` produced: the tool
	 * name, or `<name>:<sessionKey(input)>` for an `execute` tool (spec 0006 AC-2).
	 */
	permissionKey(input: unknown): string;
}

/** The key a parse failure gives: `allow_session` never stores it, so it can never widen an allow. */
export function invalidPermissionKey(name: string): string {
	return `${name}:\u0000invalid`;
}

/** A plain text outcome. */
export function textOutcome(text: string, isError: boolean): ToolOutcome {
	return { content: [{ type: "text", text }], isError };
}

/** One `path: message` line per issue; an issue at the top level reads `input: message`. */
function issueLines(error: z.ZodError): string {
	return error.issues
		.map((issue) => {
			const path = issue.path.map(String).join(".");
			return `${path === "" ? "input" : path}: ${issue.message}`;
		})
		.join("\n");
}

/** The AC-4 invalid input text: `Invalid input for <name>: <issues, one per line>`. */
export function invalidInputText(name: string, error: z.ZodError): string {
	return `Invalid input for ${name}: ${issueLines(error)}`;
}

/**
 * Builds a `Tool` from its spec: the JSON Schema for the model, and Zod parsing on both entries. The
 * kind must be a literal, so whether `sessionKey` is required is always known (spec 0006 AC-2).
 */
export function defineTool<I>(spec: ToolSpec<I>): Tool {
	const invalid = (error: z.ZodError): ToolOutcome =>
		textOutcome(invalidInputText(spec.name, error), true);
	return {
		definition: {
			name: spec.name,
			description: spec.description,
			inputSchema: toolInputJsonSchema(spec.input),
			kind: spec.kind,
		},
		validate(raw) {
			const parsed = spec.input.safeParse(raw);
			return parsed.success
				? { ok: true, input: parsed.data }
				: { ok: false, outcome: invalid(parsed.error) };
		},
		// The value came from `validate`; parsing again keeps it typed without a cast.
		async execute(input, ctx) {
			const parsed = spec.input.safeParse(input);
			if (!parsed.success) return invalid(parsed.error);
			return spec.run(parsed.data, ctx);
		},
		permissionKey(input) {
			const parsed = spec.input.safeParse(input);
			if (!parsed.success) return invalidPermissionKey(spec.name);
			return spec.kind === "execute"
				? `${spec.name}:${spec.sessionKey(parsed.data)}`
				: spec.name;
		},
	};
}
