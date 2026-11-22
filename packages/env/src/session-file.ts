import {
	SESSION_MIGRATIONS,
	SESSION_VERSION,
	SessionHeader,
	type SessionMigration,
	SessionRecord,
} from "@pk/schema";
import { PkError } from "./errors.ts";
import { NOT_JSON, parseJson, readJsonlRecords } from "./jsonl.ts";

/**
 * A session file pk cannot read: `session.no_header` (no valid header line), `session.too_new` (written
 * by a newer pk) or `session.unsupported_version` (an older version with no migration).
 */
export class SessionError extends PkError {}

/** What `readSessionFile` returns. `fileVersion` is the header's `v` before any migration. */
export interface SessionFileRead {
	readonly header: SessionHeader;
	readonly records: readonly SessionRecord[];
	readonly skipped: number;
	readonly fileVersion: number;
}

/** Overrides for tests of the migration path. pk itself always uses the defaults. */
export interface SessionVersioning {
	readonly version?: number;
	readonly migrations?: Readonly<Record<number, SessionMigration>>;
}

function rawVersion(raw: unknown): number | undefined {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw))
		return undefined;
	const type: unknown = Reflect.get(raw, "type");
	const v: unknown = Reflect.get(raw, "v");
	return type === "header" && typeof v === "number" && Number.isInteger(v)
		? v
		: undefined;
}

/**
 * Reads a session file's text. The first non blank line must be a header with a whole number `v`. A
 * newer `v` throws `session.too_new`; an older one sends every raw record (header included) through the
 * `SESSION_MIGRATIONS` chain before parsing. Damaged, unknown and repeated header lines are skipped and
 * counted, never fatal.
 */
export function readSessionFile(
	text: string,
	versioning: SessionVersioning = {},
): SessionFileRead {
	const version = versioning.version ?? SESSION_VERSION;
	const migrations = versioning.migrations ?? SESSION_MIGRATIONS;

	const lines = text.split("\n");
	const headerIndex = lines.findIndex((line) => line.trim() !== "");
	const headerRaw =
		headerIndex < 0 ? NOT_JSON : parseJson(lines[headerIndex] ?? "");
	const fileVersion = rawVersion(headerRaw);
	if (fileVersion === undefined) {
		throw new SessionError(
			"session.no_header",
			"this is not a pk session file: its first line is not a session header",
		);
	}
	if (fileVersion > version) {
		throw new SessionError(
			"session.too_new",
			`this session was written by a newer pk (format ${fileVersion}, this pk reads up to ${version}); update pk to open it`,
		);
	}

	// The header at each version on the way up, so each step sees the header of its own version.
	const steps: { migrate: SessionMigration; header: unknown }[] = [];
	let header: unknown = headerRaw;
	for (let v = fileVersion; v < version; v++) {
		const migrate = migrations[v];
		if (migrate === undefined) {
			throw new SessionError(
				"session.unsupported_version",
				`this pk cannot upgrade session format ${v}`,
			);
		}
		steps.push({ migrate, header });
		header = migrate(header, header);
	}
	const upgrade = (raw: unknown): unknown =>
		steps.reduce((acc, step) => step.migrate(acc, step.header), raw);

	const parsedHeader = SessionHeader.safeParse(header);
	if (!parsedHeader.success) {
		throw new SessionError(
			"session.no_header",
			"this session file's header is not valid",
		);
	}

	const rest = lines.slice(headerIndex + 1).join("\n");
	const { records, skipped } = readJsonlRecords(rest, SessionRecord, upgrade);
	return { header: parsedHeader.data, records, skipped, fileVersion };
}
