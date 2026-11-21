/**
 * The base class for every error pk throws on purpose.
 *
 * `code` is a stable string (for example `"provider.rate_limited"`) so the loop
 * can tell a rate limit from a bad tool input from a bug without parsing
 * messages. Packages throw subclasses; the loop boundary catches them.
 */
export class PkError extends Error {
	readonly code: string;

	constructor(code: string, message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = new.target.name;
		this.code = code;
	}
}

export function isPkError(value: unknown): value is PkError {
	return value instanceof PkError;
}
