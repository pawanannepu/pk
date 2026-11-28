import { RGBA } from "@opentui/core";
import { type ResultOutcome, ToolDisplayDetails } from "@pk/schema";
import { type Accessor, Index, Match, Show, Switch } from "solid-js";
import { formatBytes, formatDuration } from "../format.ts";
import type { NoticeLevel, ToolView, TranscriptItem } from "../hud/state.ts";
import { DIFF_MAX_LINES } from "../hud-constants.ts";
import { cutPatch } from "../patch.ts";
import {
	cellWidth,
	sanitizeForScreen,
	truncateEnd,
	truncateMiddle,
} from "../text.ts";
import { useHud } from "./context.tsx";
import { Panel, Spinner, StatusGlyph, Words } from "./primitives.tsx";

type Of<K extends TranscriptItem["kind"]> = Extract<
	TranscriptItem,
	{ kind: K }
>;

/** Columns tool lines, notices and reply text sit in from the left edge. */
const INDENT = 2;
/** Tool names are padded to this many cells so targets line up. */
const NAME_CELLS = 12;

function UserItem(props: { item: Of<"user">; first: boolean }) {
	const hud = useHud();
	const g = hud.glyphs;
	return (
		<box
			marginTop={props.first ? 0 : 1}
			border={["left"]}
			customBorderChars={{
				topLeft: g.bar,
				topRight: g.bar,
				bottomLeft: g.bar,
				bottomRight: g.bar,
				horizontal: " ",
				vertical: g.bar,
				topT: g.bar,
				bottomT: g.bar,
				leftT: g.bar,
				rightT: g.bar,
				cross: g.bar,
			}}
			borderColor={hud.theme().bracket.fg ?? RGBA.defaultForeground()}
			paddingLeft={1}
			flexShrink={0}
		>
			<box flexDirection="row">
				<text selectable={false} width={2} wrapMode="none">
					<Words tone="title">{`${g.caret} `}</Words>
				</text>
				<text wrapMode="word" flexGrow={1}>
					<Words tone="text">{sanitizeForScreen(props.item.text)}</Words>
				</text>
			</box>
		</box>
	);
}

function TextItem(props: { item: Of<"text"> }) {
	return (
		<box paddingLeft={INDENT} flexShrink={0}>
			<text wrapMode="word">
				<Words tone="text">{sanitizeForScreen(props.item.text)}</Words>
			</text>
		</box>
	);
}

function ReasoningItem(props: { item: Of<"reasoning"> }) {
	const hud = useHud();
	const g = hud.glyphs;
	const streaming = () => {
		const s = hud.store.state();
		return s.turn.status === "running" && s.openSegment?.key === props.item.key;
	};
	const seconds = () =>
		Math.max(1, Math.round((props.item.lastAt - props.item.firstAt) / 1000));
	return (
		<box paddingLeft={INDENT} flexShrink={0}>
			<text wrapMode="none">
				<Words tone="textDim">{`${g.reasoning} `}</Words>
				<Show
					when={streaming()}
					fallback={<Words tone="textDim">{`thought for ${seconds()}s`}</Words>}
				>
					<Words tone="textDim">thinking </Words>
					<Spinner tone="textDim" />
				</Show>
			</text>
		</box>
	);
}

/** A notice's glyph and tone: info dim, warning amber, danger red (spec 0006 AC-11). */
function noticeStyle(
	level: NoticeLevel,
	g: { info: string; warn: string },
): { glyph: string; tone: "textDim" | "amber" | "red" } {
	switch (level) {
		case "info":
			return { glyph: g.info, tone: "textDim" };
		case "warning":
			return { glyph: g.warn, tone: "amber" };
		case "danger":
			return { glyph: g.warn, tone: "red" };
		default: {
			const unreachable: never = level;
			return unreachable;
		}
	}
}

function NoticeItem(props: { item: Of<"notice"> }) {
	const g = useHud().glyphs;
	const style = () => noticeStyle(props.item.level, g);
	return (
		<box paddingLeft={INDENT} flexShrink={0}>
			<text wrapMode="word">
				<Words tone={style().tone}>
					{`${style().glyph} ${sanitizeForScreen(props.item.text)}`}
				</Words>
			</text>
		</box>
	);
}

