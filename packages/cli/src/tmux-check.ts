/** Runs a command and returns its stdout, or `undefined` when it failed, timed out or could not start. */
export type RunCommand = (
	command: string,
	args: readonly string[],
) => string | undefined;

/** The arguments that print tmux's `allow-passthrough` for the current pane, inherited values included. */
export const TMUX_PASSTHROUGH_ARGS = [
	"show-options",
	"-Apv",
	"allow-passthrough",
] as const;

/**
 * Reads the output of `tmux show-options -Apv allow-passthrough`: `on` and `all` let pk's copy through,
 * `off` drops it. Anything else (an older tmux without the option, an error) is `undefined`. Pure.
 */
export function parseTmuxPassthrough(
	stdout: string | undefined,
): "on" | "off" | undefined {
	switch (stdout?.trim()) {
		case "on":
		case "all":
			return "on";
		case "off":
			return "off";
		default:
			return undefined;
	}
}

/**
 * tmux's `allow-passthrough` for this pane (spec 0003 AC-18), or `undefined` outside tmux or when it
 * could not be read. Asks tmux only when `TMUX` is set.
 */
export function readTmuxPassthrough(
	tmux: string | undefined,
	run: RunCommand,
): "on" | "off" | undefined {
	if ((tmux ?? "") === "") return undefined;
	return parseTmuxPassthrough(run("tmux", TMUX_PASSTHROUGH_ARGS));
}
