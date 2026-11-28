import { z } from "zod";
import type { Message } from "./conversation.ts";
import {
	type AgentEvent,
	TodoItem,
	TurnEndReason,
	TurnError,
} from "./events.ts";
import {
	AgentId,
	MAIN_AGENT_ID,
	type MessageId,
	MessageId as MessageIdSchema,
	ModelRef,
	ModelRole,
	SessionId,
	Timestamp,
	TurnId,
} from "./primitives.ts";
import { Cost, Usage } from "./provider.ts";
import { repairConversation } from "./repair.ts";
import { blobHashesOf, fromStoredMessage, StoredMessage } from "./stored.ts";

/** The session file format this pk reads and writes. Only a pk of the same version appends to a file. */
export const SESSION_VERSION = 1;

/**
 * Upgrades one raw record (the header included) from version `v` to `v + 1`. Pure. `header` is the raw
 * header at version `v`.
 */
export type SessionMigration = (raw: unknown, header: unknown) => unknown;

/** Each older session version mapped to the migration that upgrades it by one. Empty at version 1. */
export const SESSION_MIGRATIONS: Readonly<Record<number, SessionMigration>> =
	{};

/** The first line of every session file. */
export const SessionHeader = z
	.object({
		type: z.literal("header"),
		v: z.literal(SESSION_VERSION),
		sessionId: SessionId,
		createdAt: Timestamp,
		cwd: z.string(),
		projectRoot: z.string(),
		pkVersion: z.string(),
		model: ModelRef,
		parentSessionId: SessionId.optional(),
	})
	.readonly();
/** The first line of every session file. */
export type SessionHeader = z.infer<typeof SessionHeader>;

/** A completed message, with images as blob references. */
export const MessageRecord = z
	.object({
		type: z.literal("message"),
		at: Timestamp,
		agentId: AgentId,
		message: StoredMessage,
	})
	.readonly();
/** A completed message record. */
export type MessageRecord = z.infer<typeof MessageRecord>;

/** One model call's usage and cost. */
export const UsageRecord = z
	.object({
		type: z.literal("usage"),
		at: Timestamp,
		agentId: AgentId,
		model: ModelRef,
		usage: Usage,
		cost: Cost,
	})
	.readonly();
/** One model call's usage and cost. */
export type UsageRecord = z.infer<typeof UsageRecord>;

/** The whole to do list after a change. */
export const TodoRecord = z
	.object({
		type: z.literal("todo"),
		at: Timestamp,
		todos: z.array(TodoItem).readonly(),
	})
	.readonly();
/** The whole to do list after a change. */
export type TodoRecord = z.infer<typeof TodoRecord>;

/** A model switch for one role. */
export const ModelChangeRecord = z
	.object({
		type: z.literal("model_change"),
		at: Timestamp,
		role: ModelRole,
		model: ModelRef,
	})
	.readonly();
/** A model switch for one role. */
export type ModelChangeRecord = z.infer<typeof ModelChangeRecord>;

/**
 * Marks a summary (#25): the message `summaryMessageId` replaces every message up to and including
 * `replacesThrough` in the model context. Written after its summary `message` record.
 */
export const CompactionRecord = z
	.object({
		type: z.literal("compaction"),
		at: Timestamp,
		summaryMessageId: MessageIdSchema,
		replacesThrough: MessageIdSchema,
	})
	.readonly();
/** Marks a summary. */
export type CompactionRecord = z.infer<typeof CompactionRecord>;

/** The end of a turn. */
export const TurnEndRecord = z
	.object({
		type: z.literal("turn_end"),
		at: Timestamp,
		agentId: AgentId,
		turnId: TurnId,
		reason: TurnEndReason,
		error: TurnError.optional(),
	})
	.readonly();
/** The end of a turn. */
export type TurnEndRecord = z.infer<typeof TurnEndRecord>;

/**
 * Any line after the header in a session file. Fields this pk does not know are stripped, not refused,
 * so a newer pk's optional fields never break an older one.
 */
export const SessionRecord = z.discriminatedUnion("type", [
	MessageRecord,
	UsageRecord,
	TodoRecord,
	ModelChangeRecord,
	CompactionRecord,
	TurnEndRecord,
]);
/** Any line after the header in a session file. */
export type SessionRecord = z.infer<typeof SessionRecord>;

/**
 * The record a session saves for an event: `message` (pass the message after `toStoredMessage` as
 * `stored`), `usage`, `todo_update`, `model_change` and `turn_end`. Every other event returns `undefined`,
 * and so does a `message` event without `stored`.
 */
export function sessionRecordFromEvent(
	event: AgentEvent,
	stored?: StoredMessage,
): SessionRecord | undefined {
	switch (event.type) {
		case "message":
			return stored === undefined
				? undefined
				: {
						type: "message",
						at: event.at,
						agentId: event.agentId,
						message: stored,
					};
		case "usage":
			return {
				type: "usage",
				at: event.at,
				agentId: event.agentId,
				model: event.model,
				usage: event.usage,
				cost: event.cost,
			};
		case "todo_update":
			return { type: "todo", at: event.at, todos: event.todos };
		case "model_change":
			return {
				type: "model_change",
				at: event.at,
				role: event.role,
				model: event.model,
			};
		case "turn_end":
			return {
				type: "turn_end",
				at: event.at,
				agentId: event.agentId,
				turnId: event.turnId,
				reason: event.reason,
				...(event.error === undefined ? {} : { error: event.error }),
			};
		case "turn_start":
		case "text_delta":
		case "reasoning_delta":
		case "tool_call_start":
		case "permission_request":
		case "tool_run_start":
		case "tool_result":
		case "notice":
		case "mode_change": // persisting it is #24's call (spec 0006 AC-13)
			return undefined;
		default: {
			const unhandled: never = event;
			return unhandled;
		}
	}
}

