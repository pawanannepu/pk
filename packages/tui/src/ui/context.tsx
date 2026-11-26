import { PkError } from "@pk/env";
import { type Accessor, createContext, useContext } from "solid-js";
import type { GlyphSet } from "../glyphs.ts";
import type { HudStore } from "../hud/store.ts";
import type { TuiClock, TuiOptions } from "../session.ts";
import type { Theme } from "../theme.ts";

/** What every screen component reads: the theme, glyphs, the store, and the shared animation clock. */
export interface Hud {
	readonly theme: Accessor<Theme>;
	readonly glyphs: GlyphSet;
	readonly store: HudStore;
	readonly clock: TuiClock;
	readonly options: TuiOptions;
	/** The time, refreshed by the shared spinner interval while anything moves. */
	readonly now: Accessor<number>;
	/** The current spinner frame index (one shared interval drives every spinner). */
	readonly frame: Accessor<number>;
}

const HudContext = createContext<Hud>();

/** Provides `Hud` to the screen tree. */
export const HudProvider = HudContext.Provider;

/** Reads the `Hud`. Only used under `HudProvider`, which the shell always mounts. */
export function useHud(): Hud {
	const hud = useContext(HudContext);
	if (hud === undefined)
		throw new PkError(
			"tui.no_context",
			"a screen component was mounted outside the shell",
		);
	return hud;
}
