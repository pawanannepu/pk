import { formatModelRef } from "@pk/schema";
import { For, Index, Show } from "solid-js";
import { formatCost, formatMicroUsd, formatTokens } from "../format.ts";
import type { ToolView } from "../hud/state.ts";
import { CONTEXT_WARN_RATIO } from "../hud-constants.ts";
import { RAIL_WIDTH } from "../layout.ts";
import { fitActivity, fitStacked } from "../rail-fit.ts";
import {
	cellWidth,
	sanitizeForScreen,
	truncateEnd,
	truncateMiddle,
} from "../text.ts";
import { useHud } from "./context.tsx";
import {
	Decor,
	Gauge,
	Panel,
	Sparkline,
	Spinner,
	StatusGlyph,
	Words,
} from "./primitives.tsx";

/** Panel width inside a rail: the rail minus its `vrule`. */
const PANEL_WIDTH = RAIL_WIDTH - 1;
/** Content width inside a rail panel's 1 column margins. */
const CONTENT = PANEL_WIDTH - 2;
const LIST_MAX = 8;

function Row(props: { children: import("solid-js").JSX.Element }) {
	return (
		<text selectable={false} height={1} wrapMode="none">
			{props.children}
		</text>
	);
}

function RailPanel(props: {
	title: string;
	rows: number;
	children: import("solid-js").JSX.Element;
}) {
	return (
		<Panel width={PANEL_WIDTH} title={props.title} padX={1}>
			<box flexDirection="column" height={props.rows} overflow="hidden">
				{props.children}
			</box>
		</Panel>
	);
}

/** The inner edge of a rail: one `vrule` column in `line`. */
function RailEdge(props: { height: number }) {
	const g = useHud().glyphs;
	return (
		<text selectable={false} width={1} height={props.height} wrapMode="char">
			<Decor tone="line">{g.vrule.repeat(props.height)}</Decor>
		</text>
	);
}

/** A list capped at `max` rows: the items that fit, plus `+n more` (at the top or the bottom). */
function capped<T>(
	items: readonly T[],
	max: number,
	moreAtTop: boolean,
): { shown: readonly T[]; more: number } {
	if (items.length <= max) return { shown: items, more: 0 };
	const keep = Math.max(0, max - 1);
	return moreAtTop
		? { shown: items.slice(items.length - keep), more: items.length - keep }
		: { shown: items.slice(0, keep), more: items.length - keep };
}

/** The left rail: SESSION, CONTEXT, PLAN and FILES (AC-10). */
export function LeftRail(props: { height: number }) {
	const hud = useHud();
	const g = hud.glyphs;
	const state = hud.store.state;
	const info = hud.options.info;

	const planRows = () => Math.max(1, Math.min(LIST_MAX, state().todos.length));
	const filesRows = () => Math.max(1, Math.min(LIST_MAX, state().files.length));
	const fit = () =>
		fitStacked(
			[
				{ name: "SESSION", rows: 3 },
				{ name: "CONTEXT", rows: 2 },
				{ name: "PLAN", rows: planRows() },
				{ name: "FILES", rows: filesRows() },
			],
			props.height,
		);
	const rowsOf = (name: string) => fit().find((p) => p.name === name)?.rows;

	const folderName = () => {
		const parts = info.projectRoot.split("/").filter((p) => p !== "");
		return sanitizeForScreen(parts.at(-1) ?? info.projectRoot);
	};

	const context = () => {
		const s = state();
		const tokens = s.usage.lastContextTokens;
		const window = info.contextWindow;
		const ratio = window ? tokens / window : 0;
		return {
			calls: s.usage.calls,
			tokens,
			window,
			ratio,
			warn: ratio >= CONTEXT_WARN_RATIO,
		};
	};

	const plan = () => capped(state().todos, rowsOf("PLAN") ?? 0, false);
	const files = () => capped(state().files, rowsOf("FILES") ?? 0, true);

	return (
		<box flexDirection="row" width={RAIL_WIDTH} flexShrink={0}>
			<box flexDirection="column" width={PANEL_WIDTH}>
				<Show when={rowsOf("SESSION")}>
					{(rows: () => number) => (
						<RailPanel title="SESSION" rows={rows()}>
							<Row>
								<Words tone="text">
									{truncateEnd(
										sanitizeForScreen(formatModelRef(state().model)),
										CONTENT,
										g.ellipsis,
									)}
								</Words>
							</Row>
							<Row>
								<Words tone="textDim">{info.mode}</Words>
							</Row>
							<Row>
								<Words tone="textDim">
									{truncateMiddle(folderName(), CONTENT, g.ellipsis)}
								</Words>
							</Row>
						</RailPanel>
					)}
				</Show>
				<Show when={rowsOf("CONTEXT")}>
					{(rows: () => number) => (
						<RailPanel title="CONTEXT" rows={rows()}>
							<Show
								when={context().calls > 0}
								fallback={
									<Row>
										<Words tone="textDim">no calls yet</Words>
									</Row>
								}
							>
								<Show
									when={context().window}
									fallback={
										<Row>
											<Words tone="textDim">window unknown</Words>
										</Row>
									}
								>
									<Row>
										<Gauge
											ratio={context().ratio}
											cells={10}
											warn={context().warn}
										/>
										<Words
											tone={context().warn ? "amber" : "text"}
										>{`  ${Math.round(context().ratio * 100)}%`}</Words>
									</Row>
								</Show>
								<Row>
									<Words tone="textDim">{`${formatTokens(context().tokens)} tok`}</Words>
								</Row>
							</Show>
						</RailPanel>
					)}
				</Show>
				<Show when={rowsOf("PLAN")}>
					{(rows: () => number) => (
						<RailPanel title="PLAN" rows={rows()}>
							<Show
								when={state().todos.length > 0}
								fallback={
									<Row>
										<Words tone="textDim">no plan yet</Words>
									</Row>
								}
							>
								<For each={plan().shown}>
									{(todo) => (
										<Row>
											<Show
												when={todo.status === "in_progress"}
												fallback={
													<Decor
														tone={
															todo.status === "done" ? "textDim" : "textDim"
														}
													>
														{todo.status === "done" ? g.done : g.pending}
													</Decor>
												}
											>
												<Spinner />
											</Show>
											<Words
												tone={todo.status === "done" ? "textDim" : "text"}
											>{` ${truncateEnd(sanitizeForScreen(todo.content), CONTENT - 2, g.ellipsis)}`}</Words>
										</Row>
									)}
								</For>
								<Show when={plan().more > 0}>
									<Row>
										<Words tone="textDim">{`+${plan().more} more`}</Words>
									</Row>
								</Show>
							</Show>
						</RailPanel>
					)}
				</Show>
				<Show when={rowsOf("FILES")}>
					{(rows: () => number) => (
						<RailPanel title="FILES" rows={rows()}>
							<Show
								when={state().files.length > 0}
								fallback={
									<Row>
										<Words tone="textDim">no files yet</Words>
									</Row>
								}
							>
								<Show when={files().more > 0}>
									<Row>
										<Words tone="textDim">{`+${files().more} more`}</Words>
									</Row>
								</Show>
								<For each={files().shown}>
									{(file) => {
										const changed = () => file.added > 0 || file.removed > 0;
										const counts = () =>
											changed() ? `+${file.added} -${file.removed}` : "r";
										const room = () => CONTENT - cellWidth(counts()) - 1;
										const path = () =>
											truncateMiddle(
												sanitizeForScreen(file.path),
												room(),
												g.ellipsis,
											);
										return (
											<Row>
												<Words tone="text">{path()}</Words>
												<span>
													{" ".repeat(
														Math.max(
															1,
															CONTENT - cellWidth(path()) - cellWidth(counts()),
														),
													)}
												</span>
												<Show
													when={changed()}
													fallback={<Words tone="textDim">r</Words>}
												>
													<Words tone="green">{`+${file.added}`}</Words>
													<Words tone="red">{` -${file.removed}`}</Words>
												</Show>
											</Row>
										);
									}}
								</For>
							</Show>
						</RailPanel>
					)}
				</Show>
			</box>
			<RailEdge height={props.height} />
		</box>
	);
}

