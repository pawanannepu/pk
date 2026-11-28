import { redact } from "@pk/env";
import {
	type AgentEventOf,
	type CallId,
	classifyResultText,
	type JsonObject,
	MAIN_AGENT_ID,
	type MessageId,
	sumCosts,
	ToolDisplayDetails,
} from "@pk/schema";
import { ERROR_HINTS } from "../error-hints.ts";
import { SPARK_CALLS } from "../hud-constants.ts";
import { toolTarget } from "../text.ts";
import {
	type FileView,
	type HudAction,
	type HudState,
	type ToolView,
	type TranscriptItem,
	withSkipAllLine,
} from "./state.ts";

const UTF8 = new TextEncoder();

const timeOf = (at: string): number => Date.parse(at);

/** Appends an item and closes the open segment (AC-11: a segment ends when any other item is added). */
function addItem(state: HudState, item: TranscriptItem): HudState {
	return {
		...state,
		transcript: [...state.transcript, item],
		openSegment: undefined,
	};
}

/** A key for an item with no ID of its own. */
function withKey(state: HudState, prefix: string): [HudState, string] {
	return [
		{ ...state, nextKey: state.nextKey + 1 },
		`${prefix}:${state.nextKey}`,
	];
}

function addNotice(
	state: HudState,
	level: "info" | "warning",
	text: string,
): HudState {
	const [keyed, key] = withKey(state, "notice");
	const added = addItem(keyed, {
		kind: "notice",
		key,
		level,
		text: redact(text),
	});
	return level === "warning"
		? { ...added, warnings: added.warnings + 1 }
		: added;
}

function addError(state: HudState, code: string, message: string): HudState {
	const [keyed, key] = withKey(state, "error");
	const safeCode = redact(code);
	const hint = ERROR_HINTS[code];
	return addItem(keyed, {
		kind: "error",
		key,
		code: safeCode,
		message: redact(message),
		...(hint === undefined ? {} : { hint }),
	});
}

/** Extends the open segment of this kind for this message, or starts a new one. */
function addDelta(
	state: HudState,
	kind: "text" | "reasoning",
	messageId: MessageId,
	text: string,
	at: number,
): HudState {
	const open = state.openSegment;
	const streamed =
		kind === "text"
			? { ...state.streamedText, [messageId]: true as const }
			: state.streamedText;
	if (open && open.messageId === messageId && open.kind === kind) {
		const index = state.transcript.findLastIndex(
			(item) => item.key === open.key,
		);
		const item = state.transcript[index];
		if (item && (item.kind === "text" || item.kind === "reasoning")) {
			const next: TranscriptItem =
				item.kind === "reasoning"
					? { ...item, text: item.text + text, lastAt: at }
					: { ...item, text: item.text + text };
			const transcript = state.transcript.with(index, next);
			return { ...state, transcript, streamedText: streamed };
		}
	}
	const n = state.segmentCounts[messageId] ?? 0;
	const key = `${messageId}:${n}`;
	const item: TranscriptItem =
		kind === "reasoning"
			? { kind, key, messageId, text, firstAt: at, lastAt: at }
			: { kind, key, messageId, text };
	return {
		...addItem(state, item),
		segmentCounts: { ...state.segmentCounts, [messageId]: n + 1 },
		streamedText: streamed,
		openSegment: { messageId, kind, key },
	};
}

/** Sets a tool's input and target the first time either source carries them. */
function withInput(
	state: HudState,
	callId: CallId,
	input: JsonObject,
): HudState {
	const tool = state.tools[callId];
	if (!tool || tool.input !== undefined) return state;
	const target = toolTarget(input);
	return {
		...state,
		tools: {
			...state.tools,
			[callId]: { ...tool, input, ...(target === undefined ? {} : { target }) },
		},
	};
}

/** The tool for `callId`, created on the spot (named `tool`) when no `tool_call_start` came first. */
function ensureTool(state: HudState, callId: CallId): [HudState, ToolView] {
	const known = state.tools[callId];
	if (known) return [state, known];
	const tool: ToolView = {
		callId,
		name: "tool",
		state: "pending",
	};
	const added = addItem(
		{ ...state, tools: { ...state.tools, [callId]: tool } },
		{ kind: "tool", key: `tool:${callId}`, callId },
	);
	return [added, tool];
}

