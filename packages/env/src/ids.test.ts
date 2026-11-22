import { describe, expect, test } from "bun:test";
import { CallId, MessageId, SessionId } from "@pk/schema";
import { isPkError } from "./errors.ts";
import { createIdFactory } from "./ids.ts";

const zeros = (n: number) => new Uint8Array(n);
const fixedClock = (times: number[]) => {
	let i = 0;
	return () => times[Math.min(i++, times.length - 1)] ?? 0;
};

describe("createIdFactory (AC-14)", () => {
	test("makes <prefix>_<26 Crockford base32> IDs that each schema accepts", () => {
		const newId = createIdFactory({
			now: () => 1_764_000_000_000,
			randomBytes: zeros,
		});
		const call = newId("call");
		expect(call).toMatch(/^call_[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(CallId.parse(call)).toBe(call);
		expect(MessageId.parse(newId("msg"))).toBeString();
		expect(SessionId.parse(newId("ses"))).toBeString();
		expect(newId("agent")).toMatch(/^agent_/);
	});

	test("encodes time in the first 10 characters, ULID style", () => {
		const newId = createIdFactory({ now: () => 0, randomBytes: zeros });
		expect(String(newId("msg"))).toBe("msg_00000000000000000000000000");
		const later = createIdFactory({
			now: () => 2 ** 48 - 1,
			randomBytes: zeros,
		});
		expect(String(later("msg"))).toBe("msg_7ZZZZZZZZZ0000000000000000");
	});

	test("one monotonic state is shared by every prefix, even when the clock stalls or goes back", () => {
		const newId = createIdFactory({
			now: fixedClock([1000, 1000, 999, 1000, 1001]),
			randomBytes: (n) => new Uint8Array(n).fill(7),
		});
		const ids = [
			newId("msg"),
			newId("call"),
			newId("msg"),
			newId("turn"),
			newId("msg"),
		].map((id) => id.slice(id.indexOf("_") + 1));
		expect([...ids].sort()).toEqual(ids);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids[1]?.slice(0, 10)).toBe(ids[0]?.slice(0, 10)); // same millisecond, random part + 1
		expect(ids[2]?.slice(0, 10)).toBe(ids[0]?.slice(0, 10)); // backward clock counts as the last one
	});

	test("an overflow in one millisecond throws id.overflow", () => {
		const newId = createIdFactory({
			now: () => 5,
			randomBytes: (n) => new Uint8Array(n).fill(0xff),
		});
		newId("msg");
		let error: unknown;
		try {
			newId("msg");
		} catch (e) {
			error = e;
		}
		expect(isPkError(error) && error.code).toBe("id.overflow");
	});

	test("the factory calls randomBytes for 10 bytes", () => {
		const asked: number[] = [];
		createIdFactory({
			now: () => 1,
			randomBytes: (n) => {
				asked.push(n);
				return zeros(n);
			},
		})("msg");
		expect(asked).toEqual([10]);
	});
});
