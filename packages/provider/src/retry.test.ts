import { describe, expect, test } from "bun:test";
import type { LogFields, Logger } from "@pk/env";
import { checkStreamOrder } from "@pk/schema";
import { ProviderError } from "./errors.ts";
import { createFakeProvider, parseFakeScript } from "./fake.ts";
import { retryDelay, retryNoticeText, withRetry } from "./retry.ts";
import { REQUEST, recordingSleep, settle } from "./test-support.ts";
import { DEFAULT_RETRY_POLICY, type RetryInfo } from "./types.ts";

const OK = {
	events: [
		{ type: "text_delta", text: "hi" },
		{ type: "stop", reason: "end_turn" },
	],
};
const err = (code: string, extra: Record<string, unknown> = {}): unknown => ({
	error: { code, ...extra },
});

function recordingLogger(): {
	logger: Logger;
	lines: [string, string, LogFields][];
} {
	const lines: [string, string, LogFields][] = [];
	const at =
		(level: string) =>
		(msg: string, fields: LogFields = {}) => {
			lines.push([level, msg, fields]);
		};
	const logger: Logger = {
		debug: at("debug"),
		info: at("info"),
		warn: at("warn"),
		error: at("error"),
		child: () => logger,
	};
	return { logger, lines };
}

function setup(steps: unknown[], during?: (ms: number) => void) {
	const { sleep, waits } = recordingSleep(during);
	const fake = createFakeProvider({
		script: parseFakeScript({ v: 1, steps }),
		sleep,
		id: "groq",
	});
	const { logger, lines } = recordingLogger();
	let clock = 1_000_000;
	const provider = withRetry(fake, {
		sleep,
		random: () => 0.5,
		now: () => clock++,
		logger,
	});
	return { provider, fake, waits, lines };
}

describe("withRetry (AC-7)", () => {
	test("a requested wait is honored, onRetry hears it, then the events come", async () => {
		const { provider, waits } = setup([
			err("provider.rate_limited", { retryAfterMs: 2000 }),
			OK,
		]);
		const notices: RetryInfo[] = [];
		const out = await settle(
			provider.stream(REQUEST, {
				signal: new AbortController().signal,
				onRetry: (info) => notices.push(info),
			}),
		);
		expect(out.error).toBeUndefined();
		expect(waits).toEqual([2000]);
		expect(notices.map((n) => [n.retry, n.maxRetries, n.delayMs])).toEqual([
			[1, 4, 2000],
		]);
		expect(checkStreamOrder(out.events)).toEqual([]);
		expect(retryNoticeText(notices[0] as RetryInfo)).toBe(
			"Rate limited by groq, retrying in 2s (1 of 4)",
		);
	});

	test("four 503s and a success is four retries; five 503s gives up", async () => {
		const ok = setup(
			[...Array(4)]
				.map(() => err("provider.overloaded", { status: 503 }))
				.concat([OK]),
		);
		const passed = await settle(
			ok.provider.stream(REQUEST, { signal: new AbortController().signal }),
		);
		expect(passed.error).toBeUndefined();
		expect(ok.waits).toHaveLength(4);

		const bad = setup(
			[...Array(5)].map(() =>
				err("provider.overloaded", {
					status: 503,
					message: "groq is overloaded (503). Try again shortly.",
				}),
			),
		);
		const failed = await settle(
			bad.provider.stream(REQUEST, { signal: new AbortController().signal }),
		);
		const error = failed.error as ProviderError;
		expect(error.message).toBe(
			"groq is overloaded (503). Try again shortly. (gave up after 5 attempts)",
		);
		expect([error.code, error.status]).toEqual(["provider.overloaded", 503]);
		expect(bad.fake.requests()).toHaveLength(5);
	});

	test("a requested wait over 60s stops at once; exactly 60s is waited", async () => {
		const long = setup([
			err("provider.rate_limited", {
				retryAfterMs: 120_000,
				message: "Rate limited.",
			}),
			OK,
		]);
		const out = await settle(
			long.provider.stream(REQUEST, { signal: new AbortController().signal }),
		);
		expect(long.waits).toEqual([]);
		expect((out.error as ProviderError).message).toBe(
			"Rate limited. Retry after 120s.",
		);
		expect((out.error as ProviderError).message).not.toContain("gave up");

		const edge = setup([
			err("provider.rate_limited", { retryAfterMs: 60_000 }),
			OK,
		]);
		await settle(
			edge.provider.stream(REQUEST, { signal: new AbortController().signal }),
		);
		expect(edge.waits).toEqual([60_000]);
	});

	test("a non retryable error is thrown unchanged, without the gave up suffix", async () => {
		const { provider, waits } = setup([
			err("provider.auth", { message: "nope" }),
			OK,
		]);
		const out = await settle(
			provider.stream(REQUEST, { signal: new AbortController().signal }),
		);
		expect((out.error as ProviderError).message).toBe("nope");
		expect(waits).toEqual([]);
	});

	test("no retry after the first event: the error is rethrown and the step is not replayed", async () => {
		const { provider, fake } = setup([
			{
				events: [{ type: "text_delta", text: "partial" }],
				thenError: { code: "provider.server" },
			},
			OK,
		]);
		const out = await settle(
			provider.stream(REQUEST, { signal: new AbortController().signal }),
		);
		expect(out.events).toEqual([{ type: "text_delta", text: "partial" }]);
		expect((out.error as ProviderError).code).toBe("provider.server");
		expect((out.error as ProviderError).message).toBe(
			"Scripted provider.server.",
		);
		expect(fake.requests()).toHaveLength(1);
	});

	test("an abort during a wait yields stop aborted; a throwing onRetry is ignored", async () => {
		const controller = new AbortController();
		const { provider, fake } = setup([err("provider.server"), OK], () =>
			controller.abort(),
		);
		const out = await settle(
			provider.stream(REQUEST, {
				signal: controller.signal,
				onRetry: () => {
					throw new Error("notice broke");
				},
			}),
		);
		expect(out.error).toBeUndefined();
		expect(out.events).toEqual([{ type: "stop", reason: "aborted" }]);
		expect(fake.requests()).toHaveLength(1);
	});

	test("an inner stop aborted passes straight through and is never retried (AC-7)", async () => {
		const { provider, fake, waits } = setup([
			{ events: [{ type: "stop", reason: "aborted" }] },
			OK,
		]);
		const out = await settle(
			provider.stream(REQUEST, { signal: new AbortController().signal }),
		);
		expect(out.error).toBeUndefined();
		expect(out.events).toEqual([{ type: "stop", reason: "aborted" }]);
		expect(waits).toEqual([]);
		expect(fake.requests()).toHaveLength(1);
	});

	test("an already aborted signal stops first and makes no call (AC-5)", async () => {
		const { provider, fake } = setup([OK]);
		const controller = new AbortController();
		controller.abort();
		const out = await settle(
			provider.stream(REQUEST, { signal: controller.signal }),
		);
		expect(out.events).toEqual([{ type: "stop", reason: "aborted" }]);
		expect(checkStreamOrder(out.events)).toEqual([]);
		expect(fake.requests()).toHaveLength(0);
	});

	test("logs metadata only: debug per attempt, warn per retry, error on final failure (AC-12)", async () => {
		const { provider, lines } = setup([
			err("provider.overloaded", { status: 503 }),
			err("provider.auth", { status: 401 }),
		]);
		await settle(
			provider.stream(
				{ ...REQUEST, system: "SECRET PROMPT" },
				{ signal: new AbortController().signal },
			),
		);
		expect(lines.map(([level, msg]) => `${level} ${msg}`)).toEqual([
			"debug provider attempt",
			"warn provider retry",
			"debug provider attempt",
			"error provider call failed",
		]);
		expect(Object.keys(lines[0]?.[2] ?? {}).sort()).toEqual(
			["attempt", "firstEventMs", "model", "provider", "totalMs"].sort(),
		);
		expect(lines[1]?.[2]).toEqual({
			provider: "groq",
			code: "provider.overloaded",
			status: 503,
			retry: 1,
			delayMs: 500,
		});
		expect(lines[3]?.[2]).toEqual({
			provider: "groq",
			code: "provider.auth",
			status: 401,
		});
		expect(JSON.stringify(lines)).not.toContain("SECRET PROMPT");
	});
});

