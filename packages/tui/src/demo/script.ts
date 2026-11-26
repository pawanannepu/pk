import {
	type AgentEvent,
	ID_SCHEMAS,
	type IdPrefix,
	type IdTypes,
} from "@pk/schema";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
	? Omit<T, K>
	: never;

/** An `AgentEvent` without its envelope. `createScriptedSession` adds `seq`, `at` and `agentId`. */
export type DemoEvent = DistributiveOmit<AgentEvent, "seq" | "at" | "agentId">;

/**
 * One step of a scripted turn: wait `delayMs` (divided by `--speed`), then emit `event`; or wait for
 * your answer to `awaitRequest` and play the `allowed` or `denied` branch.
 */
export type DemoStep =
	| { readonly delayMs: number; readonly event: DemoEvent }
	| {
			readonly delayMs: number;
			readonly awaitRequest: IdTypes["req"];
			readonly allowed: readonly DemoStep[];
			readonly denied: readonly DemoStep[];
	  };

/** One turn: the steps after `turn_start` and your message. The last step is its `turn_end`. */
export type DemoTurn = readonly DemoStep[];

/** A fixed, valid ID for the demo: the prefix plus `n` padded to 26 Crockford digits. */
export function demoId<P extends IdPrefix>(prefix: P, n: number): IdTypes[P] {
	return ID_SCHEMAS[prefix].parse(`${prefix}_${String(n).padStart(26, "0")}`);
}

const MODEL = { provider: "demo", model: "scripted" } as const;
const AT = "2026-11-22T00:00:00.000Z";

const msg = (n: number) => demoId("msg", n);
const call = (n: number) => demoId("call", n);
const req = (n: number) => demoId("req", n);
const turn = (n: number) => demoId("turn", n);

/** Splits text into word sized deltas, `gap` ms apart, for a streamed look. */
function streamText(
	kind: "text_delta" | "reasoning_delta",
	messageId: IdTypes["msg"],
	text: string,
	gap: number,
): readonly DemoStep[] {
	return (text.match(/\S+\s*/g) ?? []).map((chunk) => ({
		delayMs: gap,
		event: { type: kind, messageId, text: chunk },
	}));
}

/** A 52 line unified patch (48 context, 3 added, 1 removed), so the 40 line cut shows. */
function retryPatch(): string {
	const context = (i: number) =>
		` // retry policy line ${String(i + 1).padStart(2, "0")}`;
	const before = Array.from({ length: 24 }, (_, i) => context(i));
	const after = Array.from({ length: 24 }, (_, i) => context(i + 25));
	return [
		"--- a/src/provider/retry.ts",
		"+++ b/src/provider/retry.ts",
		"@@ -1,49 +1,51 @@",
		...before,
		"-const RETRIES = 2;",
		"+const RETRIES = 3;",
		"+const BASE_DELAY_MS = 500;",
		"+const MAX_DELAY_MS = 8_000;",
		...after,
		"",
	].join("\n");
}

