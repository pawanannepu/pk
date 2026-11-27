/** The model calls one prompt may make before the turn ends `turn_limit`, when `limits.maxTurns` is unset. */
export const DEFAULT_MAX_TURNS = 50;

/** The version of `placeholderSystemPrompt`'s text. #17 replaces it with the real prompt. */
export const PLACEHOLDER_SYSTEM_PROMPT_VERSION = 1;

/** What the placeholder prompt is built from. */
export interface PlaceholderPromptInput {
	readonly projectRoot: string;
	/** `YYYY-MM-DD`, from `localDate`. */
	readonly today: string;
	/** Tool names in `deps.tools` order. */
	readonly toolNames: readonly string[];
}

/** The minimal system prompt until #17 (spec 0005 AC-15, version 1). Pure. */
export function placeholderSystemPrompt(input: PlaceholderPromptInput): string {
	return [
		`You are pk, a coding agent working in a terminal. The project is at ${input.projectRoot}. Today is ${input.today}.`,
		`Use the tools (${input.toolNames.join(", ")}) to look at files before you answer questions about them. Paths are relative to the project root.`,
		"Answer concisely.",
	].join("\n");
}

/** The calendar date `nowMs` falls on in `timeZone` (an IANA name), as `YYYY-MM-DD`. Pure. */
export function localDate(nowMs: number, timeZone: string): string {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(nowMs);
	const part = (type: "year" | "month" | "day") =>
		parts.find((p) => p.type === type)?.value ?? "";
	return `${part("year")}-${part("month")}-${part("day")}`;
}
