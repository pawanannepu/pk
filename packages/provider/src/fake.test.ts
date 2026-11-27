import { describe, expect, test } from "bun:test";
import { checkStreamOrder, type FakeScript } from "@pk/schema";
import { ProviderError } from "./errors.ts";
import { createFakeProvider, parseFakeScript } from "./fake.ts";
import {
	callId,
	collect,
	REQUEST,
	recordingSleep,
	settle,
} from "./test-support.ts";

const a = callId(1);
const TOOL_STEP = {
	events: [
		{ type: "text_delta", text: "Reading." },
		{ type: "tool_call_start", callId: a, name: "read_file" },
		{ type: "tool_call_delta", callId: a, argsText: '{"path":"a"}' },
		{ type: "tool_call_end", callId: a, input: { path: "a" } },
		{ type: "stop", reason: "tool_use" },
	],
} as const;

const script = (steps: unknown[]): FakeScript =>
	parseFakeScript({ v: 1, steps });

describe("createFakeProvider (AC-10)", () => {
	test("plays one step per call, then fake_exhausted", async () => {
		const { sleep } = recordingSleep();
		const fake = createFakeProvider({
			script: script([
				TOOL_STEP,
				{ events: [{ type: "stop", reason: "end_turn" }] },
			]),
			sleep,
		});
		const first = await collect(
			fake.stream(REQUEST, { signal: new AbortController().signal }),
		);
		expect(first.map((e) => e.type)).toEqual([
			"text_delta",
			"tool_call_start",
			"tool_call_delta",
			"tool_call_end",
			"stop",
		]);
		expect(checkStreamOrder(first)).toEqual([]);
		await collect(
			fake.stream(REQUEST, { signal: new AbortController().signal }),
		);
		const third = await settle(
			fake.stream(REQUEST, { signal: new AbortController().signal }),
		);
		expect(third.error).toBeInstanceOf(ProviderError);
		expect((third.error as ProviderError).code).toBe("provider.fake_exhausted");
		expect((third.error as ProviderError).retryable).toBe(false);
		expect((third.error as ProviderError).message).toBe(
			"The fake script has 2 steps and all were used.",
		);
	});

	test("claims the step when stream() is called, not when reading starts", async () => {
		const { sleep } = recordingSleep();
		const fake = createFakeProvider({
			script: script([
				{
					events: [
						{ type: "text_delta", text: "one" },
						{ type: "stop", reason: "end_turn" },
					],
				},
				{
					events: [
						{ type: "text_delta", text: "two" },
						{ type: "stop", reason: "end_turn" },
					],
				},
			]),
			sleep,
		});
		const signal = new AbortController().signal;
		const s1 = fake.stream(REQUEST, { signal });
		const s2 = fake.stream({ ...REQUEST, system: "second" }, { signal });
		const second = await collect(s2);
		const first = await collect(s1);
		expect(first[0]).toEqual({ type: "text_delta", text: "one" });
		expect(second[0]).toEqual({ type: "text_delta", text: "two" });
		const requests = fake.requests();
		expect(requests.map((r) => r.system)).toEqual(["be brief", "second"]);
		requests.pop();
		expect(fake.requests()).toHaveLength(2);
	});

	test("requests() are copies: changing the caller's request later does not change the record (AC-10)", async () => {
		const fake = createFakeProvider({
			script: script([TOOL_STEP]),
			sleep: recordingSleep().sleep,
		});
		const mine = structuredClone(REQUEST) as { system: string };
		await collect(
			fake.stream(mine as typeof REQUEST, {
				signal: new AbortController().signal,
			}),
		);
		mine.system = "changed after the call";
		expect(fake.requests()[0]?.system).toBe(REQUEST.system);
	});

	test("an error step throws before any event, with defaults from the code", async () => {
		const { sleep } = recordingSleep();
		const fake = createFakeProvider({
			script: script([
				{
					error: {
						code: "provider.rate_limited",
						retryAfterMs: 2000,
						status: 429,
					},
				},
			]),
			sleep,
			id: "groq",
		});
		const out = await settle(
			fake.stream(REQUEST, { signal: new AbortController().signal }),
		);
		expect(out.events).toEqual([]);
		const error = out.error as ProviderError;
		expect([
			error.code,
			error.retryable,
			error.message,
			error.providerId,
		]).toEqual([
			"provider.rate_limited",
			true,
			"Scripted provider.rate_limited.",
			"groq",
		]);
		expect([error.status, error.retryAfterMs]).toEqual([429, 2000]);
	});

	test("thenError throws after the events", async () => {
		const { sleep } = recordingSleep();
		const fake = createFakeProvider({
			script: script([
				{
					events: [{ type: "text_delta", text: "hi" }],
					thenError: {
						code: "provider.server",
						retryable: false,
						message: "boom",
					},
				},
			]),
			sleep,
		});
		const out = await settle(
			fake.stream(REQUEST, { signal: new AbortController().signal }),
		);
		expect(out.events).toEqual([{ type: "text_delta", text: "hi" }]);
		expect((out.error as ProviderError).message).toBe("boom");
		expect((out.error as ProviderError).retryable).toBe(false);
	});

	test("honors an abort before the first event and during a delay wait (AC-5)", async () => {
		const before = new AbortController();
		before.abort();
		const fake1 = createFakeProvider({
			script: script([TOOL_STEP]),
			sleep: recordingSleep().sleep,
		});
		expect(
			await collect(fake1.stream(REQUEST, { signal: before.signal })),
		).toEqual([{ type: "stop", reason: "aborted" }]);

		const during = new AbortController();
		let calls = 0;
		const { sleep, waits } = recordingSleep(() => {
			calls += 1;
			if (calls === 3) during.abort();
		});
		const fake2 = createFakeProvider({
			script: script([{ ...TOOL_STEP, eventDelayMs: 10 }]),
			sleep,
		});
		const events = await collect(
			fake2.stream(REQUEST, { signal: during.signal }),
		);
		expect(waits).toEqual([10, 10, 10]);
		expect(events.map((e) => e.type)).toEqual([
			"text_delta",
			"tool_call_start",
			"stop",
		]);
		expect(events.at(-1)).toEqual({ type: "stop", reason: "aborted" });
		expect(checkStreamOrder(events)).toEqual([]);
	});
});

