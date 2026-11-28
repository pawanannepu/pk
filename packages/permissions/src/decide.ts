import type { PermissionMode, ToolKind, ToolName } from "@pk/schema";

/** What the loop asks about before a tool runs: which tool, what kind of thing it does, and its allow key. */
export interface PermissionRequest {
	readonly tool: ToolName;
	readonly kind: ToolKind;
	/** From `Tool.permissionKey(input)`: the tool name, or `<name>:<sessionKey(input)>` for `execute`. */
	readonly key: string;
}

/** The session's permission state that `decide` reads. #10 replaces exact keys with rule patterns. */
export interface PermissionState {
	/** The mode at the moment of the call. */
	readonly mode: PermissionMode;
	/** Keys you allowed for the rest of the session with `allow_session`. */
	readonly sessionAllows: ReadonlySet<string>;
}

/** Why a call was blocked. A one member union today, so #10 can add `deny_rule`. */
export type BlockReason = "plan_mode";

/** What `decide` returns: run the call now, ask you first, or block it without asking. */
export type PermissionDecision =
	| { readonly decision: "allow" }
	| { readonly decision: "ask" }
	| { readonly decision: "block"; readonly reason: BlockReason };

const ALLOW: PermissionDecision = { decision: "allow" };
const ASK: PermissionDecision = { decision: "ask" };
const PLAN_BLOCK: PermissionDecision = {
	decision: "block",
	reason: "plan_mode",
};

/** The mode's verdict alone, before session allows; `undefined` means the mode has no opinion. */
function modeDecision(
	kind: Exclude<ToolKind, "read">,
	mode: PermissionMode,
): PermissionDecision | undefined {
	switch (mode) {
		case "skip_all":
			return ALLOW;
		case "plan":
			switch (kind) {
				case "write":
				case "execute":
					return PLAN_BLOCK;
				case "network":
					return undefined;
				default: {
					const unhandled: never = kind;
					return unhandled;
				}
			}
		case "accept_edits":
			return kind === "write" ? ALLOW : undefined;
		case "normal":
			return undefined;
		default: {
			const unhandled: never = mode;
			return unhandled;
		}
	}
}

/**
 * Decides whether a tool call runs, asks you, or is blocked (spec 0006 AC-1). The first match wins:
 * a `read` kind call is allowed; `skip_all` allows; `plan` blocks `write` and `execute`; `accept_edits`
 * allows `write`; a key in `sessionAllows` allows; anything else asks. Pure: no I/O, no clock.
 */
export function decide(
	request: PermissionRequest,
	state: PermissionState,
): PermissionDecision {
	const { kind } = request;
	switch (kind) {
		case "read":
			return ALLOW;
		case "write":
		case "execute":
		case "network": {
			const byMode = modeDecision(kind, state.mode);
			if (byMode !== undefined) return byMode;
			return state.sessionAllows.has(request.key) ? ALLOW : ASK;
		}
		default: {
			const unhandled: never = kind;
			return unhandled;
		}
	}
}
