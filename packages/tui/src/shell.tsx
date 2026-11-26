import type {
	KeyEvent,
	ScrollBoxRenderable,
	TextareaRenderable,
} from "@opentui/core";
import {
	useKeyboard,
	useRenderer,
	useSelectionHandler,
	useTerminalDimensions,
} from "@opentui/solid";
import type { PermissionAnswer, RequestId } from "@pk/schema";
import {
	type Accessor,
	createEffect,
	createMemo,
	createSignal,
	on,
	onCleanup,
	onMount,
	Show,
} from "solid-js";
import { decideCopy } from "./copy.ts";
import { ASCII_GLYPHS, glyphSet } from "./glyphs.ts";
import { initialHudState, type PendingPermission } from "./hud/state.ts";
import { createHudStore, type HudStore, pumpEvents } from "./hud/store.ts";
import {
	BOTTOM_PANEL_MAX_RATIO,
	COPY_FLASH_MS,
	COPY_MAX_CHARS,
	GLOBE_FRAME_MS,
	HERO_RUN_MS,
	PERMISSION_GUARD_MS,
	SPINNER_INTERVAL_MS,
} from "./hud-constants.ts";
import { layoutFor, MIN_HEIGHT, MIN_WIDTH, RAIL_GAP } from "./layout.ts";
import { openScreen, type TuiHandle } from "./screen.ts";
import type { TimerHandle, TuiExit, TuiOptions } from "./session.ts";
import {
	nativeColorTerm,
	resolveColorMode,
	resolveTheme,
	terminalColorCapabilities,
} from "./theme.ts";
import { type Hud, HudProvider } from "./ui/context.tsx";
import { Footer } from "./ui/footer.tsx";
import { Header } from "./ui/header.tsx";
import { HERO_MIN_COLS, HERO_MIN_ROWS, Hero, TooSmall } from "./ui/hero.tsx";
import { InputPanel } from "./ui/input.tsx";
import { PERMISSION_FIXED_ROWS, PermissionPanel } from "./ui/permission.tsx";
import { Words } from "./ui/primitives.tsx";
import { LeftRail, RightRail } from "./ui/rails.tsx";
import { TranscriptItems } from "./ui/transcript.tsx";

/** Header (2 rows) plus footer (1 row). */
const CHROME_ROWS = 3;

const ANSWERS: Readonly<Record<string, PermissionAnswer>> = {
	y: { decision: "allow_once" },
	a: { decision: "allow_session" },
	n: { decision: "deny" },
};

/**
 * The whole screen (spec 0003). Mounted once for the session: layout changes, `too_small` and
 * permission prompts never unmount the transcript, the input or the panel.
 */