function ActivityRow(props: { tool: ToolView }) {
	const g = useHud().glyphs;
	const name = () =>
		truncateEnd(sanitizeForScreen(props.tool.name), 9, g.ellipsis);
	const target = () =>
		truncateMiddle(
			props.tool.target ?? "",
			CONTENT - 2 - cellWidth(name()) - 1,
			g.ellipsis,
		);
	return (
		<Row>
			<StatusGlyph state={props.tool.state} />
			<Words tone="text">{` ${name()}`}</Words>
			<Words tone="textDim">{` ${target()}`}</Words>
		</Row>
	);
}

/** The right rail: ACTIVITY (newest first), TOKENS and COST (AC-10). */
export function RightRail(props: { height: number }) {
	const hud = useHud();
	const state = hud.store.state;
	const fit = () => fitActivity(props.height, 1, 2);
	const recent = () =>
		Object.values(state().tools)
			.reverse()
			.slice(0, Math.max(0, fit().activity));
	const empty = () => state().usage.calls === 0;
	return (
		<box flexDirection="row" width={RAIL_WIDTH} flexShrink={0}>
			<RailEdge height={props.height} />
			<box flexDirection="column" width={PANEL_WIDTH}>
				<Show when={fit().activity > 0}>
					<RailPanel title="ACTIVITY" rows={fit().activity}>
						<Show
							when={recent().length > 0}
							fallback={
								<Row>
									<Words tone="textDim">idle</Words>
								</Row>
							}
						>
							<Index each={recent()}>
								{(tool) => <ActivityRow tool={tool()} />}
							</Index>
						</Show>
					</RailPanel>
				</Show>
				<Show when={fit().tokens}>
					<RailPanel title="TOKENS" rows={1}>
						<Show
							when={!empty()}
							fallback={
								<Row>
									<Words tone="textDim">no calls yet</Words>
								</Row>
							}
						>
							<Row>
								<Sparkline values={state().usage.recentOutput} />
								<Words tone="text">{`  ${formatTokens(state().usage.recentOutput.at(-1) ?? 0)}`}</Words>
							</Row>
						</Show>
					</RailPanel>
				</Show>
				<Show when={fit().cost}>
					<RailPanel title="COST" rows={2}>
						<Show
							when={!empty()}
							fallback={
								<Row>
									<Words tone="textDim">no calls yet</Words>
								</Row>
							}
						>
							<Row>
								<Words tone="text">
									{truncateEnd(
										formatCost(state().cost, hud.glyphs.rule),
										CONTENT,
										hud.glyphs.ellipsis,
									)}
								</Words>
							</Row>
							<Row>
								<Words tone="textDim">{`last turn ${formatMicroUsd(state().cost.lastTurnMicroUsd)}`}</Words>
							</Row>
						</Show>
					</RailPanel>
				</Show>
			</box>
		</box>
	);
}
