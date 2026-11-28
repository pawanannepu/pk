/**
 * @pk/agent: The agent loop, context assembly, sessions, and compaction. Emits the typed event stream and asks permissions before each tool run.
 *
 * #6 (spec 0005) ships `createAgentSession`: one session object per conversation, an imperative shell
 * around pure step functions (the reply fold, result wrapping). It satisfies the screen's
 * `TuiSession` port plus `close()`.
 */

/** `AgentError`, for wiring bugs such as two tools with one name. */
export { AgentError, type AgentErrorCode } from "./errors.ts";
/** The fixed result texts the loop writes for interrupted, failed, denied and plan blocked calls. */
export {
	ERROR_TEXT_MAX,
	INTERNAL_ERROR_TEXT,
	INTERRUPTED_BEFORE_TEXT,
	INTERRUPTED_DURING_TEXT,
	PLAN_BLOCKED_RESULT_TEXT,
	REPLY_FAILED_TEXT,
} from "./results.ts";
/** The session: its factory, deps and port, and the pure ledger fold. */
export {
	type AgentDeps,
	type AgentSession,
	createAgentSession,
	foldStamps,
} from "./session.ts";
/** The placeholder system prompt until #17, the default turn limit, and the local date helper. */
export {
	DEFAULT_MAX_TURNS,
	localDate,
	PLACEHOLDER_SYSTEM_PROMPT_VERSION,
	type PlaceholderPromptInput,
	placeholderSystemPrompt,
} from "./system-prompt.ts";
