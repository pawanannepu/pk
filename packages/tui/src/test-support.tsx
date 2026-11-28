import { ManualClock } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { silentLogger } from "@pk/env";
import {
	type AgentEvent,
	MAIN_AGENT_ID,
	type PermissionAnswer,
	type PermissionMode,
	type RequestId,
} from "@pk/schema";
import { DEMO_SCRIPT, type DemoEvent, type DemoTurn } from "./demo/script.ts";
import { createScriptedSession } from "./demo/scripted-session.ts";
import { initialHudState } from "./hud/state.ts";
import { createHudStore, type HudStore } from "./hud/store.ts";
import type { TuiEnv, TuiOptions, TuiSession } from "./session.ts";
import { TUI_RENDERER_CONFIG, TuiApp } from "./shell.tsx";

/** The environment most screen tests use: UTF-8, 256 colors. */
export const TEST_ENV: TuiEnv = { LANG: "en_US.UTF-8", TERM: "xterm-256color" };

/** Options for `mountTui`. */
export interface MountOptions {
	readonly width?: number;
	readonly height?: number;
	readonly env?: TuiEnv;
	readonly ascii?: boolean;
	readonly background?: "pk" | "terminal";
	readonly script?: readonly DemoTurn[];
	readonly session?: TuiSession;
	readonly copy?: (text: string) => boolean;
	readonly tmuxPassthrough?: () => "on" | "off" | undefined;
	readonly hints?: readonly string[];
	readonly contextWindow?: number;
	readonly kittyKeyboard?: boolean;
	/** The start mode. Default `normal`. */
	readonly mode?: PermissionMode;
	readonly skipAllAvailable?: boolean;
}

/** A session wrapper that records every `submit`, `respond` and `setMode`. */
export interface Recorded {
	readonly submits: string[];
	readonly responses: Array<[RequestId, PermissionAnswer]>;
	readonly modes: PermissionMode[];
}

/**
 * Mounts the real screen on the scripted session, driven by a `ManualClock`. `advance(ms)` moves
 * time in small steps, lets promises settle, and renders.
 */