function touchFiles(
	files: readonly FileView[],
	display: ToolDisplayDetails,
): readonly FileView[] {
	// A fresh local copy, so the previous state's array is never changed.
	const next = [...files];
	for (const touch of display.files ?? []) {
		const index = next.findIndex((f) => f.path === touch.path);
		const base: FileView = next[index] ?? {
			path: touch.path,
			read: false,
			added: 0,
			removed: 0,
		};
		const updated: FileView = {
			...base,
			read: base.read || touch.action === "read",
			added: base.added + (touch.added ?? 0),
			removed: base.removed + (touch.removed ?? 0),
		};
		if (index >= 0) next[index] = updated;
		else next.push(updated);
	}
	return next;
}

function onToolResult(
	state: HudState,
	event: AgentEventOf<"tool_result">,
): HudState {
	const { result } = event;
	const [ensured, tool] = ensureTool(state, result.callId);
	const texts = result.content.flatMap((block) =>
		block.type === "text" ? [block.text] : [],
	);
	const firstText = texts[0] ?? "";
	const outcome = result.isError ? classifyResultText(firstText) : undefined;
	const parsed = ToolDisplayDetails.safeParse(result.details);
	const display = parsed.success ? parsed.data : undefined;
	const { outcome: _old, ...rest } = tool;
	const next: ToolView = {
		...rest,
		state: result.isError ? "failed" : "done",
		...(outcome === undefined ? {} : { outcome }),
		durationMs: event.durationMs,
		sizeBytes: texts.reduce((sum, text) => sum + UTF8.encode(text).length, 0),
		...(result.isError ? { errorLine: firstText.split("\n")[0] ?? "" } : {}),
		...(display === undefined ? {} : { display }),
	};
	return {
		...dropPermission(ensured, result.callId),
		tools: { ...ensured.tools, [result.callId]: next },
		files: display ? touchFiles(ensured.files, display) : ensured.files,
		errors:
			result.isError && outcome === undefined
				? ensured.errors + 1
				: ensured.errors,
	};
}

/**
 * Drops a pending permission for this call: a mode switch settled it, so the panel closes
 * (spec 0006 AC-9).
 */
function dropPermission(state: HudState, callId: CallId): HudState {
	const kept = state.permissions.filter((p) => p.call.id !== callId);
	return kept.length === state.permissions.length
		? state
		: { ...state, permissions: kept };
}

function onMessage(
	unmarked: HudState,
	event: AgentEventOf<"message">,
): HudState {
	const state = unmarked.hasMessage
		? unmarked
		: { ...unmarked, hasMessage: true };
	const { message } = event;
	if (message.role === "user") {
		const text = message.content
			.flatMap((block) => (block.type === "text" ? [block.text] : []))
			.join("\n");
		if (text === "") return state; // tool results going back to the model
		const [keyed, key] = withKey(state, "user");
		return addItem(keyed, { kind: "user", key, text });
	}
	const withInputs = message.content.reduce(
		(acc, block) =>
			block.type === "tool_call" ? withInput(acc, block.id, block.input) : acc,
		state,
	);
	// The message is complete: later deltas for it would start a new segment.
	const closed =
		withInputs.openSegment?.messageId === message.id
			? { ...withInputs, openSegment: undefined }
			: withInputs;
	if (closed.streamedText[message.id]) return closed;
	const text = message.content
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("");
	if (text === "") return closed;
	const n = closed.segmentCounts[message.id] ?? 0;
	return {
		...addItem(closed, {
			kind: "text",
			key: `${message.id}:${n}`,
			messageId: message.id,
			text,
		}),
		segmentCounts: { ...closed.segmentCounts, [message.id]: n + 1 },
		streamedText: { ...closed.streamedText, [message.id]: true },
	};
}

function onTurnEnd(state: HudState, event: AgentEventOf<"turn_end">): HudState {
	// A call still pending or running when the turn ends was cut off: failed, not counted.
	const tools = Object.fromEntries(
		Object.entries(state.tools).map(([id, tool]) => [
			id,
			tool.state === "pending" || tool.state === "running"
				? { ...tool, state: "failed" as const, errorLine: "interrupted" }
				: tool,
		]),
	);
	const ended: HudState = {
		...state,
		tools,
		turn: { status: "idle" },
		submitting: false,
		permissions: [],
		openSegment: undefined,
	};
	switch (event.reason) {
		case "done":
			return ended;
		case "interrupted":
			return addNotice(ended, "info", "interrupted");
		case "turn_limit":
			return addNotice(ended, "warning", "turn limit reached");
		case "denied":
			return addNotice(ended, "info", "stopped: you denied a tool call");
		case "error": {
			const withError = addError(
				ended,
				event.error?.code ?? "unknown",
				event.error?.message ?? "the turn ended with an error",
			);
			return { ...withError, errors: withError.errors + 1 };
		}
		default: {
			const unreachable: never = event.reason;
			return unreachable;
		}
	}
}

