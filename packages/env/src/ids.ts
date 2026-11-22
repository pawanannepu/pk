import {
	ID_SCHEMAS,
	type IdPrefix,
	type IdTypes,
	type NewId,
} from "@pk/schema";
import { PkError } from "./errors.ts";

/** What `createIdFactory` needs: a millisecond clock and a source of random bytes, both injected by `cli`. */
export interface IdFactoryDeps {
	readonly now: () => number;
	readonly randomBytes: (n: number) => Uint8Array;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const RANDOM_BITS = 80n;
const RANDOM_LIMIT = 1n << RANDOM_BITS;
const TIME_LIMIT = 2 ** 48;

function bytesToBigInt(bytes: Uint8Array): bigint {
	return bytes.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
}

/** Encodes a 130 bit ULID value (48 time bits, 80 random bits) as 26 Crockford base32 characters. */
function encode(value: bigint): string {
	return Array.from({ length: 26 }, (_, i) => {
		const shift = BigInt((25 - i) * 5);
		return CROCKFORD[Number((value >> shift) & 31n)];
	}).join("");
}

/**
 * Returns `newId(prefix)`, which yields `<prefix>_<ULID>`: 10 time characters then 16 random ones, in
 * uppercase Crockford base32, typed per prefix (`newId("call")` is a `CallId`).
 *
 * One monotonic state is shared by every prefix, so IDs made later always sort after earlier ones. In
 * the same millisecond the random part goes up by one; a clock that moves backward counts as the last
 * millisecond seen; an overflow throws `PkError` `id.overflow`. This state is an allowed exception to
 * the no mutation rule, like the clock it wraps.
 */
export function createIdFactory(deps: IdFactoryDeps): NewId {
	let lastTime = -1;
	let lastRandom = 0n;

	const next = (): string => {
		const time = Math.max(Math.floor(deps.now()), lastTime);
		if (time >= TIME_LIMIT) {
			throw new PkError("id.overflow", "the clock is past the ULID time range");
		}
		if (time === lastTime) {
			lastRandom += 1n;
			if (lastRandom >= RANDOM_LIMIT) {
				throw new PkError(
					"id.overflow",
					"too many IDs in one millisecond: the random part overflowed",
				);
			}
		} else {
			lastTime = time;
			lastRandom = bytesToBigInt(deps.randomBytes(10)) % RANDOM_LIMIT;
		}
		return encode((BigInt(time) << RANDOM_BITS) | lastRandom);
	};

	return <P extends IdPrefix>(prefix: P): IdTypes[P] =>
		ID_SCHEMAS[prefix].parse(`${prefix}_${next()}`);
}
