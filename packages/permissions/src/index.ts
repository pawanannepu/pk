/**
 * @pk/permissions: Permission modes, allow and deny rules, the always ask list, and a pure decision function.
 *
 * #7 (spec 0006) ships the four modes: `decide` is one table over the tool's kind, the mode and the
 * session allows, and `resolveStartMode` picks the mode pk starts in. Rules arrive with #10.
 */

/** The pure decision the loop calls before every tool run, and its request, state and result types. */
export {
	type BlockReason,
	decide,
	type PermissionDecision,
	type PermissionRequest,
	type PermissionState,
} from "./decide.ts";

/** Resolves the start mode from the flags and settings, with the notices to show. */
export {
	resolveStartMode,
	SKIP_ALL_SETTING_IGNORED_CODE,
	SKIP_ALL_SETTING_IGNORED_TEXT,
	type StartMode,
	type StartModeInput,
	type StartNotice,
} from "./start-mode.ts";
