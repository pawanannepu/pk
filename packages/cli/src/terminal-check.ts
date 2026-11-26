/** What `interactiveRefusal` reads: the TTY flags of stdin and stdout, and `TERM`. */
export interface TerminalProbe {
	readonly stdinIsTTY: boolean;
	readonly stdoutIsTTY: boolean;
	readonly term: string | undefined;
}

/** The two line refusal interactive pk prints to stderr when it has no terminal (spec 0003 AC-20). */
export const NOT_A_TERMINAL_MESSAGE =
	'pk: interactive mode needs a terminal.\nFor scripts and pipes use: pk -p "<prompt>"\n';

/**
 * Why the full screen UI cannot start here, or `undefined` when it can. Interactive pk needs a TTY on
 * both stdin and stdout and a `TERM` other than `dumb`. Pure, so it runs before the native library
 * exec and before `@pk/tui` is imported.
 */
export function interactiveRefusal(probe: TerminalProbe): string | undefined {
	if (!probe.stdinIsTTY || !probe.stdoutIsTTY || probe.term === "dumb") {
		return NOT_A_TERMINAL_MESSAGE;
	}
	return undefined;
}