const TURN_1: DemoTurn = [
	...streamText(
		"reasoning_delta",
		msg(1),
		"The user wants to know how the provider layer is wired. Reading the index first will show every export and where retry lives. ",
		90,
	),
	...streamText(
		"text_delta",
		msg(1),
		"Let me look at how the provider package is put together. ",
		40,
	),
	{
		delayMs: 120,
		event: {
			type: "tool_call_start",
			messageId: msg(1),
			callId: call(1),
			name: "read_file",
		},
	},
	{
		delayMs: 60,
		event: {
			type: "message",
			message: {
				id: msg(1),
				at: AT,
				role: "assistant",
				model: MODEL,
				stopReason: "tool_use",
				content: [
					{
						type: "text",
						text: "Let me look at how the provider package is put together.",
					},
					{
						type: "tool_call",
						id: call(1),
						name: "read_file",
						input: { path: "src/provider/index.ts" },
					},
				],
			},
		},
	},
	{ delayMs: 40, event: { type: "tool_run_start", callId: call(1) } },
	{
		delayMs: 220,
		event: {
			type: "tool_result",
			durationMs: 212,
			result: {
				type: "tool_result",
				callId: call(1),
				isError: false,
				content: [
					{
						type: "text",
						text: 'export { createRetryPolicy } from "./retry.ts";\nexport { type Provider } from "./provider.ts";\nexport { createFakeProvider } from "./fake.ts";\n'.repeat(
							14,
						),
					},
				],
				details: { files: [{ path: "src/provider/index.ts", action: "read" }] },
			},
		},
	},
	{
		delayMs: 80,
		event: {
			type: "notice",
			level: "info",
			code: "demo.project_root",
			text: "project root found at ~/code/demo",
		},
	},
	...streamText(
		"text_delta",
		msg(2),
		"The provider package exports three things: the retry policy, the Provider interface and a scripted fake. Retries live in retry.ts and back off on 429 and 5xx responses, twice by default. ",
		35,
	),
	{
		delayMs: 60,
		event: {
			type: "usage",
			model: MODEL,
			usage: {
				inputTokens: 4_100,
				cacheReadTokens: 2_000,
				cacheWriteTokens: 0,
				outputTokens: 320,
			},
			cost: { source: "catalog", microUsd: 1_200 },
		},
	},
	{
		delayMs: 30,
		event: { type: "turn_end", turnId: turn(1), reason: "done" },
	},
];

const DENIED = (n: number): DemoStep => ({
	delayMs: 30,
	event: {
		type: "tool_result",
		durationMs: 0,
		result: {
			type: "tool_result",
			callId: call(n),
			isError: true,
			content: [{ type: "text", text: "denied by user" }],
		},
	},
});

