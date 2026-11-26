import type {
	AgentEvent,
	CallId,
	JsonObject,
	MessageId,
	ModelRef,
	RequestId,
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
	/** You denied it, so it stays out of the error count. */
	readonly denied: boolean;
	/** Clock time of `tool_run_start`, for the elapsed time while running. */
	readonly runAt?: number;
	readonly durationMs?: number;
	readonly sizeBytes?: number;
	readonly errorLine?: string;
	readonly display?: ToolDisplayDetails;
}

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
			readonly level: "info" | "warning";
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
	/** Session total, never reset. */
	readonly warnings: number;
	/** Since the last `turn_start`. */
	readonly errors: number;
	readonly heroStopped: boolean;
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

/** The state before any event. */
export function initialHudState(model: ModelRef): HudState {
	return {
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
		warnings: 0,
		errors: 0,
		heroStopped: false,
		nextKey: 0,
	};
}
