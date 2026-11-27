import { describe, expect, test } from "bun:test";
import { isPkError } from "@pk/env";
import { createChannel } from "./channel.ts";

async function drain<T>(iterable: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const value of iterable) out.push(value);
	return out;
}

describe("the event channel", () => {
	test("values pushed before the reader arrives are kept, in order", async () => {
		const ch = createChannel<number>();
		ch.push(1);
		ch.push(2);
		ch.end();
		expect(await drain(ch.iterable)).toEqual([1, 2]);
	});

	test("a waiting reader wakes on the next push", async () => {
		const ch = createChannel<string>();
		const reader = ch.iterable[Symbol.asyncIterator]();
		const next = reader.next();
		ch.push("a");
		expect(await next).toEqual({ value: "a", done: false });
	});

	test("a falsy value is a value, not an empty buffer", async () => {
		const ch = createChannel<number | undefined>();
		ch.push(0);
		ch.push(undefined);
		ch.end();
		expect(await drain(ch.iterable)).toEqual([0, undefined]);
	});

	test("end lets queued values drain first; pushes after end and a second end are ignored", async () => {
		const ch = createChannel<number>();
		ch.push(1);
		ch.end();
		ch.push(2);
		ch.end();
		expect(await drain(ch.iterable)).toEqual([1]);
	});

	test("end wakes a waiting reader with done", async () => {
		const ch = createChannel<number>();
		const reader = ch.iterable[Symbol.asyncIterator]();
		const next = reader.next();
		ch.end();
		expect((await next).done).toBe(true);
	});

	test("a reader that stops early gets done from then on", async () => {
		const ch = createChannel<number>();
		const reader = ch.iterable[Symbol.asyncIterator]();
		await reader.return?.();
		ch.push(1);
		expect((await reader.next()).done).toBe(true);
	});

	test("a second reader throws agent.events_taken", () => {
		const ch = createChannel<number>();
		ch.iterable[Symbol.asyncIterator]();
		let thrown: unknown;
		try {
			ch.iterable[Symbol.asyncIterator]();
		} catch (error) {
			thrown = error;
		}
		expect(isPkError(thrown) && thrown.code).toBe("agent.events_taken");
	});
});
