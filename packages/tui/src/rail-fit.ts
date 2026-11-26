/** One rail panel's name and its natural content rows. */
export interface RailPanelSize {
	readonly name: string;
	readonly rows: number;
}

/** Frame rows a panel takes besides its content: the title rule and the bottom stubs. */
export const PANEL_FRAME_ROWS = 2;

/**
 * Fits the left rail's panels into `height` rows, top down (AC-10). A panel keeps its natural rows
 * when they fit, shrinks when only part fits, and is drawn only if its title row and at least one
 * content row fit; the panels below it drop too. Returns each drawn panel's content rows.
 */
export function fitStacked(
	panels: readonly RailPanelSize[],
	height: number,
): readonly RailPanelSize[] {
	let left = height;
	const out: RailPanelSize[] = [];
	for (const panel of panels) {
		const room = left - PANEL_FRAME_ROWS;
		if (room < 1) break;
		const rows = Math.min(panel.rows, room);
		out.push({ name: panel.name, rows });
		left -= rows + PANEL_FRAME_ROWS;
	}
	return out;
}

/**
 * Fits the right rail (AC-10): ACTIVITY takes the rest, with TOKENS and COST below it. When ACTIVITY
 * would get under one content row, COST drops, then TOKENS.
 */
export function fitActivity(
	height: number,
	tokensRows: number,
	costRows: number,
): { activity: number; tokens: boolean; cost: boolean } {
	const frame = PANEL_FRAME_ROWS;
	const withBoth = height - frame - (tokensRows + frame) - (costRows + frame);
	if (withBoth >= 1) return { activity: withBoth, tokens: true, cost: true };
	const withTokens = height - frame - (tokensRows + frame);
	if (withTokens >= 1)
		return { activity: withTokens, tokens: true, cost: false };
	return { activity: Math.max(0, height - frame), tokens: false, cost: false };
}
