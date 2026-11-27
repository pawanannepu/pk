import type { ToolKind, ToolName } from "@pk/schema";

/** What the loop asks about before a tool runs: which tool, and what kind of thing it does. */
export interface PermissionRequest {
	readonly tool: ToolName;
	readonly kind: ToolKind;
}

/** The session's permission state that `decide` reads. #10 replaces tool names with rule patterns. */
export interface PermissionState {
	/** Tools you allowed for the rest of the session with `allow_session`. */
	readonly sessionAllows: ReadonlySet<ToolName>;
}

/** What `decide` returns: run the call now, or ask you first. #7 adds `deny` and modes. */
export type PermissionDecision =
	| { readonly decision: "allow" }
	| { readonly decision: "ask" };

/**
 * Decides whether a tool call may run without asking (spec 0005 AC-10). A `read` kind tool, or a tool
 * already in `sessionAllows`, is allowed; anything else asks. Pure: no I/O, no clock.
 */
export function decide(
	request: PermissionRequest,
	state: PermissionState,
): PermissionDecision {
	if (request.kind === "read") return { decision: "allow" };
	if (state.sessionAllows.has(request.tool)) return { decision: "allow" };
	return { decision: "ask" };
}
