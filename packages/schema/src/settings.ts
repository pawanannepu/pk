import { z } from "zod";
import { jsonSchemaOf } from "./json-schema.ts";
import {
	ApiStyle,
	type JsonObject,
	ModelRefInput,
	ProviderId,
} from "./primitives.ts";

/** The message for an API key written into a settings file. It never contains the value. */
export const API_KEY_IN_FILE_MESSAGE =
	'API keys never go in settings files. Use { "env": "VAR_NAME" } or run pk login.';

/** Where pk reads a provider's API key: an environment variable you name, or the OS keychain (#18). */
export const ApiKeySource = z.union(
	[
		z.strictObject({
			env: z
				.string()
				.regex(
					/^[A-Z_][A-Z0-9_]*$/,
					"env must be an environment variable name like OPENAI_API_KEY",
				),
		}),
		z.strictObject({ keychain: z.literal(true) }),
	],
	{
		error: (issue) =>
			typeof issue.input === "string"
				? API_KEY_IN_FILE_MESSAGE
				: 'apiKey must be { "env": "VAR_NAME" } or { "keychain": true }',
	},
);
/** Where pk reads a provider's API key. */
export type ApiKeySource = z.infer<typeof ApiKeySource>;

/** One provider entry in settings. User only: a project file cannot set it. */
export const ProviderSettings = z.strictObject({
	api: ApiStyle,
	baseURL: z.url({ protocol: /^https?$/ }).optional(),
	apiKey: ApiKeySource.optional(),
});
/** One provider entry in settings. */
export type ProviderSettings = z.infer<typeof ProviderSettings>;

/** The permission mode. User only. */
export const PermissionMode = z.enum([
	"normal",
	"accept_edits",
	"plan",
	"skip_all",
]);
/** The permission mode. */
export type PermissionMode = z.infer<typeof PermissionMode>;

/** A permission rule string. Its grammar belongs to #10; here it is any non empty string. */
const PermissionRules = z.array(z.string().min(1)).readonly();

/**
 * pk's settings, from `settings.json` in the config folder, `.pk/settings.json`,
 * `.pk/settings.local.json` and command flags. Every key is optional. A wrong type is an error; an
 * unknown key is a warning (see `parseSettingsLayer`). There is no place for a literal API key.
 */
export const Settings = z
	.strictObject({
		$schema: z.string().optional(),
		model: z
			.strictObject({
				main: ModelRefInput.optional(),
				summarize: ModelRefInput.optional(),
				subagent: ModelRefInput.optional(),
			})
			.optional()
			.meta({
				description:
					'Models by role, each a "provider/model" string or { provider, model }.',
			}),
		providers: z.record(ProviderId, ProviderSettings).optional().meta({
			description:
				"Provider endpoints and key sources. Only read from your user settings file.",
		}),
		permissions: z
			.strictObject({
				mode: PermissionMode.optional(),
				allow: PermissionRules.optional(),
				deny: PermissionRules.optional(),
				ask: PermissionRules.optional(),
			})
			.optional()
			.meta({
				description:
					"Permission mode and rules. mode and allow are only read from your user settings file; deny and ask apply from any file.",
			}),
		limits: z
			.strictObject({ maxTurns: z.number().int().positive().optional() })
			.optional(),
		ui: z
			.strictObject({
				background: z.enum(["pk", "terminal"]).optional().meta({
					description:
						'"pk" paints pk\'s near black canvas (the default); "terminal" keeps your terminal\'s own background.',
				}),
				ascii: z.boolean().optional().meta({
					description:
						"Draw with plain ASCII glyphs instead of Unicode. Default false; also on when the locale is not UTF-8.",
				}),
			})
			.optional()
			.meta({
				description:
					"How the full screen UI draws. Only read from your user settings file.",
			}),
	})
	.readonly();
/** pk's settings after parsing: every model reference is a `ModelRef`. */
export type Settings = z.infer<typeof Settings>;
/** pk's settings as written in a file or flags. */
export type SettingsInput = z.input<typeof Settings>;

/** The settings paths a project file cannot set, because they could widen trust. Dropped with a warning. */
export const USER_ONLY_SETTINGS: readonly string[] = [
	"providers",
	"permissions.mode",
	"permissions.allow",
	"ui",
];

/** Deprecated settings paths mapped to their replacement. Empty today. */
export const SETTINGS_RENAMES: Readonly<Record<string, string>> = {};

/** The JSON Schema published as `schemas/settings.schema.json`. */
export function settingsJsonSchema(): JsonObject {
	return jsonSchemaOf(Settings);
}

// ---- Pure helpers on raw (not yet validated) settings ----

type RawObject = Readonly<Record<string, unknown>>;

function isRawObject(value: unknown): value is RawObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getAt(raw: unknown, path: readonly string[]): unknown {
	return path.reduce<unknown>(
		(node, key) => (isRawObject(node) ? node[key] : undefined),
		raw,
	);
}

function hasAt(raw: unknown, path: readonly string[]): boolean {
	const parent = getAt(raw, path.slice(0, -1));
	const key = path.at(-1);
	return key !== undefined && isRawObject(parent) && Object.hasOwn(parent, key);
}