describe("retryDelay (AC-7)", () => {
	const error = (
		fields: Partial<{ retryAfterMs: number; retryAfterDate: string }>,
	) =>
		new ProviderError({
			code: "provider.rate_limited",
			message: "x",
			providerId: "groq",
			...fields,
		});
	const now = () => Date.parse("2026-11-27T10:00:00Z");

	test("full jitter doubles to a 30s cap with a 250ms floor", () => {
		const delays = [1, 2, 3, 4, 5, 6].map((n) =>
			retryDelay(error({}), n, DEFAULT_RETRY_POLICY, () => 1, now),
		);
		expect(delays.map((d) => (d.kind === "wait" ? d.delayMs : -1))).toEqual([
			1000, 2000, 4000, 8000, 16000, 30000,
		]);
		expect(
			retryDelay(error({}), 1, DEFAULT_RETRY_POLICY, () => 0, now),
		).toEqual({ kind: "wait", delayMs: 250 });
	});

	test("an HTTP date resolves against now; unparseable counts as absent; negative is 0", () => {
		expect(
			retryDelay(
				error({ retryAfterDate: "Fri, 27 Nov 2026 10:00:05 GMT" }),
				1,
				DEFAULT_RETRY_POLICY,
				() => 0,
				now,
			),
		).toEqual({ kind: "wait", delayMs: 5000 });
		expect(
			retryDelay(
				error({ retryAfterDate: "Fri, 27 Nov 2026 09:00:00 GMT" }),
				1,
				DEFAULT_RETRY_POLICY,
				() => 0,
				now,
			),
		).toEqual({ kind: "wait", delayMs: 0 });
		expect(
			retryDelay(
				error({ retryAfterDate: "soon" }),
				1,
				DEFAULT_RETRY_POLICY,
				() => 0,
				now,
			),
		).toEqual({ kind: "wait", delayMs: 250 });
		expect(
			retryDelay(
				error({ retryAfterMs: 60_001 }),
				1,
				DEFAULT_RETRY_POLICY,
				() => 0,
				now,
			),
		).toEqual({
			kind: "give_up",
			reason: "retry_after_too_long",
			requestedMs: 60_001,
		});
	});

	test("notice text per code", () => {
		const info = (
			code:
				| "provider.server"
				| "provider.timeout"
				| "provider.network"
				| "provider.overloaded",
		) => ({
			retry: 2,
			maxRetries: 4,
			delayMs: 3200,
			error: new ProviderError({ code, message: "x", providerId: "ollama" }),
		});
		expect(retryNoticeText(info("provider.server"))).toBe(
			"ollama had a server error, retrying in 4s (2 of 4)",
		);
		expect(retryNoticeText(info("provider.timeout"))).toBe(
			"ollama timed out, retrying in 4s (2 of 4)",
		);
		expect(retryNoticeText(info("provider.network"))).toBe(
			"Could not reach ollama, retrying in 4s (2 of 4)",
		);
		expect(retryNoticeText(info("provider.overloaded"))).toBe(
			"ollama is overloaded, retrying in 4s (2 of 4)",
		);
	});
});