/**
 * The one place screen state changes (spec 0003). Pure and total: every event and UI action has a
 * case, and none throws. Events from a subagent (#38) leave the state unchanged. Unchanged transcript
 * items are reused, so a streaming item keeps its slot.
 */
export function reduceHud(state: HudState, action: HudAction): HudState {
	if ("agentId" in action && action.agentId !== MAIN_AGENT_ID) return state;
	switch (action.type) {
		case "turn_start":
			return {
				...state,
				turn: { status: "running", turnId: action.turnId },
				errors: 0,
				cost: { ...state.cost, lastTurnMicroUsd: 0 },
			};
		case "text_delta":
			return addDelta(
				state,
				"text",
				action.messageId,
				action.text,
				timeOf(action.at),
			);
		case "reasoning_delta":
			return addDelta(
				state,
				"reasoning",
				action.messageId,
				action.text,
				timeOf(action.at),
			);
		case "tool_call_start": {
			if (state.tools[action.callId]) return state;
			const tool: ToolView = {
				callId: action.callId,
				name: action.name,
				state: "pending",
			};
			return addItem(
				{ ...state, tools: { ...state.tools, [action.callId]: tool } },
				{ kind: "tool", key: `tool:${action.callId}`, callId: action.callId },
			);
		}
		case "message":
			return onMessage(state, action);
		case "permission_request": {
			const withCall = withInput(state, action.call.id, action.call.input);
			return {
				...withCall,
				permissions: [
					...withCall.permissions,
					{ requestId: action.requestId, call: action.call, kind: action.kind },
				],
			};
		}
		case "tool_run_start": {
			const [ensured, tool] = ensureTool(state, action.callId);
			return {
				...dropPermission(ensured, action.callId),
				tools: {
					...ensured.tools,
					[action.callId]: {
						...tool,
						state: "running",
						runAt: timeOf(action.at),
					},
				},
			};
		}
		case "tool_result":
			return onToolResult(state, action);
		case "usage": {
			const { usage } = action;
			const context =
				usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
			const { knownMicroUsd, unknownCalls } = sumCosts([action.cost]);
			return {
				...state,
				usage: {
					totalTokens: state.usage.totalTokens + context + usage.outputTokens,
					lastContextTokens: context,
					calls: state.usage.calls + 1,
					recentOutput: [...state.usage.recentOutput, usage.outputTokens].slice(
						-SPARK_CALLS,
					),
				},
				cost: {
					knownMicroUsd: state.cost.knownMicroUsd + knownMicroUsd,
					pricedCalls: state.cost.pricedCalls + (unknownCalls === 0 ? 1 : 0),
					unknownCalls: state.cost.unknownCalls + unknownCalls,
					lastTurnMicroUsd: state.cost.lastTurnMicroUsd + knownMicroUsd,
				},
			};
		}
		case "todo_update":
			return { ...state, todos: action.todos };
		case "model_change":
			return action.role === "main" ? { ...state, model: action.model } : state;
		case "mode_change": {
			if (action.mode === state.mode) return state;
			const changed = { ...state, mode: action.mode };
			return action.mode === "skip_all" ? withSkipAllLine(changed) : changed;
		}
		case "notice":
			return addNotice(state, action.level, action.text);
		case "turn_end":
			return onTurnEnd(state, action);
		case "ui_submit":
			return { ...state, submitting: true, hasMessage: true };
		case "ui_respond":
			return {
				...state,
				permissions: state.permissions.filter(
					(p) => p.requestId !== action.requestId,
				),
			};
		case "ui_notice":
			return addNotice(state, action.level, action.text);
		case "ui_hero_timeout":
			return { ...state, heroStopped: true };
		case "ui_stream_end":
			return addNotice(state, "info", "session ended");
		case "ui_stream_failed":
			return addError(state, "tui.session_failed", action.message);
		default: {
			const unreachable: never = action;
			return unreachable;
		}
	}
}