describe("parseFakeScript (AC-10)", () => {
	const codeOf = (raw: unknown): string => {
		try {
			parseFakeScript(raw);
			return "parsed";
		} catch (error) {
			return error instanceof ProviderError ? error.message : String(error);
		}
	};

	test("a schema failure names the step and event", () => {
		expect(
			codeOf({
				v: 1,
				steps: [
					TOOL_STEP,
					{ events: [{ type: "tool_call_start", callId: "bad", name: "x" }] },
				],
			}),
		).toStartWith("Fake script step 2, event 0:");
		expect(codeOf({ v: 1, steps: [] })).toStartWith("Fake script:");
	});

	test("an order failure names the step and event; thenError steps may stay open", () => {
		expect(
			codeOf({
				v: 1,
				steps: [{ events: [{ type: "text_delta", text: "x" }] }],
			}),
		).toBe("Fake script step 1, event 1: the stream has no stop.");
		expect(
			codeOf({
				v: 1,
				steps: [
					{
						events: [{ type: "tool_call_start", callId: a, name: "read_file" }],
						thenError: { code: "provider.server" },
					},
				],
			}),
		).toBe("parsed");
		expect(
			codeOf({
				v: 1,
				steps: [
					{
						events: [{ type: "tool_call_delta", callId: a, argsText: "x" }],
						thenError: { code: "provider.server" },
					},
				],
			}),
		).toStartWith("Fake script step 1, event 0:");
	});
});
