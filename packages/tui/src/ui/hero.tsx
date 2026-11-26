import { RGBA } from "@opentui/core";
import { For, Index, Show } from "solid-js";
import { type GlobeLayer, globeFrame } from "../globe.ts";
import { ASCII_GLYPHS } from "../glyphs.ts";
import { useHud } from "./context.tsx";
import { Words } from "./primitives.tsx";

/** The globe's size in cells: 28 columns by 14 rows (56 by 56 Braille dots). */
export const GLOBE_COLS = 28;
export const GLOBE_ROWS = 14;
/** Below this transcript region the hero falls back to the ASCIIFont wordmark. */
export const HERO_MIN_ROWS = 24;
export const HERO_MIN_COLS = 40;

/**
 * The ASCII mode wordmark (AC-5): every ASCIIFont draws with block or box glyphs, so ASCII mode uses
 * this printable ASCII `PK` instead.
 */
export const ASCII_WORDMARK = [
	" ___ _  __",
	"| _ \\ |/ /",
	"|  _/ ' < ",
	"|_| |_|\\_\\",
] as const;

const TIPS = [
	"type a prompt and press enter",
	"ctrl+b hides the side rails",
	"hold shift (option on macOS) to select text natively",
] as const;

function layerTone(
	layer: GlobeLayer,
): "bracket" | "textDim" | "line" | undefined {
	switch (layer) {
		case "outline":
			return "bracket";
		case "land":
			return "textDim";
		case "graticule":
			return "line";
		case "none":
			return undefined;
		default: {
			const unreachable: never = layer;
			return unreachable;
		}
	}
}

/** Runs of cells that share a layer, so a globe row is a handful of spans, not 28. */
function runs(
	row: string,
	layers: readonly GlobeLayer[],
): { text: string; layer: GlobeLayer }[] {
	const cells = [...row];
	const out: { text: string; layer: GlobeLayer }[] = [];
	cells.forEach((cell, i) => {
		const layer = layers[i] ?? "none";
		const last = out.at(-1);
		if (last && last.layer === layer) last.text += cell;
		else out.push({ text: cell, layer });
	});
	return out;
}

/**
 * The hero (AC-16): shown while the transcript is empty. A turning Braille globe with the wordmark and
 * three tips, or the ASCIIFont `PK` wordmark when the region is small or the glyphs are ASCII.
 */
export function Hero(props: {
	width: number;
	height: number;
	rotation: number;
	globe: boolean;
}) {
	const hud = useHud();
	const frame = () =>
		globeFrame(props.rotation, GLOBE_COLS, GLOBE_ROWS, {
			graticule: hud.theme().mode !== "none",
		});
	const fontColor = () => hud.theme().title.fg ?? RGBA.defaultForeground();
	return (
		<box
			flexDirection="column"
			alignItems="center"
			justifyContent="center"
			width={props.width}
			height={props.height}
		>
			<Show
				when={props.globe}
				fallback={
					<Show
						when={hud.glyphs !== ASCII_GLYPHS}
						fallback={
							<box flexDirection="column">
								<For each={ASCII_WORDMARK}>
									{(line) => (
										<text selectable={false} height={1} wrapMode="none">
											<Words tone="title">{line}</Words>
										</text>
									)}
								</For>
							</box>
						}
					>
						<ascii_font
							selectable={false}
							text="PK"
							font="tiny"
							color={fontColor()}
							backgroundColor={hud.theme().canvasBg}
						/>
					</Show>
				}
			>
				<box flexDirection="column" width={GLOBE_COLS}>
					<Index each={frame().rows}>
						{(row, i) => (
							<text selectable={false} height={1} wrapMode="none">
								<For each={runs(row(), frame().layers[i] ?? [])}>
									{(run) => {
										const tone = layerTone(run.layer);
										return tone ? (
											<span style={hud.theme()[tone]}>{run.text}</span>
										) : (
											<span>{run.text}</span>
										);
									}}
								</For>
							</text>
						)}
					</Index>
				</box>
				<text selectable={false} height={1} marginTop={1}>
					<Words tone="title">{`${hud.glyphs.wordmark} PK`}</Words>
				</text>
			</Show>
			<box flexDirection="column" alignItems="center" marginTop={1}>
				<For each={TIPS}>
					{(tip) => (
						<text selectable={false} height={1} wrapMode="none">
							<Words tone="textDim">{tip}</Words>
						</text>
					)}
				</For>
			</box>
		</box>
	);
}

/** The `too_small` notice (AC-6), drawn over the mounted screen. */
export function TooSmall(props: {
	width: number;
	height: number;
	minWidth: number;
	minHeight: number;
}) {
	const hud = useHud();
	return (
		<box
			position="absolute"
			left={0}
			top={0}
			width={props.width}
			height={props.height}
			zIndex={100}
			backgroundColor={hud.theme().canvasBg}
			flexDirection="column"
			alignItems="center"
			justifyContent="center"
		>
			<text selectable={false} wrapMode="word">
				<Words tone="amber">{`${hud.glyphs.warn} window too small`}</Words>
			</text>
			<text selectable={false} wrapMode="word">
				<Words tone="textDim">{`${props.width}x${props.height}, needs ${props.minWidth}x${props.minHeight}`}</Words>
			</text>
		</box>
	);
}
