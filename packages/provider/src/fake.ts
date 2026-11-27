import {
	checkStreamOrder,
	type FakeError,
	FakeScript,
	type FakeStep,
	type ModelRequest,
	type ProviderId,
	type ProviderStreamEvent,
} from "@pk/schema";
import { ProviderError } from "./errors.ts";
import {
	ABORTED_STOP,
	type Provider,
	type Sleep,
	type StreamOptions,
} from "./types.ts";

/** A provider that plays a script, plus every request it received. */
export interface FakeProvider extends Provider {
	/** A copy of every `ModelRequest` received, in call order. */
	requests(): ModelRequest[];
}

/** What `createFakeProvider` needs. `id` defaults to `fake`. */
export interface FakeProviderOptions {
	readonly script: FakeScript;
	readonly sleep: Sleep;
	readonly id?: ProviderId;
}

function invalid(message: string): ProviderError {
	return new ProviderError({
		code: "provider.fake_script_invalid",
		message,
		providerId: "fake",
	});
}

/**
 * Parses a raw JSON value as a `FakeScript` and checks each event step's order. Throws
 * `provider.fake_script_invalid` naming the step (from 1) and event index (from 0).
 */
export function parseFakeScript(raw: unknown): FakeScript {
	const parsed = FakeScript.safeParse(raw);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		const path = issue?.path ?? [];
		const step =
			path[0] === "steps" && typeof path[1] === "number" ? path[1] : undefined;
		const event =
			path[2] === "events" && typeof path[3] === "number" ? path[3] : undefined;
		const where =
			step === undefined
				? "Fake script"
				: `Fake script step ${step + 1}${event === undefined ? "" : `, event ${event}`}`;
		throw invalid(`${where}: ${issue?.message ?? "invalid"}.`);
	}
	checkScriptOrder(parsed.data);
	return parsed.data;
}

function checkScriptOrder(script: FakeScript): void {
	for (const [index, step] of script.steps.entries()) {
		if (!("events" in step)) continue;
		const issues = checkStreamOrder(step.events).filter(
			(issue) =>
				step.thenError === undefined ||
				(issue.code !== "no_stop" && issue.code !== "unfinished_call"),
		);
		const first = issues[0];
		if (first !== undefined) {
			throw invalid(
				`Fake script step ${index + 1}, event ${first.eventIndex}: ${first.message}.`,
			);
		}
	}
}

/**
 * A provider that plays a `FakeScript`, one step per `stream()` call. The step is claimed when
 * `stream()` is called, so concurrent calls take steps in call order. Honors an abort before and
 * between events, including during an `eventDelayMs` wait. Used by every offline test and by
 * `PK_FAKE_SCRIPT`.
 */
export function createFakeProvider(options: FakeProviderOptions): FakeProvider {
	checkScriptOrder(options.script);
	const id = options.id ?? "fake";
	const steps = options.script.steps;
	// The call counter and request log are this fake's own state, like a recording test double.
	let next = 0;
	const received: ModelRequest[] = [];

	const toError = (error: FakeError): ProviderError =>
		new ProviderError({
			code: error.code,
			message: error.message ?? `Scripted ${error.code}.`,
			providerId: id,
			...(error.retryable === undefined ? {} : { retryable: error.retryable }),
			...(error.status === undefined ? {} : { status: error.status }),
			...(error.retryAfterMs === undefined
				? {}
				: { retryAfterMs: error.retryAfterMs }),
		});

	async function* play(
		step: FakeStep | undefined,
		{ signal }: StreamOptions,
	): AsyncGenerator<ProviderStreamEvent> {
		if (signal.aborted) {
			yield ABORTED_STOP;
			return;
		}
		if (step === undefined) {
			throw new ProviderError({
				code: "provider.fake_exhausted",
				message: `The fake script has ${steps.length} steps and all were used.`,
				providerId: id,
			});
		}
		if ("error" in step) throw toError(step.error);
		const delay = step.eventDelayMs ?? 0;
		for (const event of step.events) {
			if (delay > 0) await options.sleep(delay, signal);
			if (signal.aborted) {
				yield ABORTED_STOP;
				return;
			}
			yield event;
		}
		if (step.thenError !== undefined) throw toError(step.thenError);
	}

	return {
		id,
		api: "openai_chat",
		stream(request, streamOptions) {
			received.push(structuredClone(request));
			const step = steps[next];
			next += 1;
			return play(step, streamOptions);
		},
		requests: () => structuredClone(received),
	};
}