export function TuiApp(props: { options: TuiOptions; store?: HudStore }) {
	const options = props.options;
	const { clock } = options;
	const renderer = useRenderer();
	const dims = useTerminalDimensions();
	const store =
		props.store ?? createHudStore(initialHudState(options.info.model), clock);
	const state = store.state;

	// Theme: NO_COLOR, then capabilities once reported (repaint on change), else the env guess.
	const nativeTermSet = nativeColorTerm(options.env) !== undefined;
	const [caps, setCaps] = createSignal(
		terminalColorCapabilities(renderer.capabilities, nativeTermSet),
	);
	const onCaps = () =>
		setCaps(terminalColorCapabilities(renderer.capabilities, nativeTermSet));
	renderer.on("capabilities", onCaps);
	onCleanup(() => renderer.off("capabilities", onCaps));
	const mode = createMemo(() =>
		resolveColorMode({ env: options.env, capabilities: caps() }),
	);
	const theme = createMemo(() => resolveTheme(mode(), options.ui.background));
	const glyphs = glyphSet(options.env, options.ui.ascii);

	// Motion is signal only (AC-19): one shared interval while a turn runs or a request is open.
	const [now, setNow] = createSignal(clock.now());
	const [frame, setFrame] = createSignal(0);
	const animating = createMemo(
		() => state().turn.status === "running" || state().permissions.length > 0,
	);
	createEffect(
		on(animating, (moving) => {
			if (!moving) return;
			setNow(clock.now());
			const handle: TimerHandle = clock.setInterval(() => {
				setNow(clock.now());
				setFrame((f) => f + 1);
			}, SPINNER_INTERVAL_MS);
			onCleanup(() => clock.clearInterval(handle));
		}),
	);

	// The event pump runs for the life of the screen.
	let stopped = false;
	onMount(() => {
		void pumpEvents(options.session.events, store.enqueue, () => stopped);
	});
	onCleanup(() => {
		stopped = true;
		store.dispose();
	});

	const [railsHidden, setRailsHidden] = createSignal(false);
	const layout = createMemo(() =>
		layoutFor({
			width: dims().width,
			height: dims().height,
			railsHidden: railsHidden(),
		}),
	);
	const centerHeight = () => Math.max(1, dims().height - CHROME_ROWS);
	const bottomMax = () =>
		Math.max(3, Math.floor(centerHeight() * BOTTOM_PANEL_MAX_RATIO));

	// The hero (AC-16): the globe turns while the transcript is empty, for at most HERO_RUN_MS.
	const heroVisible = () => state().transcript.length === 0;
	const transcriptRows = () => centerHeight() - 3;
	const globeMode = () =>
		glyphs !== ASCII_GLYPHS &&
		transcriptRows() >= HERO_MIN_ROWS &&
		layout().centerWidth >= HERO_MIN_COLS;
	const heroTurning = createMemo(
		() => heroVisible() && globeMode() && !state().heroStopped,
	);
	const [rotation, setRotation] = createSignal(0);
	const heroStart = clock.now();
	createEffect(
		on(heroTurning, (turning) => {
			if (!turning) return;
			const spin = clock.setInterval(
				() => setRotation((r) => (r + 3) % 360),
				GLOBE_FRAME_MS,
			);
			const stop = clock.setTimeout(
				() => store.dispatch({ type: "ui_hero_timeout" }),
				Math.max(0, HERO_RUN_MS - (clock.now() - heroStart)),
			);
			onCleanup(() => {
				clock.clearInterval(spin);
				clock.clearTimeout(stop);
			});
		}),
	);

	// Permission requests: the head of the queue shows; each newly shown request restarts the guard.
	const head = createMemo(() => state().permissions[0]);
	const [guardUntil, setGuardUntil] = createSignal(0);
	createEffect(
		on(
			() => head()?.requestId,
			(id) => {
				if (id === undefined) return;
				setGuardUntil(clock.now() + PERMISSION_GUARD_MS);
				const handle = clock.setTimeout(
					() => setNow(clock.now()),
					PERMISSION_GUARD_MS,
				);
				onCleanup(() => clock.clearTimeout(handle));
			},
		),
	);
	const listening = () => head() !== undefined && now() >= guardUntil();

	let textarea: TextareaRenderable | undefined;
	let scroll: ScrollBoxRenderable | undefined;

	const respond = (requestId: RequestId, answer: PermissionAnswer) => {
		store.dispatch({ type: "ui_respond", requestId });
		options.session.respond(requestId, answer);
	};

	const submit = (text: string) => {
		if (state().submitting || state().permissions.length > 0) return;
		if (text.trim() === "") return;
		store.dispatch({ type: "ui_submit", text });
		options.session.submit(text);
		textarea?.setText("");
	};

	const take = (key: KeyEvent) => {
		key.preventDefault();
		key.stopPropagation();
	};

	// Scrolling (AC-17): follow new content at the bottom; scrolled up, mark it with `↓ new`.
	const [newBelow, setNewBelow] = createSignal(false);
	const atBottom = (): boolean => {
		if (!scroll) return true;
		return scroll.scrollTop + scroll.viewport.height >= scroll.scrollHeight - 1;
	};
	const onScrolled = () => {
		if (atBottom()) setNewBelow(false);
	};
	const onContentGrew = () => {
		if (!atBottom()) setNewBelow(true);
	};
	const toEnd = () => {
		scroll?.scrollTo(Number.POSITIVE_INFINITY);
		setNewBelow(false);
	};
	// Resize keeps the item at the top of the view, and its row offset, when you are scrolled up.
	createEffect(
		on(
			() => [dims().width, dims().height, layout().centerWidth],
			() => {
				const box = scroll;
				if (!box || atBottom()) return;
				const top = box.scrollTop;
				const item = box
					.getChildren()
					.find((child) => child.y - box.content.y + child.height > top);
				if (!item) return;
				const release = box.anchor(item);
				box.afterLayout(release);
			},
			{ defer: true },
		),
	);

	// Copy (AC-18): a finished selection goes to the clipboard through `copy` (OSC 52 by default).
	const copy =
		options.copy ?? ((text: string) => renderer.copyToClipboardOSC52(text));
	const [flash, setFlash] = createSignal<string | undefined>(undefined);
	let flashTimer: TimerHandle | undefined;
	let warnedCopy = false;
	onCleanup(() => {
		if (flashTimer !== undefined) clock.clearTimeout(flashTimer);
	});
	useSelectionHandler((selection) => {
		const text = selection.getSelectedText();
		const inTmux = (options.env.TMUX ?? "") !== "";
		const decision = decideCopy({
			text,
			osc52: renderer.capabilities?.osc52_support ?? "unknown",
			inTmux,
			// Asked only for a real copy inside tmux: it runs a short `tmux show-options`.
			tmuxPassthrough:
				(text !== "" && inTmux ? options.tmuxPassthrough?.() : undefined) ??
				"unknown",
			warned: warnedCopy,
		});
		switch (decision.kind) {
			case "none":
				return;
			case "unsupported":
				if (decision.notice) {
					warnedCopy = true;
					store.dispatch({
						type: "ui_notice",
						level: "warning",
						code: "tui.copy_unsupported",
						text: decision.notice,
					});
				}
				return;
			case "too_large":
				store.dispatch({
					type: "ui_notice",
					level: "warning",
					code: "tui.copy_too_large",
					text: `selection not copied: ${decision.chars} characters is over the ${COPY_MAX_CHARS} limit`,
				});
				return;
			case "send": {
				if (!copy(decision.text)) return;
				setFlash(`copy sent (${[...decision.text].length} chars)`);
				if (flashTimer !== undefined) clock.clearTimeout(flashTimer);
				flashTimer = clock.setTimeout(() => {
					flashTimer = undefined;
					setFlash(undefined);
				}, COPY_FLASH_MS);
				return;
			}
			default: {
				const unreachable: never = decision;
				return unreachable;
			}
		}
	});

	useKeyboard((key) => {
		if (key.eventType === "release") return;
		if (key.ctrl && key.name === "c") {
			take(key);
			options.onQuit?.();
			return;
		}
		if (key.ctrl && key.name === "z") {
			take(key);
			options.onSuspend?.();
			return;
		}
		if (layout().tooSmall) {
			take(key);
			return;
		}
		if ((key.ctrl && key.name === "b") || key.name === "f2") {
			take(key);
			setRailsHidden((hidden) => !hidden);
			return;
		}
		if (key.name === "pageup" || key.name === "pagedown") {
			take(key);
			const page = Math.max(1, (scroll?.viewport.height ?? centerHeight()) - 2);
			scroll?.scrollBy(key.name === "pageup" ? -page : page);
			return;
		}
		const open = head();
		if (open) {
			take(key);
			if (clock.now() < guardUntil()) return;
			const answer = ANSWERS[key.name.toLowerCase()];
			if (answer && !key.ctrl && !key.meta) respond(open.requestId, answer);
			return;
		}
		const empty = (textarea?.plainText ?? "") === "";
		if (empty && (key.name === "home" || key.name === "end")) {
			take(key);
			if (key.name === "home") scroll?.scrollTo(0);
			else toEnd();
		}
	});

	const hud: Hud = { theme, glyphs, store, clock, options, now, frame };
	const width = () => layout().centerWidth;

	return (
		<HudProvider value={hud}>
			<box
				width={dims().width}
				height={dims().height}
				flexDirection="column"
				backgroundColor={theme().canvasBg}
			>
				<Header width={dims().width} />
				<box flexDirection="row" flexGrow={1}>
					<Show when={layout().left}>
						<LeftRail height={centerHeight()} />
						<box width={RAIL_GAP} />
					</Show>
					<box flexDirection="column" width={width()}>
						<box flexGrow={1} flexDirection="column">
							<Show when={heroVisible()}>
								<box
									position="absolute"
									left={0}
									top={0}
									width="100%"
									height="100%"
								>
									<Hero
										width={width()}
										height={Math.max(1, transcriptRows())}
										rotation={rotation()}
										globe={globeMode()}
									/>
								</box>
							</Show>
							<scrollbox
								ref={(el: ScrollBoxRenderable) => {
									scroll = el;
								}}
								flexGrow={1}
								stickyScroll={true}
								verticalScrollbarOptions={{
									visible: false,
									onChange: onScrolled,
								}}
								contentOptions={{ onSizeChange: onContentGrew }}
								horizontalScrollbarOptions={{ visible: false }}
								stickyStart="bottom"
							>
								<TranscriptItems width={width()} />
							</scrollbox>
							<Show when={newBelow()}>
								<box position="absolute" right={1} bottom={0} height={1}>
									<text selectable={false}>
										<Words tone="textDim">{`${glyphs.newBelow} new`}</Words>
									</text>
								</box>
							</Show>
						</box>
						<Show when={head()}>
							{(request: Accessor<PendingPermission>) => (
								<PermissionPanel
									request={request()}
									queued={state().permissions.length}
									width={width()}
									maxHeight={Math.max(PERMISSION_FIXED_ROWS, bottomMax())}
									listening={listening()}
								/>
							)}
						</Show>
						<InputPanel
							width={width()}
							maxHeight={bottomMax()}
							focused={head() === undefined && !layout().tooSmall}
							visible={head() === undefined}
							onSubmit={submit}
							ref={(el) => {
								textarea = el;
							}}
						/>
					</box>
					<Show when={layout().right}>
						<box width={RAIL_GAP} />
						<RightRail height={centerHeight()} />
					</Show>
				</box>
				<Footer width={dims().width} flash={flash()} />
				<Show when={layout().tooSmall}>
					<TooSmall
						width={dims().width}
						height={dims().height}
						minWidth={MIN_WIDTH}
						minHeight={MIN_HEIGHT}
					/>
				</Show>
			</box>
		</HudProvider>
	);
}

/**
 * Renderer settings shared by the real screen and the test mount. `autoFocus` is off because focus
 * belongs to the shell alone (AC-7): OpenTUI's default focuses the nearest focusable parent on every
 * click, so a click in the transcript would move focus to the scrollbox and strand the input.
 */
export const TUI_RENDERER_CONFIG = {
	useMouse: true,
	autoFocus: false,
} as const;

/**
 * Starts the full screen UI on `options.session` (spec 0003). `cli` owns the process: Ctrl+C calls
 * `onQuit`, Ctrl+Z calls `onSuspend`, and the handle closes the screen and restores the terminal.
 */
export async function startTui(
	options: TuiOptions,
): Promise<TuiHandle<TuiExit>> {
	const term = nativeColorTerm(options.env);
	const { handle } = await openScreen(
		() => () => <TuiApp options={options} />,
		(): TuiExit => ({ reason: "quit" }),
		{
			...TUI_RENDERER_CONFIG,
			// 16 colors: OpenTUI writes palette slots as `38;5;N` only for a 256 color TERM (AC-3).
			...(term ? { environment: { TERM: term } } : {}),
		},
	);
	return handle;
}
