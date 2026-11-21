import { type CliRenderer, createCliRenderer } from "@opentui/core";
import {
	onResize,
	render,
	useKeyboard,
	useTerminalDimensions,
} from "@opentui/solid";
import { createSignal } from "solid-js";

/** What the smoke screen saw before it closed. `cli` prints it so a PTY harness can assert on it. */
export interface SmokeResult {
	readonly resizes: number;
	readonly width: number;
	readonly height: number;
}

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

export interface SmokeOptions {
	readonly version: string;
	/** The screen closes itself after this long. */
	readonly durationMs: number;
	/**
	 * The terminal is in raw mode, so Ctrl+C and Ctrl+Z arrive as keys, not signals. `cli` maps them
	 * onto its own SIGINT and SIGTSTP handling so there is one way pk stops or suspends.
	 */
	readonly onInterrupt?: () => void;
	readonly onSuspend?: () => void;
}

export function SmokeScreen(props: {
	version: string;
	onResize?: (width: number, height: number) => void;
	onInterrupt?: () => void;
	onSuspend?: () => void;
}) {
	const dims = useTerminalDimensions();
	const [resizes, setResizes] = createSignal(0);
	onResize((width, height) => {
		setResizes((n) => n + 1);
		props.onResize?.(width, height);
	});
	useKeyboard((key) => {
		if (!key.ctrl) return;
		if (key.name === "c") props.onInterrupt?.();
		else if (key.name === "z") props.onSuspend?.();
	});

	return (
		<box flexDirection="column">
			<text>pk {props.version} · tui smoke</text>
			<text>
				size {dims().width}x{dims().height} · resizes {resizes()}
			</text>
		</box>
	);
}

/**
 * The first proof for spec 0001: OpenTUI and Solid render inside the compiled binary, a resize is
 * handled, and the screen closes on a timer with the terminal restored.
 */
export async function startSmokeScreen(
	options: SmokeOptions,
): Promise<TuiHandle<SmokeResult>> {
	const renderer: CliRenderer = await createCliRenderer({
		exitOnCtrlC: false,
		exitSignals: [],
		targetFps: 30,
	});

	const result = { resizes: 0, width: renderer.width, height: renderer.height };
	await render(
		() => (
			<SmokeScreen
				version={options.version}
				onInterrupt={options.onInterrupt}
				onSuspend={options.onSuspend}
				onResize={(width, height) => {
					result.resizes += 1;
					result.width = width;
					result.height = height;
				}}
			/>
		),
		renderer,
	);

	let resolveClosed: (value: SmokeResult) => void = () => {};
	const closed = new Promise<SmokeResult>((resolve) => {
		resolveClosed = resolve;
	});

	// One finish path, whoever starts the close (the timer, cli, or OpenTUI itself).
	let finishing: Promise<void> | undefined;
	const finish = (): Promise<void> => {
		clearTimeout(timer);
		// `closed` rejects only when a slow terminal made the close run late. Restoration was still attempted.
		finishing ??= renderer.closed
			.catch(() => {})
			.then(() => resolveClosed({ ...result }));
		return finishing;
	};
	renderer.on("destroy", () => void finish());

	const destroy = (): Promise<void> => {
		renderer.destroy(); // idempotent
		return finish();
	};

	const timer = setTimeout(() => void destroy(), options.durationMs);

	return {
		closed,
		destroy,
		suspend: () => renderer.suspend(),
		resume: () => renderer.resume(),
	};
}
