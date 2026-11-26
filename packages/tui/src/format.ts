const oneDecimal = (value: number): string =>
	(Math.round(value * 10) / 10).toFixed(1);

/** Tokens in 1000 steps: `812`, `12.4k`, `1.2M`. */
export function formatTokens(count: number): string {
	if (count < 1_000) return String(count);
	if (count < 999_950) return `${oneDecimal(count / 1_000)}k`;
	return `${oneDecimal(count / 1_000_000)}M`;
}

/** Bytes in 1024 steps: `512 B` (whole), `2.1 KB`, `1.4 MB` (one decimal). */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024 - 52) return `${oneDecimal(bytes / 1024)} KB`;
	return `${oneDecimal(bytes / (1024 * 1024))} MB`;
}

/** A duration: `0.2s` under 10 s (one decimal), `14s` under a minute, `1m 05s` after. */
export function formatDuration(ms: number): string {
	const safe = Math.max(0, ms);
	if (safe < 9_950) return `${oneDecimal(safe / 1000)}s`;
	const seconds = Math.round(safe / 1000);
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** Micro dollars as dollars: 2 decimals from $0.01 (10,000 microUsd), else 4 decimals. */
export function formatMicroUsd(microUsd: number): string {
	const usd = microUsd / 1_000_000;
	return `$${usd.toFixed(microUsd >= 10_000 ? 2 : 4)}`;
}

/** The cost figure the footer and COST panel show: `—` before any priced call, plus `+n unpriced`. */
export function formatCost(
	cost: {
		readonly knownMicroUsd: number;
		readonly pricedCalls: number;
		readonly unknownCalls: number;
	},
	dash: string,
): string {
	const figure =
		cost.pricedCalls === 0 ? dash : formatMicroUsd(cost.knownMicroUsd);
	return cost.unknownCalls > 0
		? `${figure} +${cost.unknownCalls} unpriced`
		: figure;
}