function ErrorItem(props: { item: Of<"error">; width: number }) {
	return (
		<box marginTop={1} flexShrink={0}>
			<Panel
				width={Math.min(props.width, 72)}
				title="ERROR"
				subtitle={sanitizeForScreen(props.item.code)}
				accent="red"
				padY={1}
			>
				<text wrapMode="word">
					<Words tone="text">{sanitizeForScreen(props.item.message)}</Words>
				</text>
				<Show when={props.item.hint}>
					{(hint: Accessor<string>) => (
						<text wrapMode="word">
							<Words tone="textDim">{`try: ${hint()}`}</Words>
						</text>
					)}
				</Show>
			</Panel>
		</box>
	);
}

/** The right side of a tool line: size and duration, elapsed while running, or the error line. */
/** The dim state word of a denied, blocked or not run call (spec 0006 AC-12). */
export function outcomeWord(outcome: ResultOutcome): string {
	switch (outcome) {
		case "denied":
			return "denied";
		case "blocked":
			return "blocked";
		case "not_run":
			return "not run";
		default: {
			const unreachable: never = outcome;
			return unreachable;
		}
	}
}

function toolRight(tool: ToolView, now: number, dot: string): string {
	switch (tool.state) {
		case "pending":
			return "";
		case "running":
			return `running ${formatDuration(now - (tool.runAt ?? now))}`;
		case "done":
			return `${formatBytes(tool.sizeBytes ?? 0)} ${dot} ${formatDuration(tool.durationMs ?? 0)}`;
		case "failed":
			return tool.outcome === undefined
				? sanitizeForScreen(tool.errorLine ?? "")
				: outcomeWord(tool.outcome);
		default: {
			const unreachable: never = tool.state;
			return unreachable;
		}
	}
}

function DiffView(props: { diff: string; width: number }) {
	const hud = useHud();
	const cut = () => cutPatch(sanitizeForScreen(props.diff), DIFF_MAX_LINES);
	const colors = () => {
		const t = hud.theme();
		const fg = t.text.fg ?? RGBA.defaultForeground();
		const bg = t.canvasBg;
		const addSign = t.green.fg ?? fg;
		const removeSign = t.red.fg ?? fg;
		const addBg = t.tintDiffRows ? (t.addBg.bg ?? bg) : bg;
		const removeBg = t.tintDiffRows ? (t.removeBg.bg ?? bg) : bg;
		return {
			fg,
			bg,
			addSign,
			removeSign,
			addBg,
			removeBg,
			lineFg: t.textDim.fg ?? fg,
			sel: t.selectionBg.bg ?? bg,
		};
	};
	return (
		<box flexDirection="column" paddingLeft={INDENT + 2} flexShrink={0}>
			<diff
				diff={cut().patch}
				view="unified"
				showLineNumbers={true}
				wrapMode="none"
				width={Math.max(10, props.width - INDENT - 2)}
				fg={colors().fg}
				lineNumberFg={colors().lineFg}
				lineNumberBg={colors().bg}
				addedBg={colors().addBg}
				removedBg={colors().removeBg}
				contextBg={colors().bg}
				addedContentBg={colors().addBg}
				removedContentBg={colors().removeBg}
				contextContentBg={colors().bg}
				addedSignColor={colors().addSign}
				removedSignColor={colors().removeSign}
				addedLineNumberBg={colors().addBg}
				removedLineNumberBg={colors().removeBg}
				selectionBg={colors().sel}
				selectionFg={colors().fg}
			/>
			<Show when={cut().cut > 0}>
				<text>
					<Words tone="textDim">{`${hud.glyphs.ellipsis} ${cut().cut} more lines`}</Words>
				</text>
			</Show>
		</box>
	);
}

