import { onResize, useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createSignal } from "solid-js";
import { openScreen, type TuiHandle } from "./screen.ts";

/** What the smoke screen saw before it closed. `cli` prints it so a PTY harness can assert on it. */
export interface SmokeResult {
	readonly resizes: number;
	readonly width: number;
	readonly height: number;
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
			<text>pk {props.version} - tui smoke</text>
			<text>
				size {dims().width}x{dims().height} - resizes {resizes()}
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
	const result = { resizes: 0, width: 0, height: 0 };
	let timer: ReturnType<typeof setTimeout> | undefined;
	const { handle, renderer } = await openScreen(
		() => () => (
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
		() => ({ ...result }),
		{},
		() => clearTimeout(timer),
	);
	result.width = renderer.width;
	result.height = renderer.height;
	timer = setTimeout(() => void handle.destroy(), options.durationMs);
	return handle;
}
