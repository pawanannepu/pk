import type { RGBA } from "@opentui/core";
import { type JSX, Show } from "solid-js";
import type { ToolState } from "../hud/state.ts";
import { cellWidth, truncateEnd } from "../text.ts";
import type { DecorToken, Style, TextToken, Token } from "../theme.ts";
import { useHud } from "./context.tsx";

/** A token's style for a `<span>`. */
export function useStyle(): (token: Token) => Style {
	const hud = useHud();
	return (token) => hud.theme()[token];
}

/**
 * Words in a text token. Decoration tokens (`line`, `textFaint`) are not accepted, so no word is ever
 * drawn in a color meant only for rules and ticks (AC-2).
 */
export function Words(props: { tone: TextToken; children: string | number }) {
	const style = useStyle();
	return <span style={style(props.tone)}>{String(props.children)}</span>;
}

/** Glyphs and rules: decoration tokens plus `bracket` and the signal colors. */
export function Decor(props: {
	tone: DecorToken | "bracket" | "amber" | "green" | "red" | "textDim";
	children: string;
}) {
	const style = useStyle();
	return <span style={style(props.tone)}>{props.children}</span>;
}

/** The accent a framed panel uses for its corners (and its title, when not `bracket`). */
export type Accent = "bracket" | "amber" | "red";

/**
 * A top rule with the title set into it: `┌─ TITLE  subtitle ──── right ─┐`. The subtitle shortens
 * first when space is short. Without a title it is only the corner stubs.
 */
export function TitleRule(props: {
	width: number;
	title?: string;
	subtitle?: string;
	right?: string;
	accent: Accent;
}) {
	const hud = useHud();
	const g = hud.glyphs;
	const layout = () => {
		const title = props.title ?? "";
		const right = props.right ?? "";
		// cornerTL rule [space TITLE space] FILL [space right space] rule cornerTR
		const fixed =
			4 +
			(title ? cellWidth(title) + 2 : 0) +
			(right ? cellWidth(right) + 2 : 0);
		const room = props.width - fixed;
		const sub =
			props.subtitle && title && room > 4
				? truncateEnd(props.subtitle, room - 3, g.ellipsis)
				: "";
		const used = fixed + (sub ? cellWidth(sub) + 2 : 0);
		const fill = Math.max(1, props.width - used);
		return { title, right, sub, fill };
	};
	const titleTone = (): TextToken =>
		props.accent === "bracket" ? "title" : props.accent;
	return (
		<text selectable={false} height={1} width={props.width} wrapMode="none">
			<Decor tone={props.accent}>{g.cornerTL}</Decor>
			<Decor tone="line">{g.rule}</Decor>
			<Show when={layout().title}>
				<span> </span>
				<span style={{ ...hud.theme()[titleTone()], bold: true }}>
					{layout().title}
				</span>
				<Show when={layout().sub}>
					<span> </span>
					<Words tone="textDim">{` ${layout().sub}`}</Words>
				</Show>
				<span> </span>
			</Show>
			<Show
				when={layout().title}
				fallback={<span>{" ".repeat(Math.max(0, props.width - 4))}</span>}
			>
				<Decor tone="line">{g.rule.repeat(layout().fill)}</Decor>
			</Show>
			<Show when={layout().right}>
				<span> </span>
				<Words tone="textDim">{layout().right}</Words>
				<span> </span>
			</Show>
			<Decor tone="line">{g.rule}</Decor>
			<Decor tone={props.accent}>{g.cornerTR}</Decor>
		</text>
	);
}

/** The bottom corner stubs of a frame: `└─      ─┘`. */
export function BottomRule(props: { width: number; accent: Accent }) {
	const g = useHud().glyphs;
	return (
		<text selectable={false} height={1} width={props.width} wrapMode="none">
			<Decor tone={props.accent}>{g.cornerBL}</Decor>
			<Decor tone="line">{g.rule}</Decor>
			<span>{" ".repeat(Math.max(0, props.width - 4))}</span>
			<Decor tone="line">{g.rule}</Decor>
			<Decor tone={props.accent}>{g.cornerBR}</Decor>
		</text>
	);
}

