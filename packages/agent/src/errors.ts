import { PkError } from "@pk/env";

/** The stable codes an `AgentError` carries. */
export type AgentErrorCode =
	| "agent.duplicate_tool"
	| "agent.events_taken"
	| "agent.invalid_mode";

/** A wiring bug in how a session was built or read. Thrown at once, never as a turn error. */
export class AgentError extends PkError {
	declare readonly code: AgentErrorCode;

	constructor(code: AgentErrorCode, message: string) {
		super(code, message);
	}
}
