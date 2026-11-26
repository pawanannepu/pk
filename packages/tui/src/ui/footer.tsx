import { formatModelRef, type PermissionMode } from "@pk/schema";
import { For } from "solid-js";
import { formatCost, formatTokens } from "../format.ts";
import { cellWidth, sanitizeForScreen } from "../text.ts";
import { useHud } from "./context.tsx";
import { Marker, Words } from "./primitives.tsx";

/** The built in hints: only keys that work today (AC-9). */
const BUILT_IN_HINTS = ["ctrl+b/f2 rails", "ctrl+c quit"] as const;

/** The legend marker color for a permission mode (AC-9). */
export function modeTone(mode: PermissionMode): "bracket" | "amber" | "red" {
	switch (mode) {
		case "normal":
		case "plan":
			return "bracket";
		case "accept_edits":
			return "amber";
		case "skip_all":
			return "red";
		default: {
			const unreachable: never = mode;
			return unreachable;
		}
	}
}

/**
 * The footer legend strip (AC-9): mode, model, session tokens and cost on the left; hints on the
 * right. Hints drop from the left when space is short; the values never do.
 */
export function Footer(props: { width: number; flash?: string }) {
	const hud = useHud();
	const g = hud.glyphs;
	const state = hud.store.state;
	const mode = hud.options.info.mode;

	const values = () => {
		const s = state();
		return [
			mode,
			sanitizeForScreen(formatModelRef(s.model)),
			`${formatTokens(s.usage.totalTokens)} tok`,
			formatCost(s.cost, g.rule),
		] as const;
	};

	const hints = () => {
		// Status messages sit at the right end, so they are the last to drop.
		const all = [
			...(hud.options.hints ?? []),
			...BUILT_IN_HINTS,
			...(state().submitting ? ["turn running"] : []),
			...(props.flash ? [props.flash] : []),
		];
		const leftWidth = values().reduce((sum, v) => sum + cellWidth(v) + 5, 1);
		const room = props.width - leftWidth - 2;
		// Drop from the left until the rest fits.
		const fits = (list: readonly string[]) =>
			cellWidth(list.join(` ${g.info} `)) <= room;
		const kept = all.reduce<readonly string[]>(
			(acc, _, i) =>
				acc.length === 0 && fits(all.slice(i)) ? all.slice(i) : acc,
			[],
		);
		return kept.join(` ${g.info} `);
	};

	const pad = () =>
		Math.max(
			1,
			props.width -
				values().reduce((sum, v) => sum + cellWidth(v) + 5, 1) -
				cellWidth(hints()) -
				1,
		);

	return (
		<text selectable={false} height={1} flexShrink={0} wrapMode="none">
			<span> </span>
			<For each={values()}>
				{(value, i) => (
					<>
						<Marker
							tone={i() === 0 ? modeTone(mode) : "bracket"}
							value={value}
						/>
						<span>{"   "}</span>
					</>
				)}
			</For>
			<span>{" ".repeat(pad())}</span>
			<Words tone="textDim">{hints()}</Words>
		</text>
	);
}
