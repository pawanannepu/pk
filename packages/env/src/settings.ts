import { readFile as fsReadFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	applySettingsRenames,
	dropUserOnlySettings,
	parseSettingsLayer,
	Settings,
	type SettingsIssue,
} from "@pk/schema";
import { PkError } from "./errors.ts";
import { NOT_JSON, parseJson } from "./jsonl.ts";

/**
 * Settings pk cannot use: `settings.invalid` (bad JSON or a wrong type, with every issue) or
 * `settings.unreadable` (the file exists but could not be read). `file` is an absolute path or `flags`.
 */
export class SettingsError extends PkError {
	readonly file: string;
	readonly issues: readonly SettingsIssue[];

	constructor(
		code: "settings.invalid" | "settings.unreadable",
		file: string,
		issues: readonly SettingsIssue[],
		options?: { cause?: unknown; hint?: string },
	) {
		const lines = issues.map(
			(issue) =>
				`  - ${issue.path === "" ? "(top level)" : issue.path}: ${issue.message}`,
		);
		const head =
			code === "settings.invalid"
				? `Invalid settings in ${file}:`
				: `Could not read settings file ${file}:`;
		const hint = options?.hint === undefined ? [] : [options.hint];
		super(code, [head, ...lines, ...hint].join("\n"), {
			cause: options?.cause,
		});
		this.file = file;
		this.issues = issues;
	}
}

/** A settings problem that is not fatal. `file` is an absolute path or `flags`; `path` is a dotted key path. */
export interface SettingsWarning {
	readonly file: string;
	readonly path: string;
	readonly code:
		| "unknown_key"
		| "user_only_key"
		| "deprecated_key"
		| "project_skipped";
	readonly message: string;
}

/** What `loadSettings` needs. Every input is explicit, so tests never touch the real home folder. */
export interface LoadSettingsInput {
	/** `join(paths().config, "settings.json")`. */
	readonly userFile: string;
	/** `findProjectRoot(cwd, home, exists)`. */
	readonly projectRoot: string;
	readonly home: string;
	/** Settings built from command flags by `cli`. Trusted like the user file, validated the same way. */
	readonly flags: unknown;
	/** `--no-project-settings`: skip both project files, with one `project_skipped` warning. */
	readonly skipProject: boolean;
	/** Returns the file's text, or `undefined` when it is missing. Any other failure means unreadable. */
	readonly readFile: (path: string) => Promise<string | undefined>;
}

/** What `loadSettings` returns. `cli` logs the warnings and the TUI shows them as a `notice`. */
export interface LoadedSettings {
	readonly settings: Settings;
	readonly warnings: readonly SettingsWarning[];
}

/** Reads a settings file from disk: `undefined` when it does not exist, `settings.unreadable` for any other failure. */
export async function readSettingsFile(
	path: string,
): Promise<string | undefined> {
	try {
		return await fsReadFile(path, "utf8");
	} catch (error) {
		if (isNotFound(error)) return undefined;
		throw new SettingsError(
			"settings.unreadable",
			path,
			[{ path: "", message: "the file exists but could not be read" }],
			{ cause: error },
		);
	}
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		Reflect.get(error, "code") === "ENOENT"
	);
}

const PROJECT_HINT =
	"A broken project file still stops pk, because skipping it could drop a deny rule. Fix it, or run pk with --no-project-settings to skip both project files.";

interface Layer {
	readonly file: string;
	readonly trusted: boolean;
	readonly raw: unknown;
}

/**
 * Loads settings from the user file, then `.pk/settings.json`, then `.pk/settings.local.json`, then the
 * flags, and merges them (later wins).
 *
 * Both project files are skipped when `skipProject` is set, when the project root is your home folder,
 * or when a project file path is the user file itself. Per layer: parse the JSON, apply renames, drop
 * user only keys from project layers (before validation, so a hostile value is never echoed), then
 * validate. Unknown keys are warnings; anything else throws `settings.invalid` with every issue.
 */
