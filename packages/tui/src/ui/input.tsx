import type { KeyBinding, TextareaRenderable } from "@opentui/core";
import { RGBA } from "@opentui/core";
import { createSignal } from "solid-js";
import { useHud } from "./context.tsx";
import { Panel, Words } from "./primitives.tsx";

/** Enter submits (replacing the textarea default); Shift+Enter and Ctrl+J insert a newline (AC-15). */
const INPUT_KEYS: KeyBinding[] = [
	{ name: "return", action: "submit" },
	{ name: "kpenter", action: "submit" },
	{ name: "return", shift: true, action: "newline" },
	{ name: "linefeed", action: "newline" },
];

/** Input rows: grows with content from 1 to 8, then scrolls. */
const MAX_INPUT_ROWS = 8;

/**
 * The input (AC-15): a bracketed panel with a `›` caret and a dim placeholder. It stays mounted for
 * the whole session, so the draft survives permission prompts, resizes and `too_small`.
 */
export function InputPanel(props: {
	width: number;
	/** The most rows the whole panel may take (40% of the center). */
	maxHeight: number;
	focused: boolean;
	visible: boolean;
	onSubmit: (text: string) => void;
	ref: (textarea: TextareaRenderable) => void;
}) {
	const hud = useHud();
	const [rows, setRows] = createSignal(1);
	let textarea: TextareaRenderable | undefined;
	// Frame rules take 2 rows.
	const height = () =>
		Math.max(1, Math.min(rows(), MAX_INPUT_ROWS, props.maxHeight - 2));
	const colors = () => {
		const t = hud.theme();
		const fg = t.text.fg ?? RGBA.defaultForeground();
		return {
			fg,
			bg: t.surfaceBg,
			placeholder: t.textDim.fg ?? fg,
			cursor: t.text.fg ?? fg,
			selection: t.selectionBg.bg ?? t.surfaceBg,
		};
	};
	return (
		<box visible={props.visible} flexShrink={0}>
			<Panel width={props.width} padX={1} fill={colors().bg}>
				<box flexDirection="row" height={height()}>
					<text selectable={false} width={2} wrapMode="none">
						<Words tone="title">{`${hud.glyphs.caret} `}</Words>
					</text>
					<textarea
						ref={(el: TextareaRenderable) => {
							textarea = el;
							props.ref(el);
						}}
						flexGrow={1}
						height={height()}
						focused={props.focused}
						placeholder="ask pk anything"
						placeholderColor={colors().placeholder}
						textColor={colors().fg}
						focusedTextColor={colors().fg}
						backgroundColor={colors().bg}
						focusedBackgroundColor={colors().bg}
						cursorColor={colors().cursor}
						selectionBg={colors().selection}
						selectionFg={colors().fg}
						wrapMode="word"
						keyBindings={INPUT_KEYS}
						onContentChange={() =>
							setRows(Math.max(1, textarea?.virtualLineCount ?? 1))
						}
						onSubmit={() => props.onSubmit(textarea?.plainText ?? "")}
					/>
				</box>
			</Panel>
		</box>
	);
}
