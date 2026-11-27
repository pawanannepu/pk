/**
 * A one line `try:` hint per error code, shown under an error block. Features that add codes extend
 * it. A code with no entry shows no hint line.
 */
export const ERROR_HINTS: Readonly<Record<string, string>> = {
	"provider.rate_limited": "wait a minute, or switch model",
	"provider.auth": "check your API key (pk login arrives in #18)",
	"provider.missing_key": "set the env var named above, then restart pk",
	"provider.unreachable": "check your network or the provider's base URL",
	"tui.session_failed": "restart pk; the log has details",
};