/** A copy of `raw` without the key at `path`. Unchanged when the path is absent. */
function withoutAt(raw: unknown, path: readonly string[]): unknown {
	const [key, ...rest] = path;
	if (key === undefined || !isRawObject(raw) || !Object.hasOwn(raw, key))
		return raw;
	if (rest.length === 0) {
		const { [key]: _removed, ...kept } = raw;
		return kept;
	}
	return { ...raw, [key]: withoutAt(raw[key], rest) };
}

/** A copy of `raw` with `value` at `path`, creating objects on the way. */
function withAt(
	raw: unknown,
	path: readonly string[],
	value: unknown,
): unknown {
	const [key, ...rest] = path;
	if (key === undefined) return value;
	const node = isRawObject(raw) ? raw : {};
	return { ...node, [key]: withAt(node[key], rest, value) };
}

/** A key a per layer helper removed or moved, by dotted path. */
export interface SettingsKeyChange {
	readonly path: string;
	readonly message: string;
}

/**
 * Applies deprecated key renames to one raw layer. When both keys are present the new key wins and the
 * old one is dropped; either way a change is reported.
 */
export function applySettingsRenames(
	raw: unknown,
	renames: Readonly<Record<string, string>> = SETTINGS_RENAMES,
): { raw: unknown; changes: readonly SettingsKeyChange[] } {
	return Object.entries(renames).reduce<{
		raw: unknown;
		changes: readonly SettingsKeyChange[];
	}>(
		(acc, [from, to]) => {
			const fromPath = from.split(".");
			if (!hasAt(acc.raw, fromPath)) return acc;
			const toPath = to.split(".");
			const both = hasAt(acc.raw, toPath);
			const moved = both
				? withoutAt(acc.raw, fromPath)
				: withAt(
						withoutAt(acc.raw, fromPath),
						toPath,
						getAt(acc.raw, fromPath),
					);
			return {
				raw: moved,
				changes: [
					...acc.changes,
					{
						path: from,
						message: both
							? `"${from}" is deprecated and was ignored, because "${to}" is also set`
							: `"${from}" is deprecated; use "${to}"`,
					},
				],
			};
		},
		{ raw, changes: [] },
	);
}

/**
 * Drops every `USER_ONLY_SETTINGS` path from one raw project layer, before validation, so a hostile
 * value is removed and never reported back.
 */
export function dropUserOnlySettings(raw: unknown): {
	raw: unknown;
	dropped: readonly SettingsKeyChange[];
} {
	return USER_ONLY_SETTINGS.reduce<{
		raw: unknown;
		dropped: readonly SettingsKeyChange[];
	}>(
		(acc, path) => {
			const parts = path.split(".");
			if (!hasAt(acc.raw, parts)) return acc;
			return {
				raw: withoutAt(acc.raw, parts),
				dropped: [
					...acc.dropped,
					{
						path,
						message: `"${path}" is only read from your user settings file, so it was ignored here`,
					},
				],
			};
		},
		{ raw, dropped: [] },
	);
}

/** One validation problem in a settings layer, by dotted key path (`""` for the top level). */
export interface SettingsIssue {
	readonly path: string;
	readonly message: string;
}

/** The result of `parseSettingsLayer`. */
export type SettingsLayerResult =
	| {
			readonly success: true;
			readonly settings: Settings;
			/** Unknown keys, stripped before the value was accepted. */
			readonly unknownKeys: readonly SettingsKeyChange[];
	  }
	| { readonly success: false; readonly issues: readonly SettingsIssue[] };

const dotted = (path: readonly PropertyKey[]): string =>
	path.map(String).join(".");

/**
 * Validates one settings layer. Unknown keys are not errors: they are stripped and reported, then the
 * layer is parsed again. Every other problem is returned, all of them, never only the first. Never throws.
 */
export function parseSettingsLayer(raw: unknown): SettingsLayerResult {
	let current = raw;
	let unknownKeys: SettingsKeyChange[] = [];
	// Strict objects report all unknown keys in one pass; the bound only guards against a surprise.
	for (let pass = 0; pass < 8; pass++) {
		const result = Settings.safeParse(current);
		if (result.success)
			return { success: true, settings: result.data, unknownKeys };

		const unknown = result.error.issues.filter(
			(issue) => issue.code === "unrecognized_keys",
		);
		const other = result.error.issues.filter(
			(issue) => issue.code !== "unrecognized_keys",
		);
		if (unknown.length === 0 || other.length > 0) {
			return {
				success: false,
				issues: other.map((issue) => ({
					path: dotted(issue.path),
					message: issue.message,
				})),
			};
		}
		for (const issue of unknown) {
			for (const key of issue.keys) {
				const path = [...issue.path.map(String), key];
				current = withoutAt(current, path);
				unknownKeys = [
					...unknownKeys,
					{ path: path.join("."), message: `unknown key "${path.join(".")}"` },
				];
			}
		}
	}
	return {
		success: false,
		issues: [{ path: "", message: "settings could not be validated" }],
	};
}
