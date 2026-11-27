import type { ApiKeySource, ProviderId } from "@pk/schema";
import { ProviderError } from "./errors.ts";

/** The key sent to a provider with no key source (local servers such as Ollama). Not a secret. */
export const NO_KEY_PLACEHOLDER = "pk-no-key";

/**
 * Resolves a provider's API key at the start of a call, so a changed environment variable takes
 * effect on the next call. `{ env }` gives that variable's value, and throws `provider.missing_key`
 * when it is unset or empty. `{ keychain: true }` throws `provider.keychain_unavailable` until
 * `pk login` (#18). No source gives `NO_KEY_PLACEHOLDER`.
 */
export function resolveApiKey(
	source: ApiKeySource | undefined,
	getEnv: (name: string) => string | undefined,
	providerId: ProviderId,
): string {
	if (source === undefined) return NO_KEY_PLACEHOLDER;
	if ("env" in source) {
		const value = getEnv(source.env);
		if (value === undefined || value === "") {
			throw new ProviderError({
				code: "provider.missing_key",
				message: `${source.env} is not set. Export it, or change providers.${providerId}.apiKey in your user settings.`,
				providerId,
			});
		}
		return value;
	}
	throw new ProviderError({
		code: "provider.keychain_unavailable",
		message: `Keychain keys arrive with pk login. Use { "env": "VAR_NAME" } for providers.${providerId}.apiKey for now.`,
		providerId,
	});
}