const TURN_2: DemoTurn = [
	...streamText(
		"text_delta",
		msg(3),
		"I'll raise the retry count, add a capped backoff, then run the provider tests. ",
		35,
	),
	{
		delayMs: 80,
		event: {
			type: "tool_call_start",
			messageId: msg(3),
			callId: call(2),
			name: "edit_file",
		},
	},
	{
		delayMs: 60,
		event: {
			type: "tool_call_start",
			messageId: msg(3),
			callId: call(3),
			name: "bash",
		},
	},
	{
		delayMs: 40,
		event: {
			type: "message",
			message: {
				id: msg(3),
				at: AT,
				role: "assistant",
				model: MODEL,
				stopReason: "tool_use",
				content: [
					{
						type: "text",
						text: "I'll raise the retry count, add a capped backoff, then run the provider tests.",
					},
					{
						type: "tool_call",
						id: call(2),
						name: "edit_file",
						input: {
							path: "src/provider/retry.ts",
							old_text: "const RETRIES = 2;",
							new_text:
								"const RETRIES = 3;\nconst BASE_DELAY_MS = 500;\nconst MAX_DELAY_MS = 8_000;",
						},
					},
					{
						type: "tool_call",
						id: call(3),
						name: "bash",
						input: { command: "bun test packages/provider" },
					},
				],
			},
		},
	},
	{
		delayMs: 40,
		event: {
			type: "permission_request",
			requestId: req(1),
			kind: "write",
			call: {
				type: "tool_call",
				id: call(2),
				name: "edit_file",
				input: {
					path: "src/provider/retry.ts",
					old_text: "const RETRIES = 2;",
					new_text:
						"const RETRIES = 3;\nconst BASE_DELAY_MS = 500;\nconst MAX_DELAY_MS = 8_000;",
				},
			},
		},
	},
	{
		delayMs: 10,
		event: {
			type: "permission_request",
			requestId: req(2),
			kind: "execute",
			call: {
				type: "tool_call",
				id: call(3),
				name: "bash",
				input: { command: "bun test packages/provider" },
			},
		},
	},
	{
		delayMs: 0,
		awaitRequest: req(1),
		allowed: [
			{ delayMs: 30, event: { type: "tool_run_start", callId: call(2) } },
			{
				delayMs: 140,
				event: {
					type: "tool_result",
					durationMs: 131,
					result: {
						type: "tool_result",
						callId: call(2),
						isError: false,
						content: [{ type: "text", text: "edited src/provider/retry.ts" }],
						details: {
							files: [
								{
									path: "src/provider/retry.ts",
									action: "edit",
									added: 3,
									removed: 1,
								},
							],
							diff: retryPatch(),
						},
					},
				},
			},
		],
		denied: [DENIED(2)],
	},
	{
		delayMs: 0,
		awaitRequest: req(2),
		allowed: [
			{ delayMs: 30, event: { type: "tool_run_start", callId: call(3) } },
			{
				delayMs: 2_400,
				event: {
					type: "tool_result",
					durationMs: 2_388,
					result: {
						type: "tool_result",
						callId: call(3),
						isError: true,
						content: [
							{
								type: "text",
								text: "2 tests failed\n  retry > backs off on 429\n  retry > gives up after 3 attempts",
							},
						],
					},
				},
			},
		],
		denied: [DENIED(3)],
	},
	{
		delayMs: 80,
		event: {
			type: "todo_update",
			todos: [
				{ content: "raise the retry count", status: "done" },
				{ content: "fix the two failing tests", status: "in_progress" },
				{ content: "document the backoff", status: "pending" },
			],
		},
	},
	{
		delayMs: 60,
		event: {
			type: "notice",
			level: "warning",
			code: "provider.retrying",
			text: "retrying after 429 (attempt 2 of 3)",
		},
	},
	{
		delayMs: 40,
		event: {
			type: "usage",
			model: MODEL,
			usage: {
				inputTokens: 6_800,
				cacheReadTokens: 4_000,
				cacheWriteTokens: 0,
				outputTokens: 610,
			},
			cost: { source: "unknown" },
		},
	},
	...streamText(
		"text_delta",
		msg(4),
		"Two tests still expect the old count. I'll update them next. ",
		35,
	),
	{
		delayMs: 40,
		event: {
			type: "usage",
			model: MODEL,
			usage: {
				inputTokens: 7_900,
				cacheReadTokens: 6_000,
				cacheWriteTokens: 0,
				outputTokens: 140,
			},
			cost: { source: "catalog", microUsd: 1_900 },
		},
	},
	{
		delayMs: 30,
		event: { type: "turn_end", turnId: turn(2), reason: "done" },
	},
];

const TURN_3: DemoTurn = [
	...streamText(
		"text_delta",
		msg(5),
		"Searching for every caller of the retry policy. ",
		35,
	),
	{
		delayMs: 80,
		event: {
			type: "tool_call_start",
			messageId: msg(5),
			callId: call(4),
			name: "grep",
		},
	},
	{
		delayMs: 600,
		event: {
			type: "turn_end",
			turnId: turn(3),
			reason: "error",
			error: {
				code: "provider.rate_limited",
				message: "OpenAI returned 429 after 3 retries.",
			},
		},
	},
];

const TURN_LAST: DemoTurn = [
	{
		delayMs: 60,
		event: {
			type: "notice",
			level: "info",
			code: "demo.finished",
			text: "demo finished. ctrl+c quits",
		},
	},
	{
		delayMs: 10,
		event: { type: "turn_end", turnId: turn(4), reason: "done" },
	},
];

/**
 * The committed demo `pk __tui-demo` plays (spec 0003, *Demo script*). Submit N plays turn N; the
 * last turn repeats for every later submit.
 */
export const DEMO_SCRIPT: readonly DemoTurn[] = [
	TURN_1,
	TURN_2,
	TURN_3,
	TURN_LAST,
];

/** The turn IDs, in order, so the session can start each turn with the right `turn_start`. */
export const DEMO_TURN_IDS: readonly IdTypes["turn"][] = [
	turn(1),
	turn(2),
	turn(3),
	turn(4),
];
