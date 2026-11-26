import { redact } from "@pk/env";
import type { ToolKind } from "@pk/schema";
import { For, Show } from "solid-js";
import type { PendingPermission } from "../hud/state.ts";
import { PERMISSION_JSON_ROWS } from "../hud-constants.ts";
import {
	cellWidth,
	sanitizeForScreen,
	toolTarget,
	truncateMiddle,
} from "../text.ts";
import { useHud } from "./context.tsx";
import { Panel, Words } from "./primitives.tsx";

/** The verb a permission subtitle uses for a tool kind. */
export function kindVerb(kind: ToolKind): string {
	switch (kind) {
		case "read":
			return "read";
		case "write":
			return "write";
		case "execute":
			return "run";
		case "network":
			return "reach the network";
		default: {
			const unreachable: never = kind;
			return unreachable;
		}
	}
}

/**
 * The call input as indented JSON, cut to `maxRows` visual rows at `width` cells (wrapped rows count).
 * `cut` is true when rows were left out.
 */
export function jsonRows(
	input: unknown,
	width: number,
	maxRows: number,
): { lines: readonly string[]; cut: boolean } {
	const text = sanitizeForScreen(JSON.stringify(redact(input), null, 2) ?? "");
	const all = text.split("\n");
	const room = Math.max(1, width);
	let used = 0;
	const lines: string[] = [];
	for (const line of all) {
		const rows = Math.max(1, Math.ceil(cellWidth(line) / room));
		if (used + rows > maxRows) return { lines, cut: true };
		used += rows;
		lines.push(line);
	}
	return { lines, cut: false };
}

const KEYS_ROW = "[y] allow once   [a] this session   [n] deny";

/** Rows the panel takes besides the JSON: two rules, two blank rows, the target and the keys. */
export const PERMISSION_FIXED_ROWS = 6;

/**
 * The permission panel (AC-13): amber frame, `PERMISSION` title, `<tool> wants to <verb>`, the
 * target and the call input through `redact()`, and the keys, dim until the typing guard ends.
 */
export function PermissionPanel(props: {
	request: PendingPermission;
	queued: number;
	width: number;
	maxHeight: number;
	listening: boolean;
}) {
	const hud = useHud();
	const g = hud.glyphs;
	const inner = () => props.width - 6;
	const json = () =>
		jsonRows(
			props.request.call.input,
			inner(),
			Math.max(
				0,
				Math.min(
					PERMISSION_JSON_ROWS,
					props.maxHeight - PERMISSION_FIXED_ROWS - 1,
				),
			),
		);
	const target = () =>
		truncateMiddle(
			redact(toolTarget(props.request.call.input) ?? ""),
			inner(),
			g.ellipsis,
		);
	return (
		<Panel
			width={props.width}
			title="PERMISSION"
			subtitle={`${sanitizeForScreen(props.request.call.name)} wants to ${kindVerb(props.request.kind)}`}
			right={props.queued > 1 ? `1 of ${props.queued}` : undefined}
			accent="amber"
			padY={1}
			fill={hud.theme().surfaceBg}
		>
			<Show when={target()}>
				<text selectable={false} wrapMode="none">
					<Words tone="text">{target()}</Words>
				</text>
			</Show>
			<For each={json().lines}>
				{(line) => (
					<text selectable={false} wrapMode="char">
						<Words tone="textDim">{line}</Words>
					</text>
				)}
			</For>
			<Show when={json().cut}>
				<text selectable={false}>
					<Words tone="textDim">{g.ellipsis}</Words>
				</text>
			</Show>
			<text selectable={false} wrapMode="none">
				<Words tone={props.listening ? "text" : "textDim"}>{KEYS_ROW}</Words>
			</text>
		</Panel>
	);
}
