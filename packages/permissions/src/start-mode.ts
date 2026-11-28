import type { PermissionMode } from "@pk/schema";

/** A notice the session emits before its first turn, from resolving the start mode. */
export interface StartNotice {
	readonly level: "info" | "warning";
	readonly code: string;
	readonly text: string;
}

/** The mode pk starts in, whether `skip_all` may be reached, and any notices to show. */
export interface StartMode {
	readonly mode: PermissionMode;
	/** True only when `--dangerously-skip-permissions` was given. */
	readonly skipAllAvailable: boolean;
	readonly notices: readonly StartNotice[];
}

/** What `resolveStartMode` reads: the two flags and the user settings value. */
export interface StartModeInput {
	readonly flagMode?: "normal" | "accept_edits" | "plan" | undefined;
	readonly skipFlag: boolean;
	readonly settingsMode?: PermissionMode | undefined;
}

/** The code of the notice for an ignored `skip_all` setting. */
export const SKIP_ALL_SETTING_IGNORED_CODE =
	"permissions.skip_all_setting_ignored";

/** The text of the notice for an ignored `skip_all` setting. */
export const SKIP_ALL_SETTING_IGNORED_TEXT =
	'permissions.mode "skip_all" in your settings is ignored. Start pk with --dangerously-skip-permissions to skip all prompts.';

/**
 * Resolves the start mode (spec 0006 AC-7): the skip flag, else `--mode`, else the settings mode,
 * else `normal`. A `skip_all` setting is ignored with a warning, so no settings file can turn it on.
 * Pure. `cli` rejects `--mode` with the skip flag before calling it.
 */
export function resolveStartMode(input: StartModeInput): StartMode {
	if (input.skipFlag)
		return { mode: "skip_all", skipAllAvailable: true, notices: [] };
	if (input.flagMode !== undefined)
		return { mode: input.flagMode, skipAllAvailable: false, notices: [] };
	const { settingsMode } = input;
	if (settingsMode === "skip_all")
		return {
			mode: "normal",
			skipAllAvailable: false,
			notices: [
				{
					level: "warning",
					code: SKIP_ALL_SETTING_IGNORED_CODE,
					text: SKIP_ALL_SETTING_IGNORED_TEXT,
				},
			],
		};
	return {
		mode: settingsMode ?? "normal",
		skipAllAvailable: false,
		notices: [],
	};
}