/** A session rebuilt from its records. */
export interface SessionState {
	readonly header: SessionHeader;
	/** Every main agent message, in order, with duplicates removed. Not repaired: this is the history to show. */
	readonly transcript: readonly Message[];
	/** What the model sees next: the latest valid compaction's summary and what follows it, repaired. */
	readonly context: readonly Message[];
	readonly todos: readonly TodoItem[];
	readonly models: Readonly<Partial<Record<ModelRole, ModelRef>>>;
	readonly lastTurnEnd?: TurnEndRecord;
	/** Results added plus results (and duplicate calls) dropped while repairing `context`. */
	readonly repaired: number;
	/** Records the fold ignored: repeated message IDs and compactions naming an unknown message. */
	readonly skipped: number;
	/** Blob hashes the transcript refers to but `blobs` did not hold. Those images read `[image unavailable]`. */
	readonly missingBlobs: readonly string[];
}

/** What `foldSessionRecords` needs. */
export interface FoldOptions {
	readonly newId: (prefix: "msg") => MessageId;
	/** Image bytes by SHA 256, for every hash `sessionBlobHashes` lists. */
	readonly blobs: ReadonlyMap<string, Uint8Array>;
}

/** Every blob hash the main agent's messages refer to, so the caller can read those blob files before folding. */
export function sessionBlobHashes(
	records: readonly SessionRecord[],
): readonly string[] {
	return [
		...new Set(
			records.flatMap((r) =>
				r.type === "message" && r.agentId === MAIN_AGENT_ID
					? blobHashesOf(r.message)
					: [],
			),
		),
	];
}

function isMainAgent(record: SessionRecord): boolean {
	return !("agentId" in record) || record.agentId === MAIN_AGENT_ID;
}

/**
 * Rebuilds a session from its header and records, using only the main agent's records. Records without
 * an `agentId` (to do, model change, compaction) count as the main agent's.
 *
 * - `models.main` starts from `header.model`; `model_change` records override it.
 * - A message whose ID was already seen is skipped and counted.
 * - The context is the latest valid compaction's summary followed by every transcript message after
 *   `replacesThrough`. A compaction naming an unknown message is ignored and counted.
 * - The context is repaired with `closePendingTail: true`, so it always passes `checkConversation`.
 */
export function foldSessionRecords(
	header: SessionHeader,
	records: readonly SessionRecord[],
	options: FoldOptions,
): SessionState {
	const main = records.filter(isMainAgent);
	const seen = new Set<MessageId>();
	const missingBlobs = new Set<string>();
	const transcript: Message[] = [];
	let skipped = 0;

	for (const record of main) {
		if (record.type !== "message") continue;
		if (seen.has(record.message.id)) {
			skipped++;
			continue;
		}
		seen.add(record.message.id);
		const restored = fromStoredMessage(record.message, options.blobs);
		for (const hash of restored.missing) missingBlobs.add(hash);
		transcript.push(restored.message);
	}

	const compactions = main.filter(
		(r): r is CompactionRecord => r.type === "compaction",
	);
	const valid = compactions.filter(
		(c) => seen.has(c.summaryMessageId) && seen.has(c.replacesThrough),
	);
	skipped += compactions.length - valid.length;
	const compaction = valid.at(-1);

	const context =
		compaction === undefined ? transcript : compacted(transcript, compaction);
	const repair = repairConversation(context, {
		newId: options.newId,
		closePendingTail: true,
	});

	const models: Partial<Record<ModelRole, ModelRef>> = Object.fromEntries([
		["main", header.model],
		...main.flatMap((r) =>
			r.type === "model_change" ? [[r.role, r.model] as const] : [],
		),
	]);
	const todos = main.reduce<readonly TodoItem[]>(
		(acc, r) => (r.type === "todo" ? r.todos : acc),
		[],
	);
	const lastTurnEnd = main.findLast(
		(r): r is TurnEndRecord => r.type === "turn_end",
	);

	return {
		header,
		transcript,
		context: repair.messages,
		todos,
		models,
		...(lastTurnEnd === undefined ? {} : { lastTurnEnd }),
		repaired: repair.changes,
		skipped,
		missingBlobs: [...missingBlobs],
	};
}

/** The summary message, then every message after `replacesThrough` except the summary itself. */
function compacted(
	transcript: readonly Message[],
	compaction: CompactionRecord,
): readonly Message[] {
	const summary = transcript.find((m) => m.id === compaction.summaryMessageId);
	const cut = transcript.findIndex((m) => m.id === compaction.replacesThrough);
	if (summary === undefined || cut < 0) return transcript;
	return [
		summary,
		...transcript.slice(cut + 1).filter((m) => m.id !== summary.id),
	];
}