export async function mountTui(options: MountOptions = {}) {
	const clock = new ManualClock();
	clock.setTime(Date.parse("2026-11-22T10:00:00.000Z"));
	const mode = options.mode ?? "normal";
	const skipAllAvailable = options.skipAllAvailable ?? false;
	const inner =
		options.session ??
		createScriptedSession(options.script ?? DEMO_SCRIPT, {
			clock,
			speed: 1,
			mode,
			skipAllAvailable,
		});
	const recorded: Recorded = { submits: [], responses: [], modes: [] };
	const session: TuiSession = {
		events: inner.events,
		submit: (text) => {
			recorded.submits.push(text);
			inner.submit(text);
		},
		respond: (id, answer) => {
			recorded.responses.push([id, answer]);
			inner.respond(id, answer);
		},
		interrupt: () => inner.interrupt(),
		setMode: (next) => {
			recorded.modes.push(next);
			inner.setMode(next);
		},
		get mode() {
			return inner.mode;
		},
	};
	const quits: string[] = [];
	const tuiOptions: TuiOptions = {
		session,
		info: {
			version: "0.0.0-test",
			projectRoot: "/home/dev/code/demo",
			home: "/home/dev",
			model: { provider: "demo", model: "scripted" },
			mode,
			skipAllAvailable,
			...(options.contextWindow === undefined
				? {}
				: { contextWindow: options.contextWindow }),
		},
		ui: {
			background: options.background ?? "pk",
			ascii: options.ascii ?? false,
		},
		env: options.env ?? TEST_ENV,
		clock,
		logger: silentLogger,
		...(options.hints ? { hints: options.hints } : {}),
		...(options.copy ? { copy: options.copy } : {}),
		...(options.tmuxPassthrough
			? { tmuxPassthrough: options.tmuxPassthrough }
			: {}),
		onQuit: () => quits.push("quit"),
		onSuspend: () => quits.push("suspend"),
	};
	const store: HudStore = createHudStore(
		initialHudState(tuiOptions.info.model, tuiOptions.info.mode),
		clock,
	);
	const setup = await testRender(
		() => <TuiApp options={tuiOptions} store={store} />,
		{
			width: options.width ?? 140,
			height: options.height ?? 40,
			// Like the real screen: Ctrl+C belongs to cli, never to OpenTUI.
			exitOnCtrlC: false,
			...TUI_RENDERER_CONFIG,
			...(options.kittyKeyboard ? { kittyKeyboard: true } : {}),
		},
	);
	const settle = async () => {
		for (let i = 0; i < 5; i++) await Promise.resolve();
	};
	const advance = async (ms: number, step = 10) => {
		for (let t = 0; t < ms; t += step) {
			clock.advance(Math.min(step, ms - t));
			await settle();
		}
		// Scroll changes land one frame after layout, so render twice.
		await setup.renderOnce();
		await setup.renderOnce();
	};
	const frame = () => setup.captureCharFrame();
	/** Types text into the input and presses Enter. */
	const submit = async (text: string) => {
		await setup.mockInput.typeText(text);
		setup.mockInput.pressEnter();
		await settle();
		await setup.renderOnce();
	};
	/** Plays all three demo turns, answering both permission prompts with `answer`. */
	const playDemo = async (answer: "y" | "n" = "y") => {
		await submit("why does the loop retry twice?");
		await advance(6_000, 25);
		await submit("fix the retry");
		await advance(1_000, 10);
		await advance(350);
		setup.mockInput.pressKey(answer);
		await advance(400, 10);
		setup.mockInput.pressKey(answer);
		await advance(4_000, 25);
		await submit("search callers");
		await advance(2_000, 25);
	};
	await settle();
	await setup.renderOnce();
	return {
		setup,
		playDemo,
		clock,
		store,
		recorded,
		quits,
		advance,
		frame,
		submit,
		settle,
		options: tuiOptions,
	};
}

/** A session the test pushes events into directly. `setMode` pushes the `mode_change` itself. */
export function pushSession(start: PermissionMode = "normal"): TuiSession & {
	push(event: AgentEvent): void;
	end(): void;
	fail(error: Error): void;
} {
	const queue: AgentEvent[] = [];
	let wake: (() => void) | undefined;
	let done = false;
	let failure: Error | undefined;
	let seq = 0;
	let mode = start;
	const events: AsyncIterable<AgentEvent> = {
		[Symbol.asyncIterator]: () => ({
			next: async (): Promise<IteratorResult<AgentEvent>> => {
				while (queue.length === 0 && !done && !failure) {
					await new Promise<void>((resolve) => {
						wake = resolve;
					});
				}
				if (failure) throw failure;
				const value = queue.shift();
				return value
					? { value, done: false }
					: { value: undefined, done: true };
			},
		}),
	};
	const poke = () => {
		const w = wake;
		wake = undefined;
		w?.();
	};
	return {
		events,
		submit: () => {},
		respond: () => {},
		interrupt: () => {},
		setMode(next) {
			if (next === mode) return;
			mode = next;
			queue.push({ ...at({ type: "mode_change", mode: next }), seq: seq++ });
			poke();
		},
		get mode() {
			return mode;
		},
		push(event) {
			queue.push({ ...event, seq: seq++ });
			poke();
		},
		end() {
			done = true;
			poke();
		},
		fail(error) {
			failure = error;
			poke();
		},
	};
}

/** An event with the envelope filled in, at the test clock's start time plus `offsetMs`. */
export function at<E extends DemoEvent>(event: E, offsetMs = 0): AgentEvent {
	return {
		...event,
		seq: 0,
		at: new Date(
			Date.parse("2026-11-22T10:00:00.000Z") + offsetMs,
		).toISOString(),
		agentId: MAIN_AGENT_ID,
	};
}
