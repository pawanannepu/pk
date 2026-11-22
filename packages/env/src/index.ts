/**
 * @pk/env: the process environment every package shares. Data directories, safe file writes,
 * JSONL and session file reading, settings load and merge, project detection, IDs, secret
 * redaction, the logger, and the base error class.
 *
 * Runtime neutral: Node APIs only, never `Bun.*` (enforced by scripts/check-boundaries.ts).
 * Shapes come from `@pk/schema` (spec 0002); this package turns failures into `PkError` subclasses.
 */
export { isPkError, PkError } from "./errors.ts";
export {
	type AtomicWriteOptions,
	appendJsonl,
	atomicWriteFile,
	ensurePrivateDir,
	PRIVATE_FILE,
} from "./files.ts";
export { createIdFactory, type IdFactoryDeps } from "./ids.ts";
export { type JsonlRead, readJsonlRecords, type SafeParser } from "./jsonl.ts";
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
export { findProjectRoot, projectKey, sha256Hex } from "./project.ts";
export { REDACTED, type RedactOptions, redact } from "./redact.ts";
export {
	readSessionFile,
	SessionError,
	type SessionFileRead,
	type SessionVersioning,
} from "./session-file.ts";
export {
	type LoadedSettings,
	type LoadSettingsInput,
	loadSettings,
	mergeSettings,
	readSettingsFile,
	SettingsError,
	type SettingsWarning,
} from "./settings.ts";
