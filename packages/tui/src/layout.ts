/** Rail width in columns: a `vrule` plus 23 for panels. */
export const RAIL_WIDTH = 24;
/** The gap column between a rail and the center. */
export const RAIL_GAP = 1;
/** Below this many columns or rows the `too_small` notice is drawn over the screen. */
export const MIN_WIDTH = 60;
/** Below this many rows the `too_small` notice is drawn. */
export const MIN_HEIGHT = 16;

/** Which regions show and how wide they are, for one window size. */
export interface Layout {
	/** Draw the `too_small` notice over the (still mounted) screen. */
	readonly tooSmall: boolean;
	readonly left: boolean;
	readonly right: boolean;
	readonly centerWidth: number;
}

/**
 * The layout for a window (AC-6): both rails at 140 columns or more, the right rail from 100 to 139,
 * none below 100. `railsHidden` removes both at any width. Under 60 columns or 16 rows the screen is
 * `tooSmall`, with the regions underneath computed as usual so nothing unmounts.
 */
export function layoutFor(input: {
	readonly width: number;
	readonly height: number;
	readonly railsHidden: boolean;
}): Layout {
	const { width, height, railsHidden } = input;
	const tooSmall = width < MIN_WIDTH || height < MIN_HEIGHT;
	const right = !railsHidden && width >= 100;
	const left = !railsHidden && width >= 140;
	const rails = (left ? 1 : 0) + (right ? 1 : 0);
	return {
		tooSmall,
		left,
		right,
		centerWidth: Math.max(1, width - rails * (RAIL_WIDTH + RAIL_GAP)),
	};
}
