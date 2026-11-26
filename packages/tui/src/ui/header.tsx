import { Show } from "solid-js";
import { LAMP_BLINK_MS } from "../hud-constants.ts";
import {
	cellWidth,
	sanitizeForScreen,
	tildePath,
	truncateMiddle,
} from "../text.ts";
import { useHud } from "./context.tsx";
import { Decor, Lamp, Words } from "./primitives.tsx";

const SUBTITLE = "terminal coding agent";

/**
 * The header (AC-8): wordmark and subtitle on the left, the project folder in the middle, and the
 * status lamp with the warning and error counts on the right. Then a rule with a tick every 6 columns.
 */
export function Header(props: { width: number }) {
	const hud = useHud();
	const g = hud.glyphs;
	const state = hud.store.state;

	const lamp = () => {
		const s = state();
		if (s.permissions.length > 0) {
			const on = Math.floor(hud.now() / LAMP_BLINK_MS) % 2 === 0;
			return {
				tone: on ? ("amber" as const) : ("textDim" as const),
				word: "waiting",
			};
		}
		return s.turn.status === "running"
			? { tone: "text" as const, word: "working" }
			: { tone: "textDim" as const, word: "ready" };
	};

	const right = () => {
		const s = state();
		const warn = s.warnings > 0 ? `${g.warn} ${s.warnings}` : "";
		const err = s.errors > 0 ? `${g.lamp} ${s.errors} err` : "";
		return { warn, err };
	};

	const rightWidth = () => {
		const { warn, err } = right();
		return (
			cellWidth(`${g.lamp} ${lamp().word}`) +
			(warn ? cellWidth(warn) + 2 : 0) +
			(err ? cellWidth(err) + 2 : 0) +
			1
		);
	};

	const brand = `${g.wordmark} PK`;
	const folder = () =>
		sanitizeForScreen(
			tildePath(hud.options.info.projectRoot, hud.options.info.home),
		);

	// The middle shortens first (middle ellipsis), then the subtitle drops.
	const fit = () => {
		const free = props.width - 1 - cellWidth(brand) - rightWidth() - 2;
		const withSub = free - cellWidth(SUBTITLE) - 2;
		const showSub = withSub >= Math.min(cellWidth(folder()), 12);
		const room = Math.max(0, showSub ? withSub : free);
		const middle = truncateMiddle(folder(), room, g.ellipsis);
		const pad = Math.max(
			1,
			props.width -
				1 -
				cellWidth(brand) -
				(showSub ? cellWidth(SUBTITLE) + 2 : 0) -
				cellWidth(middle) -
				rightWidth() -
				2,
		);
		const leftPad = Math.floor(pad / 2);
		return { showSub, middle, leftPad, rightPad: pad - leftPad };
	};

	const ticks = () =>
		Array.from({ length: props.width }, (_, i) =>
			i % 6 === 5 ? g.tick : g.rule,
		);

	return (
		<box flexDirection="column" height={2} flexShrink={0}>
			<text selectable={false} height={1} wrapMode="none">
				<span> </span>
				<Words tone="title">{brand}</Words>
				<Show when={fit().showSub}>
					<Words tone="textDim">{`  ${SUBTITLE}`}</Words>
				</Show>
				<span>{" ".repeat(fit().leftPad + 1)}</span>
				<Words tone="textDim">{fit().middle}</Words>
				<span>{" ".repeat(fit().rightPad + 1)}</span>
				<Lamp tone={lamp().tone} word={lamp().word} />
				<Show when={right().warn}>
					<Words tone="amber">{`  ${right().warn}`}</Words>
				</Show>
				<Show when={right().err}>
					<Words tone="red">{`  ${right().err}`}</Words>
				</Show>
				<span> </span>
			</text>
			<text selectable={false} height={1} wrapMode="none">
				{ticks().map((glyph) =>
					glyph === g.tick ? (
						<Decor tone="textFaint">{glyph}</Decor>
					) : (
						<Decor tone="line">{glyph}</Decor>
					),
				)}
			</text>
		</box>
	);
}
