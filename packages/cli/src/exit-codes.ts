/**
 * The one exit code table for the `pk` binary. #26 Headless mode extends it.
 *
 * Signal exits follow the shell convention of 128 plus the signal number, so a script running pk
 * can tell "you pressed Ctrl+C" from "pk failed".
 */
export const EXIT = {
	success: 0,
	failure: 1,
	usage: 2,
	sighup: 129,
	sigint: 130,
	sigterm: 143,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
