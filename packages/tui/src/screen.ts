import {
	type CliRenderer,
	type CliRendererConfig,
	createCliRenderer,
} from "@opentui/core";
import { type JSX, render } from "@opentui/solid";

/**
 * A running full screen UI. `cli` owns the process (signals, exit codes, terminal restore) and drives
 * the screen only through this handle, so OpenTUI's own signal handlers stay off.
 */
export interface TuiHandle<T> {
	/** Settles once the screen has closed and terminal restoration has been written. */
	readonly closed: Promise<T>;
	/** Closes the screen and restores the terminal. Safe to call more than once. */
	destroy(): Promise<void>;
	/** Hands the terminal back (Ctrl+Z). Await before stopping the process. */
	suspend(): Promise<void>;
	/** Takes the terminal again after SIGCONT and redraws. */
	resume(): Promise<void>;
}

/**
 * Creates the renderer, mounts `view`, and returns the handle. `result` is read once, when the screen
 * has closed. Ctrl+C and signals stay with `cli`: OpenTUI's own exit handling is off.
 */
export async function openScreen<T>(
	view: (renderer: CliRenderer) => () => JSX.Element,
	result: () => T,
	config: Omit<CliRendererConfig, "exitOnCtrlC" | "exitSignals"> = {},
	onClose?: () => void,
): Promise<{ handle: TuiHandle<T>; renderer: CliRenderer }> {
	const renderer = await createCliRenderer({
		targetFps: 30,
		...config,
		exitOnCtrlC: false,
		exitSignals: [],
	});
	await render(view(renderer), renderer);

	let resolveClosed: (value: T) => void = () => {};
	const closed = new Promise<T>((resolve) => {
		resolveClosed = resolve;
	});

	// One finish path, whoever starts the close (cli, a timer, or OpenTUI itself).
	let finishing: Promise<void> | undefined;
	const finish = (): Promise<void> => {
		onClose?.();
		// `closed` rejects only when a slow terminal made the close run late. Restoration was still attempted.
		finishing ??= renderer.closed
			.catch(() => {})
			.then(() => resolveClosed(result()));
		return finishing;
	};
	renderer.on("destroy", () => void finish());

	const handle: TuiHandle<T> = {
		closed,
		destroy: () => {
			renderer.destroy(); // idempotent
			return finish();
		},
		suspend: () => renderer.suspend(),
		resume: () => renderer.resume(),
	};
	return { handle, renderer };
}