function ToolItem(props: { item: Of<"tool">; width: number }) {
	const hud = useHud();
	const g = hud.glyphs;
	const tool = () => hud.store.state().tools[props.item.callId];
	const line = () => {
		const t = tool();
		if (!t) return undefined;
		const name = truncateEnd(
			sanitizeForScreen(t.name),
			NAME_CELLS - 1,
			g.ellipsis,
		);
		const right = toolRight(t, hud.now(), g.info);
		const inner = props.width - INDENT - 1;
		const rightCells = Math.min(cellWidth(right), Math.floor(inner / 2));
		const rightText = truncateEnd(right, rightCells, g.ellipsis);
		const targetRoom = Math.max(0, inner - 2 - NAME_CELLS - rightCells - 2);
		const target = truncateMiddle(t.target ?? "", targetRoom, g.ellipsis);
		const pad = Math.max(
			1,
			inner - 2 - NAME_CELLS - cellWidth(target) - cellWidth(rightText),
		);
		return { t, name, target, rightText, pad };
	};
	// A diff shows only when `details` parses as `ToolDisplayDetails` with a `diff`; anything else is ignored.
	const diff = () => {
		const parsed = ToolDisplayDetails.safeParse(tool()?.display);
		return parsed.success ? parsed.data.diff : undefined;
	};
	return (
		<Show when={line()}>
			{(l: Accessor<NonNullable<ReturnType<typeof line>>>) => (
				<box flexDirection="column" flexShrink={0}>
					<box paddingLeft={INDENT}>
						<text wrapMode="none">
							<StatusGlyph state={l().t.state} />
							<span> </span>
							<span style={{ ...hud.theme().title, bold: true }}>
								{l().name.padEnd(NAME_CELLS - 1)}
							</span>
							<span> </span>
							<Words tone="textDim">{l().target}</Words>
							<span>{" ".repeat(l().pad)}</span>
							<Show
								when={l().t.state === "failed"}
								fallback={<Words tone="textDim">{l().rightText}</Words>}
							>
								<Words tone={l().t.outcome === undefined ? "red" : "textDim"}>
									{l().rightText}
								</Words>
							</Show>
						</text>
					</box>
					<Show when={diff()}>
						{(d: Accessor<string>) => (
							<DiffView diff={d()} width={props.width} />
						)}
					</Show>
				</box>
			)}
		</Show>
	);
}

function isKind<K extends TranscriptItem["kind"]>(
	item: TranscriptItem,
	kind: K,
): item is Of<K> {
	return item.kind === kind;
}

/** One transcript item, by kind (AC-11 to AC-14). */
function Item(props: {
	item: Accessor<TranscriptItem>;
	index: number;
	width: number;
}) {
	const as = <K extends TranscriptItem["kind"]>(kind: K): Of<K> | undefined => {
		const item = props.item();
		return isKind(item, kind) ? item : undefined;
	};
	return (
		<Switch>
			<Match when={as("user")}>
				{(item: Accessor<Of<"user">>) => (
					<UserItem item={item()} first={props.index === 0} />
				)}
			</Match>
			<Match when={as("text")}>
				{(item: Accessor<Of<"text">>) => <TextItem item={item()} />}
			</Match>
			<Match when={as("reasoning")}>
				{(item: Accessor<Of<"reasoning">>) => <ReasoningItem item={item()} />}
			</Match>
			<Match when={as("tool")}>
				{(item: Accessor<Of<"tool">>) => (
					<ToolItem item={item()} width={props.width} />
				)}
			</Match>
			<Match when={as("notice")}>
				{(item: Accessor<Of<"notice">>) => <NoticeItem item={item()} />}
			</Match>
			<Match when={as("error")}>
				{(item: Accessor<Of<"error">>) => (
					<ErrorItem item={item()} width={props.width} />
				)}
			</Match>
		</Switch>
	);
}

/**
 * The transcript items in order. `<Index>` keeps each slot, so a streaming segment updates its text
 * in place instead of remounting.
 */
export function TranscriptItems(props: { width: number }) {
	const hud = useHud();
	return (
		<Index each={hud.store.state().transcript}>
			{(item, index) => <Item item={item} index={index} width={props.width} />}
		</Index>
	);
}
