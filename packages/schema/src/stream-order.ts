import type { CallId } from "./primitives.ts";
import type { ProviderStreamEvent } from "./provider.ts";

/** What can be out of order in a provider stream. */
export type StreamIssueCode =
	| "no_stop"
	| "multiple_stop"
	| "after_stop"
	| "unknown_call"
	| "after_call_end"
	| "duplicate_call_start"
	| "unfinished_call"
	| "multiple_usage";

/** One problem `checkStreamOrder` found. `eventIndex` is `events.length` for a problem at the end of the stream. */
export interface StreamIssue {
	readonly code: StreamIssueCode;
	readonly eventIndex: number;
	readonly callId?: CallId;
	readonly message: string;
}

/**
 * Checks a provider stream against its ordering rules, for adapter and fake provider tests. Reports a
 * missing, repeated or not last `stop`; a call delta or end with no earlier start, or after its end; a
 * call that starts twice; a started call with no end before `stop`; and more than one `usage`.
 */
export function checkStreamOrder(
	events: readonly ProviderStreamEvent[],
): StreamIssue[] {
	const issues: StreamIssue[] = [];
	const started = new Set<CallId>();
	const ended = new Set<CallId>();
	let stopIndex: number | undefined;
	let usageSeen = false;

	const unfinished = (eventIndex: number): void => {
		for (const callId of started) {
			if (!ended.has(callId)) {
				issues.push({
					code: "unfinished_call",
					eventIndex,
					callId,
					message: `tool call ${callId} has no tool_call_end before stop`,
				});
			}
		}
	};

	for (const [index, event] of events.entries()) {
		if (event.type === "stop") {
			if (stopIndex === undefined) {
				stopIndex = index;
				unfinished(index);
			} else {
				issues.push({
					code: "multiple_stop",
					eventIndex: index,
					message: "the stream has more than one stop",
				});
			}
			continue;
		}
		if (stopIndex !== undefined) {
			issues.push({
				code: "after_stop",
				eventIndex: index,
				message: `${event.type} comes after stop`,
			});
		}

		switch (event.type) {
			case "tool_call_start":
				if (started.has(event.callId)) {
					issues.push({
						code: "duplicate_call_start",
						eventIndex: index,
						callId: event.callId,
						message: `tool call ${event.callId} starts twice`,
					});
				}
				started.add(event.callId);
				continue;
			case "tool_call_delta":
			case "tool_call_end":
				if (!started.has(event.callId)) {
					issues.push({
						code: "unknown_call",
						eventIndex: index,
						callId: event.callId,
						message: `${event.type} for ${event.callId}, which never started`,
					});
				} else if (ended.has(event.callId)) {
					issues.push({
						code: "after_call_end",
						eventIndex: index,
						callId: event.callId,
						message: `${event.type} for ${event.callId} after its tool_call_end`,
					});
				}
				if (event.type === "tool_call_end") ended.add(event.callId);
				continue;
			case "usage":
				if (usageSeen) {
					issues.push({
						code: "multiple_usage",
						eventIndex: index,
						message: "the stream has more than one usage event",
					});
				}
				usageSeen = true;
				continue;
			case "text_delta":
			case "reasoning_delta":
			case "reasoning_replay":
				continue;
			default: {
				const _exhaustive: never = event;
				continue;
			}
		}
	}

	if (stopIndex === undefined) {
		issues.push({
			code: "no_stop",
			eventIndex: events.length,
			message: "the stream has no stop",
		});
		unfinished(events.length);
	}
	return issues;
}
