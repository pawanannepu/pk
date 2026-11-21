/**
 * @pk/tui: the full screen terminal UI (OpenTUI with Solid). The only package that may import
 * `@opentui/*` or `solid-js`.
 *
 * Today it holds only the smoke screen that proves the stack (#1, spec 0001). The real UI starts
 * with #4 Terminal UI foundation. `cli` loads this package with a dynamic `import()` so
 * `pk --version` and `pk -p` never load OpenTUI's native library.
 */
export {
	type SmokeOptions,
	type SmokeResult,
	SmokeScreen,
	startSmokeScreen,
	type TuiHandle,
} from "./smoke.tsx";