/**
 * A framed panel: corners only, a top rule with the title, and bottom stubs (spec 0003, *Frames and
 * titles*). Content starts `padX` columns in; `padY` blank rows sit above and below it.
 */
export function Panel(props: {
	width: number;
	title?: string;
	subtitle?: string;
	right?: string;
	accent?: Accent;
	padX?: number;
	padY?: number;
	fill?: RGBA;
	children: JSX.Element;
}) {
	const accent = (): Accent => props.accent ?? "bracket";
	return (
		<box
			flexDirection="column"
			width={props.width}
			flexShrink={0}
			{...(props.fill ? { backgroundColor: props.fill } : {})}
		>
			<TitleRule
				width={props.width}
				title={props.title}
				subtitle={props.subtitle}
				right={props.right}
				accent={accent()}
			/>
			<box
				flexDirection="column"
				paddingLeft={props.padX ?? 3}
				paddingRight={props.padX ?? 3}
				paddingTop={props.padY ?? 0}
				paddingBottom={props.padY ?? 0}
			>
				{props.children}
			</box>
			<BottomRule width={props.width} accent={accent()} />
		</box>
	);
}

/** The shared spinner glyph for this frame. */
export function Spinner(props: { tone?: "amber" | "textDim" }) {
	const hud = useHud();
	const frames = hud.glyphs.spinner;
	return (
		<Decor tone={props.tone ?? "amber"}>
			{frames[hud.frame() % frames.length] ?? ""}
		</Decor>
	);
}

/** A tool call's status glyph: pending `◇` dim, running spinner amber, done `◆` green, failed `✖` red. */
export function StatusGlyph(props: { state: ToolState }) {
	const g = useHud().glyphs;
	return (
		<>
			{(() => {
				switch (props.state) {
					case "pending":
						return <Decor tone="textDim">{g.pending}</Decor>;
					case "running":
						return <Spinner />;
					case "done":
						return <Decor tone="green">{g.done}</Decor>;
					case "failed":
						return <Decor tone="red">{g.failed}</Decor>;
					default: {
						const unreachable: never = props.state;
						return unreachable;
					}
				}
			})()}
		</>
	);
}

/** The status lamp: `◉` and its word, in one tone. */
export function Lamp(props: {
	tone: "text" | "textDim" | "amber";
	word: string;
}) {
	const g = useHud().glyphs;
	return (
		<>
			<Words tone={props.tone}>{g.lamp}</Words>
			<Words tone={props.tone}>{` ${props.word}`}</Words>
		</>
	);
}

/** A legend marker: a `■` in a signal or neutral tone, then its value. */
export function Marker(props: {
	tone: "bracket" | "amber" | "red";
	value: string;
}) {
	const g = useHud().glyphs;
	return (
		<>
			<Decor tone={props.tone}>{g.marker}</Decor>
			<Words tone="text">{` ${props.value}`}</Words>
		</>
	);
}

/** A `cells` wide gauge of `ratio` (0 to 1), amber when `warn`. */
export function Gauge(props: { ratio: number; cells: number; warn: boolean }) {
	const g = useHud().glyphs;
	const filled = () =>
		Math.round(Math.min(1, Math.max(0, props.ratio)) * props.cells);
	return (
		<>
			<Decor tone={props.warn ? "amber" : "bracket"}>
				{g.gaugeFull.repeat(filled())}
			</Decor>
			<Decor tone="line">{g.gaugeEmpty.repeat(props.cells - filled())}</Decor>
		</>
	);
}

/** A sparkline of `values`, scaled to the largest (all zero draws the lowest level). */
export function Sparkline(props: { values: readonly number[] }) {
	const g = useHud().glyphs;
	const bars = () => {
		const max = Math.max(0, ...props.values);
		const top = g.spark.length - 1;
		return props.values
			.map((v) => g.spark[max === 0 ? 0 : Math.round((v / max) * top)] ?? "")
			.join("");
	};
	return <Decor tone="bracket">{bars()}</Decor>;
}
