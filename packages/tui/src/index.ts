/**
 * @pk/tui: the full screen terminal UI (OpenTUI with Solid). The only package that may import
 * `@opentui/*` or `solid-js`.
 *
 * `startTui` runs the screen (spec 0003) on any `TuiSession`; today `cli` passes the scripted demo
 * session, and #6 passes the real one. `cli` loads this package with a dynamic `import()` so
 * `pk --version` and `pk -p` never load OpenTUI's native library.
 */

/** The scripted demo: `pk __tui-demo` plays it through `createScriptedSession`. */
export {
	DEMO_SCRIPT,
	type DemoEvent,
	type DemoStep,
	type DemoTurn,
} from "./demo/script.ts";
/** A `TuiSession` that plays a committed script instead of calling a model. */
export {
	createScriptedSession,
	type ScriptedSessionOptions,
} from "./demo/scripted-session.ts";
/** The screen's lifecycle handle, shared by `startTui` and the smoke screen. */
export type { TuiHandle } from "./screen.ts";
/** The session port and the options `startTui` takes. */
export {
	systemClock,
	type TimerHandle,
	type TuiClock,
	type TuiEnv,
	type TuiExit,
	type TuiInfo,
	type TuiOptions,
	type TuiSession,
	type TuiUiSettings,
} from "./session.ts";
/** Starts the full screen UI. */
export { startTui } from "./shell.tsx";
/** The OpenTUI smoke screen that proves the stack inside the compiled binary (spec 0001). */
export {
	type SmokeOptions,
	type SmokeResult,
	SmokeScreen,
	startSmokeScreen,
} from "./smoke.tsx";
