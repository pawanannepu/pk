/**
 * Helpers for this package's tests: a session on the scripted fake provider, an in memory file
 * system, and an event reader. Not exported from `index.ts`; imported only by `*.test.ts` files.
 */
import { createIdFactory, silentLogger } from "@pk/env";
import type { StartNotice } from "@pk/permissions";
import {
	createFakeProvider,
	DEFAULT_RETRY_POLICY,
	type FakeProvider,
	type Provider,
	withRetry,
} from "@pk/provider";
import {
	type AgentEvent,
	CallId,
	type FakeStep,
	type JsonObject,
	type PermissionMode,
	type ProviderStreamEvent,
	type ToolKind,
	type ToolName,
} from "@pk/schema";
import {
	defineTool,
	type FileSystem,
	ReadFileInput,
	readFileTool,
	type Tool,
	type ToolOutcome,
} from "@pk/tools";
import { type AgentSession, createAgentSession } from "./session.ts";

/** The project root the in memory file system serves. */
export const ROOT = "/project";

/** A fixed, valid call id for `n`. */
export const callId = (n: number): CallId =>
	CallId.parse(`call_01JDX8Z3QK5V7W9Y0A2B4C6D${String(n).padStart(2, "0")}`);

/** The stream events of one finished call to `name` with `input`. */
export function callEvents(
	n: number,
	name: ToolName,
	input: JsonObject,
	inputError?: string,
): ProviderStreamEvent[] {
	return [
		{ type: "tool_call_start", callId: callId(n), name },
		{
			type: "tool_call_end",
			callId: callId(n),
			input,
			...(inputError === undefined ? {} : { inputError }),
		},
	];
}

const usage: ProviderStreamEvent = {
	type: "usage",
	usage: {
		inputTokens: 10,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		outputTokens: 5,
	},
};

/** A step that makes these calls and stops with `tool_use`. */
export function toolStep(...calls: ProviderStreamEvent[][]): FakeStep {
	return {
		events: [...calls.flat(), usage, { type: "stop", reason: "tool_use" }],
	};
}

/** A step that answers with text and stops with `end_turn`. */
export function textStep(text: string): FakeStep {
	return {
		events: [
			{ type: "text_delta", text },
			usage,
			{ type: "stop", reason: "end_turn" },
		],
	};
}

const enoent = (path: string) =>
	Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });

/** A file system holding `files` (path relative to `ROOT` → text). Every folder on the way exists. */
export function memoryFs(files: Readonly<Record<string, string>>): FileSystem {
	const full = new Map(
		Object.entries(files).map(([p, text]) => [`${ROOT}/${p}`, text]),
	);
	const isDir = (path: string) =>
		path === "/" ||
		path === ROOT ||
		[...full.keys()].some((f) => f.startsWith(`${path}/`));
	return {
		realpath: async (path) => {
			if (full.has(path) || isDir(path)) return path;
			throw enoent(path);
		},
		stat: async (path) => {
			const text = full.get(path);
			if (text !== undefined) {
				return {
					kind: "file",
					size: Buffer.byteLength(text),
					mtimeMs: 1000,
				};
			}
			if (isDir(path)) return { kind: "directory", size: 0, mtimeMs: 1000 };
			throw enoent(path);
		},
		readFile: async (path) => {
			const text = full.get(path);
			if (text === undefined) throw enoent(path);
			return new TextEncoder().encode(text);
		},
	};
}

/** A test only tool: `run` decides the outcome. Its input is `{ path }`, so `agent` needs no `zod`. */
export function testTool(
	name: string,
	kind: Exclude<ToolKind, "execute">,
	run: (signal: AbortSignal) => Promise<ToolOutcome>,
): Tool {
	return defineTool({
		name,
		kind,
		description: `test tool ${name}`,
		input: ReadFileInput,
		run: (_input, ctx) => run(ctx.signal),
	});
}

