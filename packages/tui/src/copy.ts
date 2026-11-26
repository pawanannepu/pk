import { COPY_MAX_CHARS } from "./hud-constants.ts";

/** What to do with a finished selection (AC-18). */
export type CopyDecision =
	| { readonly kind: "none" }
	| { readonly kind: "send"; readonly text: string }
	| { readonly kind: "too_large"; readonly chars: number }
	| { readonly kind: "unsupported"; readonly notice: string | undefined };

/**
 * The notice shown the first time a copy cannot reach the clipboard: the terminal has no OSC 52, or
 * tmux would drop it. OpenTUI wraps OSC 52 in tmux passthrough, so tmux's `allow-passthrough` (not
 * `set-clipboard`) is what lets it through.
 */
export function unsupportedCopyNotice(inTmux: boolean): string {
	return `copy not supported in this terminal. Hold Shift (Option in iTerm2 or Terminal.app) to select natively${inTmux ? ", or set -g allow-passthrough on in tmux" : ""}`;
}

/**
 * Decides a copy from the selected text, the renderer's OSC 52 support, whether `TMUX` is set, tmux's
 * `allow-passthrough` for the pane, and whether the unsupported notice was already shown
 * this session. Pure.
 */
export function decideCopy(input: {
	readonly text: string;
	readonly osc52: "unknown" | "supported" | "unsupported";
	readonly inTmux: boolean;
	readonly tmuxPassthrough: "on" | "off" | "unknown";
	readonly warned: boolean;
}): CopyDecision {
	if (input.text === "") return { kind: "none" };
	const tmuxDrops = input.inTmux && input.tmuxPassthrough === "off";
	if (input.osc52 === "unsupported" || tmuxDrops) {
		return {
			kind: "unsupported",
			notice: input.warned ? undefined : unsupportedCopyNotice(input.inTmux),
		};
	}
	const chars = [...input.text].length;
	if (chars > COPY_MAX_CHARS) return { kind: "too_large", chars };
	return { kind: "send", text: input.text };
}
