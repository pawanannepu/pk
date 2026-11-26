import { describe, expect, test } from "bun:test";
import { demoId } from "./demo/script.ts";
import { at, mountTui, pushSession } from "./test-support.tsx";

const msg = demoId("msg", 1);
const call = demoId("call", 1);

async function withSession(width = 100, height = 40) {
	const session = pushSession();
	const t = await mountTui({ session, width, height });
	const flush = async (ms = 50) => t.advance(ms);
	return { t, session, flush };
}

describe("outside strings are sanitized on screen (spec 0003 AC-24)", () => {
	test("model text with an escape sequence renders without it", async () => {
		const { t, session, flush } = await withSession();
		try {
			session.push(
				at({ type: "text_delta", messageId: msg, text: "a\x1b[2Jb\tc\r\n" }),
			);
			await flush();
			const row = t
				.frame()
				.split("\n")
				.find((r) => r.includes("ab"));
			expect(row?.trimStart().startsWith("ab  c ")).toBe(true);
			expect(t.frame()).not.toContain("[2J");
		} finally {
			t.setup.renderer.destroy();
		}
	});
});

describe("tool lines (spec 0003 AC-12)", () => {
	test("pending, then running with elapsed time, then done with size and duration", async () => {
		const { t, session, flush } = await withSession();
		try {
			session.push(at({ type: "turn_start", turnId: demoId("turn", 1) }));
			session.push(
				at({
					type: "tool_call_start",
					messageId: msg,
					callId: call,
					name: "bash",
				}),
			);
			await flush();
			expect(t.frame()).toMatch(/◇ bash/);
			session.push(at({ type: "tool_run_start", callId: call }, 50));
			await t.advance(3_000, 50);
			expect(t.frame()).toMatch(/bash .*running \d\.\ds/);
			session.push(
				at({
					type: "tool_result",
					durationMs: 3_100,
					result: {
						type: "tool_result",
						callId: call,
						isError: false,
						content: [{ type: "text", text: "x".repeat(2150) }],
					},
				}),
			);
			await flush();
			expect(t.frame()).toMatch(/◆ bash .*2\.1 KB · 3\.1s/);
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("a failed call shows the first line of the error; bad details render no diff", async () => {
		const { t, session, flush } = await withSession();
		try {
			session.push(
				at({
					type: "tool_call_start",
					messageId: msg,
					callId: call,
					name: "edit_file",
				}),
			);
			session.push(
				at({
					type: "tool_result",
					durationMs: 1,
					result: {
						type: "tool_result",
						callId: call,
						isError: true,
						content: [{ type: "text", text: "no match for old text\nmore" }],
						details: { diff: 42 },
					},
				}),
			);
			await flush();
			expect(t.frame()).toMatch(/✖ edit_file .*no match for old text/);
			expect(t.frame()).not.toContain("more");
		} finally {
			t.setup.renderer.destroy();
		}
	});
});

describe("the permission panel (spec 0003 AC-13)", () => {
	test("the target and JSON pass through redact(), and the JSON is capped at 6 rows", async () => {
		const { t, session, flush } = await withSession(100, 60);
		try {
			session.push(at({ type: "turn_start", turnId: demoId("turn", 1) }));
			session.push(
				at({
					type: "permission_request",
					requestId: demoId("req", 1),
					kind: "network",
					call: {
						type: "tool_call",
						id: call,
						name: "fetch",
						input: {
							url: "https://x.test/?k=sk-abcdefghijklmnopqrstuvwx",
							a: 1,
							b: 2,
							c: 3,
							d: 4,
							e: 5,
							f: 6,
						},
					},
				}),
			);
			await flush();
			const frame = t.frame();
			expect(frame).toContain("fetch wants to reach the network");
			expect(frame).not.toContain("sk-abcdefghijklmnopqrstuvwx");
			expect(frame).toContain("[REDACTED]");
			expect(frame).not.toContain('"f": 6');
			expect(frame).toContain("…");
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("the panel never takes more than 40% of the center height", async () => {
		const { t, session, flush } = await withSession(100, 30);
		try {
			session.push(
				at({
					type: "permission_request",
					requestId: demoId("req", 1),
					kind: "write",
					call: {
						type: "tool_call",
						id: call,
						name: "edit_file",
						input: { path: "a.ts", text: "x\n".repeat(30) },
					},
				}),
			);
			await flush();
			const rows = t.frame().split("\n");
			const top = rows.findIndex((r) => r.includes("PERMISSION"));
			const bottom = rows.findIndex(
				(r, i) => i > top && r.trimStart().startsWith("└"),
			);
			expect(bottom - top + 1).toBeLessThanOrEqual(
				Math.floor((30 - 3) * 0.4) + 1,
			);
		} finally {
			t.setup.renderer.destroy();
		}
	});
});

describe("the session stream (spec 0003 AC-14)", () => {
	test("a stream that ends adds session ended and the screen stays", async () => {
		const { t, session, flush } = await withSession();
		try {
			session.end();
			await flush();
			expect(t.frame()).toContain("· session ended");
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("a stream that throws adds a tui.session_failed block", async () => {
		const { t, session, flush } = await withSession();
		try {
			session.fail(new Error("socket closed"));
			await flush();
			expect(t.frame()).toContain("tui.session_failed");
			expect(t.frame()).toContain("socket closed");
			expect(t.frame()).toContain("try: restart pk");
		} finally {
			t.setup.renderer.destroy();
		}
	});
});