/** A test only `execute` tool: its `path` input stands in for the command, the exact session key. */
export function testCommandTool(
	name: string,
	run: (signal: AbortSignal) => Promise<ToolOutcome>,
): Tool {
	return defineTool({
		name,
		kind: "execute",
		description: `test command tool ${name}`,
		input: ReadFileInput,
		sessionKey: (input) => input.path,
		run: (_input, ctx) => run(ctx.signal),
	});
}

function isType<T extends AgentEvent["type"]>(
	event: AgentEvent,
	type: T,
): event is Extract<AgentEvent, { type: T }> {
	return event.type === type;
}

/** What `startSession` takes. */
export interface HarnessOptions {
	readonly tools?: readonly Tool[];
	readonly maxTurns?: number;
	readonly files?: Readonly<Record<string, string>>;
	readonly maxRetries?: number;
	/** Replaces the provider the session gets (the fake still records nothing then). */
	readonly provider?: Provider;
	readonly mode?: PermissionMode;
	readonly skipAllAvailable?: boolean;
	readonly notices?: readonly StartNotice[];
}

/** A session on the fake provider, with an event reader. */
export interface Harness {
	readonly session: AgentSession;
	readonly fake: FakeProvider;
	/** Every event read so far. */
	readonly events: AgentEvent[];
	/** Reads until `n` more `turn_end` events (default 1) were read. */
	turns(n?: number): Promise<void>;
	/** Reads until an event of `type` arrives, and returns it. */
	until<T extends AgentEvent["type"]>(
		type: T,
	): Promise<Extract<AgentEvent, { type: T }>>;
	/** The event types read so far, in order. */
	types(): string[];
}

/** Starts a session on a fake provider playing `steps`. */
export function startSession(
	steps: readonly FakeStep[],
	options: HarnessOptions = {},
): Harness {
	const sleep = async () => {};
	let clock = 1_700_000_000_000;
	const now = () => {
		clock += 1;
		return clock;
	};
	const fake = createFakeProvider({ script: { v: 1, steps }, sleep });
	const provider = withRetry(fake, {
		sleep,
		random: () => 0,
		now,
		logger: silentLogger,
		policy: {
			...DEFAULT_RETRY_POLICY,
			maxRetries: options.maxRetries ?? DEFAULT_RETRY_POLICY.maxRetries,
		},
	});
	let seed = 0;
	const newId = createIdFactory({
		now,
		randomBytes: (n) => {
			seed += 1;
			return new Uint8Array(n).fill(seed % 256);
		},
	});
	const session = createAgentSession({
		provider: options.provider ?? provider,
		model: { provider: "fake", model: "fake" },
		tools: options.tools ?? [readFileTool],
		fs: memoryFs(options.files ?? {}),
		projectRoot: ROOT,
		today: "2026-11-27",
		maxTurns: options.maxTurns ?? 50,
		newId,
		now,
		logger: silentLogger,
		mode: options.mode ?? "normal",
		skipAllAvailable: options.skipAllAvailable ?? false,
		notices: options.notices ?? [],
	});
	const reader = session.events[Symbol.asyncIterator]();
	const events: AgentEvent[] = [];
	const read = async (): Promise<AgentEvent | undefined> => {
		const next = await reader.next();
		if (next.done) return undefined;
		events.push(next.value);
		return next.value;
	};
	return {
		session,
		fake,
		events,
		async turns(n = 1) {
			let seen = 0;
			while (seen < n) {
				const event = await read();
				if (event === undefined) return;
				if (event.type === "turn_end") seen += 1;
			}
		},
		async until(type) {
			for (;;) {
				const event = await read();
				if (event === undefined) throw new Error(`events ended before ${type}`);
				if (isType(event, type)) return event;
			}
		},
		types: () => events.map((e) => e.type),
	};
}

/** The texts of every `tool_result` event, in order. */
export function resultTexts(events: readonly AgentEvent[]): string[] {
	return events.flatMap((e) =>
		e.type === "tool_result"
			? e.result.content.flatMap((b) => (b.type === "text" ? [b.text] : []))
			: [],
	);
}
