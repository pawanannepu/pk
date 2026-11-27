import type { Logger } from "@pk/env";
import {
	createFakeProvider,
	type Provider,
	ProviderError,
	parseFakeScript,
	resolveApiKey,
	type SetTimer,
	type Sleep,
	withRetry,
	withTimeouts,
} from "@pk/provider";
import { createOpenAIProvider, type FetchLike } from "@pk/provider-openai";
import type {
	FakeScript,
	ModelRef,
	NewId,
	ProviderId,
	ProviderSettings,
	Settings,
} from "@pk/schema";

/** The providers pk knows without any settings. A user `providers.<id>` entry replaces one whole. */
export const BUILTIN_PROVIDERS: Readonly<Record<ProviderId, ProviderSettings>> =
	{
		openai: { api: "openai_chat", apiKey: { env: "OPENAI_API_KEY" } },
	};

/** The base URL for an entry that names none. */
export const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** What `createProviderRegistry` needs, all passed in by the composition root. */
export interface RegistryDeps {
	readonly getEnv: (name: string) => string | undefined;
	readonly newId: NewId;
	readonly logger: Logger;
	readonly sleep: Sleep;
	readonly random: () => number;
	/** Epoch milliseconds. */
	readonly now: () => number;
	readonly setTimer: SetTimer;
	/** The user settings file, named in setup error messages. */
	readonly userSettingsPath: string;
	readonly fetch?: FetchLike;
	/** Set when `PK_FAKE_SCRIPT` names a script: every model ref is served by this fake. */
	readonly fakeScript?: FakeScript;
}

/** Turns model refs into ready providers, each wrapped as `withRetry(withTimeouts(adapter))`. */
export interface ProviderRegistry {
	providerFor(ref: ModelRef): Provider;
	mainModel(): ModelRef;
}

/** The end of an auth error's `Check that …`, built from the key source. */
function keyHint(id: ProviderId, entry: ProviderSettings): string {
	const source = entry.apiKey;
	if (source === undefined) {
		return `providers.${id} in your user settings has an apiKey (it has none; add { "env": "VAR_NAME" })`;
	}
	return "env" in source
		? `${source.env} is set and valid`
		: `the key for providers.${id} is valid`;
}

/**
 * Builds the provider registry from merged settings (`providers` is user only, so a project file can
 * never redirect a key). Under `PK_FAKE_SCRIPT` every ref is served by one fake provider wrapped in
 * `withRetry` only, and the main model defaults to `fake/fake`.
 */
export function createProviderRegistry(
	settings: Settings,
	deps: RegistryDeps,
): ProviderRegistry {
	const retry = {
		sleep: deps.sleep,
		random: deps.random,
		now: deps.now,
		logger: deps.logger,
	};
	const fake =
		deps.fakeScript === undefined
			? undefined
			: withRetry(
					createFakeProvider({ script: deps.fakeScript, sleep: deps.sleep }),
					retry,
				);

	const providerFor = (ref: ModelRef): Provider => {
		if (fake !== undefined) return fake;
		const id = ref.provider;
		const entry = settings.providers?.[id] ?? BUILTIN_PROVIDERS[id];
		if (entry === undefined) {
			throw new ProviderError({
				code: "provider.unknown_provider",
				message: `No provider "${id}". Add providers.${id} to ${deps.userSettingsPath}.`,
				providerId: id,
			});
		}
		switch (entry.api) {
			case "anthropic_messages":
				throw new ProviderError({
					code: "provider.unsupported_api",
					message: `Provider "${id}" uses anthropic_messages, which arrives with the Anthropic adapter. Use an openai_chat provider for now.`,
					providerId: id,
				});
			case "openai_chat": {
				const adapter = createOpenAIProvider({
					id,
					baseURL: entry.baseURL ?? DEFAULT_BASE_URL,
					apiKey: () => resolveApiKey(entry.apiKey, deps.getEnv, id),
					keyHint: keyHint(id, entry),
					newId: deps.newId,
					...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
				});
				return withRetry(
					withTimeouts(adapter, { setTimer: deps.setTimer }),
					retry,
				);
			}
			default: {
				const _exhaustive: never = entry.api;
				return _exhaustive;
			}
		}
	};

	const mainModel = (): ModelRef => {
		const main = settings.model?.main;
		if (main !== undefined) return main;
		if (fake !== undefined) return { provider: "fake", model: "fake" };
		throw new ProviderError({
			code: "provider.no_model",
			message: `No model set. Add "model": { "main": "openai/<model>" } to ${deps.userSettingsPath}.`,
			providerId: "pk",
		});
	};

	return { providerFor, mainModel };
}

/**
 * Reads and parses the fake script `PK_FAKE_SCRIPT` names, or `undefined` when it is unset. A file
 * that is missing, not JSON or not a valid script throws `provider.fake_script_invalid`.
 */
export async function loadFakeScript(
	getEnv: (name: string) => string | undefined,
	readFile: (path: string) => Promise<string>,
): Promise<FakeScript | undefined> {
	const path = getEnv("PK_FAKE_SCRIPT");
	if (path === undefined || path === "") return undefined;
	let raw: unknown;
	try {
		raw = JSON.parse(await readFile(path));
	} catch (error) {
		throw new ProviderError({
			code: "provider.fake_script_invalid",
			message: `Could not read the fake script ${path}: ${error instanceof Error ? error.message : String(error)}.`,
			providerId: "fake",
		});
	}
	return parseFakeScript(raw);
}

/** The real `Sleep`, from the timer functions the composition root passes in. Resolves early on abort. */
export function createSleep<H>(
	set: (fire: () => void, ms: number) => H,
	clear: (handle: H) => void,
): Sleep {
	return (ms, signal) =>
		new Promise<void>((resolve) => {
			if (signal.aborted) {
				resolve();
				return;
			}
			const done = (): void => {
				clear(handle);
				signal.removeEventListener("abort", done);
				resolve();
			};
			const handle = set(done, ms);
			signal.addEventListener("abort", done, { once: true });
		});
}

/** The real `SetTimer`, from the same timer functions. */
export function createSetTimer<H>(
	set: (fire: () => void, ms: number) => H,
	clear: (handle: H) => void,
): SetTimer {
	return (ms, fire) => {
		const handle = set(fire, ms);
		return () => clear(handle);
	};
}
