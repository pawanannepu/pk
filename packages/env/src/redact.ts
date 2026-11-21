/**
 * The one secret scrubber. The logger, the session writer, the headless JSON writer and error
 * formatting all pass data through `redact()` before it leaves the process or hits disk.
 *
 * Three layers, applied together:
 * 1. Known secrets: exact values the caller passes in (for example keys loaded from the keychain, #18).
 * 2. Sensitive keys: any object property named like a credential is replaced whole.
 * 3. Token shapes: common provider key and bearer token formats inside any string.
 *
 * It returns a redacted copy and never mutates its input.
 */

export const REDACTED = "[REDACTED]";

const SENSITIVE_KEY =
	/^(?:api[-_]?key|x[-_]api[-_]key|authorization|proxy[-_]authorization|password|passwd|secret|client[-_]?secret|token|access[-_]?token|refresh[-_]?token|id[-_]?token|session[-_]?token|cookie|set[-_]cookie)$/i;

const TOKEN_PATTERNS: readonly RegExp[] = [
	/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, // Authorization: Bearer <token>
	/\bsk-ant-[A-Za-z0-9_-]{8,}/g, // Anthropic
	/\bsk-[A-Za-z0-9_-]{16,}/g, // OpenAI, OpenRouter (sk-or-), DeepSeek and other sk- keys
	/\bgsk_[A-Za-z0-9]{16,}/g, // Groq
	/\bxai-[A-Za-z0-9]{16,}/g, // xAI
	/\bAIza[A-Za-z0-9_-]{30,}/g, // Google API keys
	/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, // GitHub tokens
	/\bgithub_pat_[A-Za-z0-9_]{20,}/g, // GitHub fine grained tokens
	/\bAKIA[0-9A-Z]{16}\b/g, // AWS access key ids
];

/** Known secrets shorter than this are ignored, so a tiny value cannot blank out ordinary text. */
const MIN_KNOWN_SECRET_LENGTH = 8;

export interface RedactOptions {
	/** Exact secret values to remove wherever they appear. */
	readonly secrets?: Iterable<string>;
}

export function redact<T>(value: T, options: RedactOptions = {}): T {
	const secrets = [...(options.secrets ?? [])]
		.filter((s) => s.length >= MIN_KNOWN_SECRET_LENGTH)
		.sort((a, b) => b.length - a.length);
	return walk(value, secrets, new WeakMap()) as T;
}

function redactString(text: string, secrets: readonly string[]): string {
	let out = text;
	for (const secret of secrets) {
		out = out.split(secret).join(REDACTED);
	}
	for (const pattern of TOKEN_PATTERNS) {
		out = out.replace(pattern, REDACTED);
	}
	return out;
}

function walk(
	value: unknown,
	secrets: readonly string[],
	seen: WeakMap<object, unknown>,
): unknown {
	if (typeof value === "string") return redactString(value, secrets);
	if (value === null || typeof value !== "object") return value;

	const cached = seen.get(value);
	if (cached !== undefined) return cached;

	if (value instanceof Error) {
		const copy: Record<string, unknown> = { name: value.name };
		seen.set(value, copy);
		copy.message = redactString(value.message, secrets);
		if (value.stack) copy.stack = redactString(value.stack, secrets);
		if ("code" in value) copy.code = walk(value.code, secrets, seen);
		if (value.cause !== undefined)
			copy.cause = walk(value.cause, secrets, seen);
		return copy;
	}

	if (Array.isArray(value)) {
		const copy: unknown[] = [];
		seen.set(value, copy);
		for (const item of value) copy.push(walk(item, secrets, seen));
		return copy;
	}

	if (value instanceof Date) return new Date(value.getTime());

	const copy: Record<string, unknown> = {};
	seen.set(value, copy);
	for (const [key, item] of Object.entries(value)) {
		copy[key] =
			SENSITIVE_KEY.test(key) && item != null && item !== ""
				? REDACTED
				: walk(item, secrets, seen);
	}
	return copy;
}
