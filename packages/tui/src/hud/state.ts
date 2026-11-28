import type {
	AgentEvent,
	CallId,
	JsonObject,
	MessageId,
	ModelRef,
	PermissionMode,
	RequestId,
	ResultOutcome,
	TodoItem,
	ToolCallBlock,
	ToolDisplayDetails,
	ToolKind,
	TurnId,
} from "@pk/schema";

/** A tool call's state on screen. */
export type ToolState = "pending" | "running" | "done" | "failed";

/** One tool call, by `CallId`. */
export interface ToolView {
	readonly callId: CallId;
	readonly name: string;
	/** From `toolTarget`, once the call's input has arrived. */
	readonly target?: string;
	readonly input?: JsonObject;
	readonly state: ToolState;
	/**
	 * Set from `classifyResultText` on an error result: denied, blocked by plan mode, or not run after
	 * a plain deny. Any outcome shows dim and stays out of the error count (spec 0006 AC-12).
	 */
	readonly outcome?: ResultOutcome;
	/** Clock time of `tool_run_start`, for the elapsed time while running. */
	readonly runAt?: number;
	readonly durationMs?: number;
	readonly sizeBytes?: number;
	readonly errorLine?: string;
	readonly display?: ToolDisplayDetails;
}

/** How loud a transcript notice is. */
export type NoticeLevel = "info" | "warning" | "danger";

/** The red line the transcript gets each time the mode enters `skip_all` (spec 0006 AC-11). */
export const SKIP_ALL_LINE = "skip all: every tool runs without asking";

/** One item of the transcript, keyed so Solid keeps its slot while it streams. */
export type TranscriptItem =
	| { readonly kind: "user"; readonly key: string; readonly text: string }
	| {
			readonly kind: "text";
			readonly key: string;
			readonly messageId: MessageId;
			readonly text: string;
	  }
	| {
			readonly kind: "reasoning";
			readonly key: string;
			readonly messageId: MessageId;
			readonly text: string;
			/** Clock times of the first and last delta. */
			readonly firstAt: number;
			readonly lastAt: number;
	  }
	| { readonly kind: "tool"; readonly key: string; readonly callId: CallId }
	| {
			readonly kind: "notice";
			readonly key: string;
			/** `danger` is the screen only red line for skip all (spec 0006 AC-11), counted as a warning. */
			readonly level: NoticeLevel;
			readonly text: string;
	  }
	| {
			readonly kind: "error";
			readonly key: string;
			readonly code: string;
			readonly message: string;
			readonly hint?: string;
	  };

/** The reply or reasoning segment new deltas of that kind extend. */
export interface OpenSegment {
	readonly messageId: MessageId;
	readonly kind: "text" | "reasoning";
	readonly key: string;
}

/** A permission request waiting for your answer. */
export interface PendingPermission {
	readonly requestId: RequestId;
	readonly call: ToolCallBlock;
	readonly kind: ToolKind;
}

/** One file the session touched, by first touch. */
export interface FileView {
	readonly path: string;
	readonly read: boolean;
	readonly added: number;
	readonly removed: number;
}

/** Everything the screen shows, built only by `reduceHud`. Plain readonly data. */
export interface HudState {
	readonly turn: {
		readonly status: "idle" | "running";
		readonly turnId?: TurnId;
	};
	readonly submitting: boolean;
	readonly transcript: readonly TranscriptItem[];
	readonly openSegment?: OpenSegment;
	/** Segments made so far per message, for `<messageId>:<n>` keys. */
	readonly segmentCounts: Readonly<Record<string, number>>;
	/** Messages that streamed any text, so their final `message` adds no second copy. */
	readonly streamedText: Readonly<Record<string, true>>;
	readonly tools: Readonly<Record<string, ToolView>>;
	readonly permissions: readonly PendingPermission[];
	readonly files: readonly FileView[];
	readonly usage: {
		readonly totalTokens: number;
		readonly lastContextTokens: number;
		readonly calls: number;
		readonly recentOutput: readonly number[];
	};
	readonly cost: {
		readonly knownMicroUsd: number;
		readonly pricedCalls: number;
		readonly unknownCalls: number;
		readonly lastTurnMicroUsd: number;
	};
	readonly todos: readonly TodoItem[];
	readonly model: ModelRef;
	/** The permission mode: `info.mode`, then each `mode_change`. */
	readonly mode: PermissionMode;
	/** Session total, never reset. */
	readonly warnings: number;
	/** Since the last `turn_start`. */
	readonly errors: number;
	readonly heroStopped: boolean;
	/** A prompt was submitted or a message arrived: the hero gives way (spec 0006 AC-11). */
	readonly hasMessage: boolean;
	/** Counter for keys of items that have no ID of their own. */
	readonly nextKey: number;
}

/** The screen's own actions, beside the `AgentEvent`s. */
export type UiAction =
	| { readonly type: "ui_submit"; readonly text: string }
	| { readonly type: "ui_respond"; readonly requestId: RequestId }
	| {
			readonly type: "ui_notice";
			readonly level: "info" | "warning";
			readonly code: string;
			readonly text: string;
	  }
	| { readonly type: "ui_hero_timeout" }
	| { readonly type: "ui_stream_end" }
	| { readonly type: "ui_stream_failed"; readonly message: string };

/** What `reduceHud` takes: an event from the session or one of the screen's own actions. */
export type HudAction = AgentEvent | UiAction;

/**
 * The state before any event, in the start mode. Starting in `skip_all` adds the red skip all line,
 * counted as a warning (spec 0006 AC-11).
 */
export function initialHudState(
	model: ModelRef,
	mode: PermissionMode,
): HudState {
	const base: HudState = {
		turn: { status: "idle" },
		submitting: false,
		transcript: [],
		segmentCounts: {},
		streamedText: {},
		tools: {},
		permissions: [],
		files: [],
		usage: { totalTokens: 0, lastContextTokens: 0, calls: 0, recentOutput: [] },
		cost: {
			knownMicroUsd: 0,
			pricedCalls: 0,
			unknownCalls: 0,
			lastTurnMicroUsd: 0,
		},
		todos: [],
		model,
		mode,
		warnings: 0,
		errors: 0,
		heroStopped: false,
		hasMessage: false,
		nextKey: 0,
	};
	return mode === "skip_all" ? withSkipAllLine(base) : base;
}

/** Adds the red skip all line and counts it as a warning. */
export function withSkipAllLine(state: HudState): HudState {
	return {
		...state,
		transcript: [
			...state.transcript,
			{
				kind: "notice",
				key: `notice:${state.nextKey}`,
				level: "danger",
				text: SKIP_ALL_LINE,
			},
		],
		openSegment: undefined,
		nextKey: state.nextKey + 1,
		warnings: state.warnings + 1,
	};
}
