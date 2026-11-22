import { z } from "zod";

/** An ISO 8601 UTC time with milliseconds, like `2026-11-22T10:15:30.123Z`. Always from the injected clock. */
export const Timestamp = z.iso.datetime({ precision: 3 });
/** An ISO 8601 UTC time with milliseconds. */
export type Timestamp = z.infer<typeof Timestamp>;

/** Any JSON value: string, number, boolean, null, array or object, nested to any depth. */
export const JsonValue = z.json();
/** Any JSON value. */
export type JsonValue = z.infer<typeof JsonValue>;

/** A JSON object with string keys, such as a tool call's `input` or a JSON Schema. */
export const JsonObject = z.record(z.string(), JsonValue).readonly();
/** A JSON object with string keys. */
export type JsonObject = z.infer<typeof JsonObject>;

/** The 26 character ULID body in the uppercase Crockford base32 alphabet. */
const ULID_BODY = "[0-9A-HJKMNP-TV-Z]{26}";

function prefixedId(prefix: string) {
	return z
		.string()
		.regex(
			new RegExp(`^${prefix}_${ULID_BODY}$`),
			`must be "${prefix}_" followed by 26 Crockford base32 characters`,
		);
}

/** A session's ID, `ses_` plus a ULID. Branded, so it cannot be passed where another ID is expected. */
export const SessionId = prefixedId("ses").brand<"SessionId">();
/** A session's ID, `ses_` plus a ULID. */
export type SessionId = z.infer<typeof SessionId>;

/** A message's ID, `msg_` plus a ULID. */
export const MessageId = prefixedId("msg").brand<"MessageId">();
/** A message's ID, `msg_` plus a ULID. */
export type MessageId = z.infer<typeof MessageId>;

/** A tool call's ID, `call_` plus a ULID. Minted by pk, never the provider's own ID. */
export const CallId = prefixedId("call").brand<"CallId">();
/** A tool call's ID, `call_` plus a ULID. */
export type CallId = z.infer<typeof CallId>;

/** A permission request's ID, `req_` plus a ULID. */
export const RequestId = prefixedId("req").brand<"RequestId">();
/** A permission request's ID, `req_` plus a ULID. */
export type RequestId = z.infer<typeof RequestId>;

/** A turn's ID, `turn_` plus a ULID. */
export const TurnId = prefixedId("turn").brand<"TurnId">();
/** A turn's ID, `turn_` plus a ULID. */
export type TurnId = z.infer<typeof TurnId>;

/** An agent's ID: `main` for the root agent, or `agent_` plus a ULID for a subagent (#38). */
export const AgentId = z
	.string()
	.regex(
		new RegExp(`^(?:main|agent_${ULID_BODY})$`),
		'must be "main" or "agent_" followed by 26 Crockford base32 characters',
	)
	.brand<"AgentId">();
/** An agent's ID: `main` or `agent_` plus a ULID. */
export type AgentId = z.infer<typeof AgentId>;

/** The root agent's ID, `main`. */
export const MAIN_AGENT_ID: AgentId = AgentId.parse("main");

/** Maps each ID prefix to its branded type. `newId("call")` returns a `CallId`. */
export interface IdTypes {
	readonly ses: SessionId;
	readonly msg: MessageId;
	readonly call: CallId;
	readonly req: RequestId;
	readonly turn: TurnId;
	readonly agent: AgentId;
}

/** One of the ID prefixes: `ses`, `msg`, `call`, `req`, `turn`, `agent`. */
export type IdPrefix = keyof IdTypes;

/** Makes a new ID for a prefix. Built by `createIdFactory` in `@pk/env` and passed in explicitly. */
export type NewId = <P extends IdPrefix>(prefix: P) => IdTypes[P];

/** The schema for each ID prefix, so a minted ID can be checked against its own rule. */
export const ID_SCHEMAS: {
	readonly [P in IdPrefix]: { parse(value: unknown): IdTypes[P] };
} = {
	ses: SessionId,
	msg: MessageId,
	call: CallId,
	req: RequestId,
	turn: TurnId,
	agent: AgentId,
};

/** The rule a provider ID follows: lowercase letters, digits, `_` and `-`, starting with a letter or digit, at most 32 characters. */
export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** A provider's ID, the key of a `providers` settings entry or a preset name (#19). */
export const ProviderId = z
	.string()
	.regex(
		PROVIDER_ID_PATTERN,
		`provider ID must match ${PROVIDER_ID_PATTERN.source}`,
	);
/** A provider's ID. */
export type ProviderId = z.infer<typeof ProviderId>;

/** The API format a provider speaks. It names a wire format, not a vendor field. #31 adds `gemini`. */
export const ApiStyle = z.enum(["openai_chat", "anthropic_messages"]);
/** The API format a provider speaks. */
export type ApiStyle = z.infer<typeof ApiStyle>;

/** What a model is used for (#21): the main conversation, summarizing, or subagents. */
export const ModelRole = z.enum(["main", "summarize", "subagent"]);
/** What a model is used for. */
export type ModelRole = z.infer<typeof ModelRole>;

/** A model at a provider, like `{ provider: "openrouter", model: "anthropic/claude-x" }`. */
export const ModelRef = z
	.object({ provider: ProviderId, model: z.string().min(1) })
	.readonly();
/** A model at a provider. */
export type ModelRef = z.infer<typeof ModelRef>;

/** Why a `"provider/model"` string is not a valid model reference, or `undefined` when it is. */
function modelRefStringProblem(value: string): string | undefined {
	if (value.length === 0) {
		return 'model reference is empty; write it as "provider/model"';
	}
	const slash = value.indexOf("/");
	if (slash < 0) {
		return 'model reference has no "/"; write it as "provider/model"';
	}
	if (!PROVIDER_ID_PATTERN.test(value.slice(0, slash))) {
		return `the provider part before the first "/" must match ${PROVIDER_ID_PATTERN.source}`;
	}
	if (slash === value.length - 1) {
		return 'the model part after the first "/" is empty';
	}
	return undefined;
}

const ModelRefString = z
	.string()
	.meta({
		description:
			'A model as "provider/model", split at the first "/", for example "openrouter/anthropic/claude-x".',
		pattern: "^[a-z0-9][a-z0-9_-]{0,31}/.+$",
	})
	.transform((value, ctx): ModelRef => {
		const problem = modelRefStringProblem(value);
		if (problem !== undefined) {
			ctx.issues.push({ code: "custom", message: problem, input: value });
			return z.NEVER;
		}
		const slash = value.indexOf("/");
		return { provider: value.slice(0, slash), model: value.slice(slash + 1) };
	});

/**
 * A model reference as written in settings or flags: either a `ModelRef` object or the string
 * `"provider/model"`, split at the first `/`. Parsing always yields a `ModelRef`.
 */
export const ModelRefInput = z.union([ModelRef, ModelRefString], {
	error: (issue) =>
		typeof issue.input === "string"
			? modelRefStringProblem(issue.input)
			: undefined,
});
/** A model reference as written: a `ModelRef` object or a `"provider/model"` string. It parses to a `ModelRef`. */
export type ModelRefInput = z.input<typeof ModelRefInput>;

/** Turns a `ModelRef` back into its `"provider/model"` string. */
export function formatModelRef(ref: ModelRef): string {
	return `${ref.provider}/${ref.model}`;
}