export async function loadSettings(
	input: LoadSettingsInput,
): Promise<LoadedSettings> {
	const userFile = resolve(input.userFile);
	const projectDir = join(input.projectRoot, ".pk");
	const projectFiles = [
		join(projectDir, "settings.json"),
		join(projectDir, "settings.local.json"),
	];
	const warnings: SettingsWarning[] = [];

	const skipAllProject =
		input.skipProject || resolve(input.projectRoot) === resolve(input.home);
	if (input.skipProject) {
		warnings.push({
			file: projectFiles[0] ?? projectDir,
			path: "",
			code: "project_skipped",
			message:
				"Skipped .pk/settings.json and .pk/settings.local.json (--no-project-settings).",
		});
	}
	const projectToRead = skipAllProject
		? []
		: projectFiles.filter((file) => resolve(file) !== userFile);

	const fileLayers: Layer[] = [];
	for (const [file, trusted] of [
		[userFile, true],
		...projectToRead.map((f) => [f, false] as const),
	] as const) {
		const text = await readOrUnreadable(input.readFile, file);
		if (text === undefined) continue;
		fileLayers.push({ file, trusted, raw: parseFileJson(text, file, trusted) });
	}
	const layers: readonly Layer[] = [
		...fileLayers,
		{ file: "flags", trusted: true, raw: input.flags ?? {} },
	];

	const parsed = layers.map((layer) => {
		const renamed = applySettingsRenames(layer.raw);
		warnings.push(
			...renamed.changes.map((c) => ({
				file: layer.file,
				...c,
				code: "deprecated_key" as const,
			})),
		);
		const filtered = layer.trusted
			? { raw: renamed.raw, dropped: [] }
			: dropUserOnlySettings(renamed.raw);
		warnings.push(
			...filtered.dropped.map((c) => ({
				file: layer.file,
				...c,
				code: "user_only_key" as const,
			})),
		);
		const result = parseSettingsLayer(filtered.raw);
		if (!result.success) {
			throw new SettingsError("settings.invalid", layer.file, result.issues, {
				...(layer.trusted ? {} : { hint: PROJECT_HINT }),
			});
		}
		warnings.push(
			...result.unknownKeys.map((c) => ({
				file: layer.file,
				...c,
				code: "unknown_key" as const,
			})),
		);
		return result.settings;
	});

	return { settings: mergeSettings(parsed), warnings };
}

async function readOrUnreadable(
	readFile: (path: string) => Promise<string | undefined>,
	file: string,
): Promise<string | undefined> {
	try {
		return await readFile(file);
	} catch (error) {
		if (error instanceof SettingsError) throw error;
		throw new SettingsError(
			"settings.unreadable",
			file,
			[{ path: "", message: "the file exists but could not be read" }],
			{ cause: error },
		);
	}
}

/** JSON text to a raw object. Empty text and JSON that is not an object are invalid. The parser's own message is not kept, since it can quote file content. */
function parseFileJson(text: string, file: string, trusted: boolean): unknown {
	const hint = trusted ? {} : { hint: PROJECT_HINT };
	if (text.trim() === "") {
		throw new SettingsError(
			"settings.invalid",
			file,
			[{ path: "", message: "the file is empty; write {} for no settings" }],
			hint,
		);
	}
	const raw = parseJson(text);
	if (raw === NOT_JSON) {
		throw new SettingsError(
			"settings.invalid",
			file,
			[{ path: "", message: "the file is not valid JSON" }],
			hint,
		);
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new SettingsError(
			"settings.invalid",
			file,
			[{ path: "", message: "settings must be a JSON object" }],
			hint,
		);
	}
	return raw;
}

/** Settings paths whose arrays concatenate across layers (duplicates removed) instead of being replaced. */
const CONCAT_PATHS = new Set([
	"permissions.allow",
	"permissions.deny",
	"permissions.ask",
]);

/** Paths whose objects are single values: a higher layer replaces them whole instead of merging into them. */
const LEAF_PATTERNS: readonly RegExp[] = [
	/^model\.[^.]+$/,
	/^providers\.[^.]+\.apiKey$/,
];

function isPlainObject(
	value: unknown,
): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeValues(lower: unknown, higher: unknown, path: string): unknown {
	if (higher === undefined) return lower;
	if (lower === undefined) return higher;
	if (CONCAT_PATHS.has(path) && Array.isArray(lower) && Array.isArray(higher)) {
		return [...new Set([...lower, ...higher])];
	}
	if (
		isPlainObject(lower) &&
		isPlainObject(higher) &&
		!LEAF_PATTERNS.some((p) => p.test(path))
	) {
		const keys = [...new Set([...Object.keys(lower), ...Object.keys(higher)])];
		return Object.fromEntries(
			keys.map((key) => [
				key,
				mergeValues(
					lower[key],
					higher[key],
					path === "" ? key : `${path}.${key}`,
				),
			]),
		);
	}
	return higher;
}

/**
 * Merges already validated layers, lowest first. Objects merge deeply, single values (including each
 * model reference and each `apiKey`) take the higher layer, `permissions.allow`, `deny` and `ask`
 * concatenate in layer order with duplicates removed, and any other array is replaced.
 */
export function mergeSettings(layers: readonly Settings[]): Settings {
	const merged = layers.reduce<unknown>(
		(acc, layer) => mergeValues(acc, layer, ""),
		{},
	);
	const result = Settings.safeParse(merged);
	if (!result.success) {
		// Merging valid layers always gives valid settings; reaching here is a pk bug.
		throw new SettingsError(
			"settings.invalid",
			"merged settings",
			result.error.issues.map((i) => ({
				path: i.path.map(String).join("."),
				message: i.message,
			})),
		);
	}
	return result.data;
}
