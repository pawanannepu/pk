/**
 * @pk/env: the process environment every package shares. Data directories, safe file writes,
 * secret redaction, the logger, and the base error class.
 *
 * Runtime neutral: Node APIs only, never `Bun.*` (enforced by scripts/check-boundaries.ts).
 * Settings load and merge lands here with #3 Core data model, which owns the settings shape.
 */
export { isPkError, PkError } from "./errors.ts";
export {
	type AtomicWriteOptions,
	appendJsonl,
	atomicWriteFile,
} from "./files.ts";
export {
	createLogger,
	LOG_FILE,
	type LogFields,
	type Logger,
	type LoggerOptions,
	type LogLevel,
	silentLogger,
} from "./logger.ts";
export { type PathsInput, type PkPaths, paths } from "./paths.ts";
export { REDACTED, type RedactOptions, redact } from "./redact.ts";
