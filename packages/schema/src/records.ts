import { z } from "zod";
import { AgentId, ModelRef, SessionId, Timestamp } from "./primitives.ts";
import { Cost, Usage } from "./provider.ts";

/**
 * One model call's cost, a line of `<state>/costs/<YYYY-MM>.jsonl` (the UTC month of `at`). Every
 * record passes through `redact()` before `appendJsonl` (#22 writes them).
 */
export const CostRecord = z
	.object({
		v: z.literal(1),
		at: Timestamp,
		sessionId: SessionId,
		agentId: AgentId,
		model: ModelRef,
		usage: Usage,
		cost: Cost,
	})
	.readonly();
/** One model call's cost. */
export type CostRecord = z.infer<typeof CostRecord>;

/**
 * One prompt you typed, a line of `<state>/history.jsonl` (#15 input history). Every entry passes
 * through `redact()` before `appendJsonl`.
 */
export const HistoryEntry = z
	.object({
		v: z.literal(1),
		at: Timestamp,
		projectRoot: z.string(),
		text: z.string(),
	})
	.readonly();
/** One prompt you typed. */
export type HistoryEntry = z.infer<typeof HistoryEntry>;
