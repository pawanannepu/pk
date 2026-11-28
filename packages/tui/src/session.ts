import type { Logger } from "@pk/env";
import type {
	AgentEvent,
	ModelRef,
	PermissionAnswer,
	PermissionMode,
	RequestId,
} from "@pk/schema";

/**
 * The port the screen drives a session through (spec 0003). `tui` reads core state only from
 * `events`, and speaks back only through these calls. The real `AgentSession` satisfies it, and so
 * does `createScriptedSession` for the demo.
 */
export interface TuiSession {
	/** Every event of the session, in order. Ends when the session ends. */
	readonly events: AsyncIterable<AgentEvent>;
	/** Sends your prompt, unchanged. */
	submit(text: string): void;
	/** Answers one permission request. */
	respond(requestId: RequestId, answer: PermissionAnswer): void;
	/** Stops the running turn. Nothing in #4 calls it; Esc wires it in #15. */
	interrupt(): void;
	/** Changes the permission mode and emits `mode_change` (spec 0006 AC-9). Shift+Tab calls it. */
	setMode(mode: PermissionMode): void;
	/** The mode right now, synchronously, so two fast Shift+Tab presses step two modes. */
	readonly mode: PermissionMode;
}

/** A timer handle from `TuiClock`. Opaque to the screen. */
export type TimerHandle = ReturnType<typeof globalThis.setTimeout> | number;

/**
 * Time, passed in so tests drive it by hand. Every interval and timeout the screen starts goes
 * through this, so a test can see that none is pending while idle (AC-19).
 */
export interface TuiClock {
	now(): number;
	setTimeout(fn: () => void, delayMs: number): TimerHandle;
	clearTimeout(handle: TimerHandle): void;
	setInterval(fn: () => void, delayMs: number): TimerHandle;
	clearInterval(handle: TimerHandle): void;
}

/** Fixed facts about this session that the header, footer and rails show. */
export interface TuiInfo {
	readonly version: string;
	/** The project folder, from `findProjectRoot(cwd)` in `cli`. */
	readonly projectRoot: string;
	/** Your home folder, shown as `~`. */
	readonly home: string;
	readonly model: ModelRef;
	readonly mode: PermissionMode;
	/** True only with `--dangerously-skip-permissions`: Shift+Tab may then reach `skip_all`. */
	readonly skipAllAvailable: boolean;
	/** The model's context window in tokens. Unset until the model catalog (#19). */
	readonly contextWindow?: number;
}

/** The user only `ui` settings, with defaults applied. */
export interface TuiUiSettings {
	readonly background: "pk" | "terminal";
	readonly ascii: boolean;
}

/** The environment variables the screen reads. `cli` passes them in; nothing reads them at module level. */
export interface TuiEnv {
	readonly NO_COLOR?: string;
	readonly COLORTERM?: string;
	readonly TERM?: string;
	readonly LANG?: string;
	readonly LC_ALL?: string;
	readonly LC_CTYPE?: string;
	readonly TMUX?: string;
}

/** Why the screen closed. */
export interface TuiExit {
	readonly reason: "quit" | "session_ended";
}

/** Everything `startTui` needs. Plain arguments, wired by `cli`. */
export interface TuiOptions {
	readonly session: TuiSession;
	readonly info: TuiInfo;
	readonly ui: TuiUiSettings;
	readonly env: TuiEnv;
	readonly clock: TuiClock;
	readonly logger: Logger;
	/** Footer hints added by later features, shown before the built in ones. */
	readonly hints?: readonly string[];
	/** Writes text to the clipboard (OSC 52 by default). Returns false when it could not be sent. */
	readonly copy?: (text: string) => boolean;
	/**
	 * Reads tmux's `allow-passthrough` for this pane (`on` covers `all`), asked at each copy inside tmux
	 * so a fix applies at once. With `off`, tmux drops the copy, so pk shows the unsupported notice
	 * instead. Returns `undefined` when it could not be read; unset outside tmux.
	 */
	readonly tmuxPassthrough?: () => "on" | "off" | undefined;
	/** Ctrl+C. The terminal is in raw mode, so it arrives as a key; `cli` maps it to its own SIGINT path. */
	readonly onQuit?: () => void;
	/** Ctrl+Z, mapped by `cli` to SIGTSTP. */
	readonly onSuspend?: () => void;
}

/** The real clock, for `cli`. Built on demand, never at module load. */
export function systemClock(): TuiClock {
	return {
		now: () => Date.now(),
		setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
		clearTimeout: (handle) => globalThis.clearTimeout(handle),
		setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
		clearInterval: (handle) => globalThis.clearInterval(handle),
	};
}
