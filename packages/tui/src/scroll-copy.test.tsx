import { describe, expect, test } from "bun:test";
import { setRendererCapabilities } from "@opentui/core/testing";
import { decideCopy, unsupportedCopyNotice } from "./copy.ts";
import { demoId } from "./demo/script.ts";
import { at, mountTui, pushSession } from "./test-support.tsx";

const msg = (n: number) => demoId("msg", n);

/** Fills the transcript with `count` one line notices. */
async function filled(
	count: number,
	options: { copy?: (text: string) => boolean } = {},
) {
	const session = pushSession();
	const t = await mountTui({ session, width: 80, height: 30, ...options });
	for (let i = 0; i < count; i++) {
		session.push(
			at({
				type: "notice",
				level: "info",
				code: "n",
				text: `line ${String(i).padStart(3, "0")}`,
			}),
		);
	}
	await t.advance(100);
	await t.advance(50);
	return { t, session };
}

describe("scrolling (spec 0003 AC-17)", () => {
	test("sticky at the bottom; PgUp moves a page; new content while scrolled up shows ↓ new; End resumes", async () => {
		const { t, session } = await filled(80);
		try {
			expect(t.frame()).toContain("line 079");
			t.setup.mockInput.pressKey("\x1b[5~"); // PgUp
			await t.advance(20);
			await t.setup.renderOnce();
			expect(t.frame()).not.toContain("line 079");
			expect(t.frame()).not.toContain("↓ new");
			session.push(
				at({ type: "notice", level: "info", code: "n", text: "line 080" }),
			);
			await t.advance(100);
			await t.setup.renderOnce();
			expect(t.frame()).toContain("↓ new");
			expect(t.frame()).not.toContain("line 080");
			t.setup.mockInput.pressKey("END");
			await t.advance(20);
			await t.setup.renderOnce();
			expect(t.frame()).toContain("line 080");
			expect(t.frame()).not.toContain("↓ new");
			session.push(
				at({ type: "notice", level: "info", code: "n", text: "line 081" }),
			);
			await t.advance(100);
			await t.setup.renderOnce();
			expect(t.frame()).toContain("line 081");
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("Home jumps to the top only when the input is empty", async () => {
		const { t } = await filled(80);
		try {
			await t.setup.mockInput.typeText("draft");
			t.setup.mockInput.pressKey("HOME");
			await t.advance(20);
			await t.setup.renderOnce();
			expect(t.frame()).not.toContain("line 000");
			for (let i = 0; i < 5; i++) t.setup.mockInput.pressKey("DELETE");
			t.setup.mockInput.pressKey("HOME");
			await t.advance(20);
			await t.setup.renderOnce();
			expect(t.frame()).toContain("line 000");
		} finally {
			t.setup.renderer.destroy();
		}
	});
});

describe("2,000 items (spec 0003 AC-25)", () => {
	test("scrolling a 2,000 item transcript with PgDn and the wheel draws every frame well inside the 33 ms budget", async () => {
		const session = pushSession();
		const t = await mountTui({ session, width: 140, height: 40 });
		try {
			for (let i = 0; i < 2_000; i++) {
				session.push(
					at({ type: "notice", level: "info", code: "n", text: `line ${i}` }),
				);
			}
			await t.advance(100);
			t.setup.mockInput.pressKey("HOME");
			await t.advance(20);
			expect(t.frame()).toContain("line 0 ");
			const times: number[] = [];
			const timed = async () => {
				const start = performance.now();
				await t.setup.renderOnce();
				times.push(performance.now() - start);
			};
			for (let i = 0; i < 80; i++) {
				t.setup.mockInput.pressKey("\x1b[6~"); // PgDn
				await timed();
			}
			for (let i = 0; i < 40; i++) {
				await t.setup.mockMouse.scroll(60, 20, "up");
				await timed();
			}
			const sorted = [...times].sort((a, b) => a - b);
			const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
			// A stutter is a frame over budget; leave a wide margin for slow machines.
			expect(p95).toBeLessThan(16);
			expect(sorted.at(-1) ?? 0).toBeLessThan(33);
			expect(t.frame()).not.toContain("line 0 ");
		} finally {
			t.setup.renderer.destroy();
		}
	});
});

describe("resize (spec 0003 AC-17)", () => {
	test("scrolled up, a resize keeps the item at the top of the view and the draft", async () => {
		const { t } = await filled(120);
		try {
			await t.setup.mockInput.typeText("my draft");
			t.setup.mockInput.pressKey("\x1b[5~");
			t.setup.mockInput.pressKey("\x1b[5~");
			await t.advance(50);
			const topLine = () => t.frame().split("\n")[2]?.trim() ?? "";
			const before = topLine();
			expect(before).toMatch(/^· line \d{3}$/);
			t.setup.resize(95, 34);
			await t.advance(50);
			expect(topLine()).toBe(before);
			expect(t.frame()).toContain("my draft");
		} finally {
			t.setup.renderer.destroy();
		}
	});
});

describe("copy (spec 0003 AC-18)", () => {
	test("decideCopy: send, too large, and the unsupported notice once", () => {
		expect(
			decideCopy({
				text: "hi",
				osc52: "supported",
				inTmux: false,
				tmuxPassthrough: "unknown",
				warned: false,
			}),
		).toEqual({ kind: "send", text: "hi" });
		expect(
			decideCopy({
				text: "",
				osc52: "supported",
				inTmux: false,
				tmuxPassthrough: "unknown",
				warned: false,
			}).kind,
		).toBe("none");
		expect(
			decideCopy({
				text: "x".repeat(100_001),
				osc52: "unknown",
				inTmux: false,
				tmuxPassthrough: "unknown",
				warned: false,
			}).kind,
		).toBe("too_large");
		expect(
			decideCopy({
				text: "x",
				osc52: "unsupported",
				inTmux: true,
				tmuxPassthrough: "unknown",
				warned: false,
			}),
		).toEqual({
			kind: "unsupported",
			notice: unsupportedCopyNotice(true),
		});
		expect(unsupportedCopyNotice(true)).toEndWith(
			", or set -g allow-passthrough on in tmux",
		);
		// tmux drops pk's copy when allow-passthrough is off, whatever OpenTUI reports.
		for (const osc52 of ["supported", "unknown"] as const) {
			expect(
				decideCopy({
					text: "x",
					osc52,
					inTmux: true,
					tmuxPassthrough: "off",
					warned: false,
				}),
			).toEqual({ kind: "unsupported", notice: unsupportedCopyNotice(true) });
		}
		for (const tmuxPassthrough of ["on", "unknown"] as const) {
			expect(
				decideCopy({
					text: "x",
					osc52: "supported",
					inTmux: true,
					tmuxPassthrough,
					warned: false,
				}).kind,
			).toBe("send");
		}
		expect(
			decideCopy({
				text: "x",
				osc52: "unsupported",
				inTmux: false,
				tmuxPassthrough: "unknown",
				warned: true,
			}),
		).toEqual({ kind: "unsupported", notice: undefined });
	});

	test("a drag over the transcript sends its text without frame glyphs, and the footer says copy sent", async () => {
		const sent: string[] = [];
		const session = pushSession();
		const t = await mountTui({
			session,
			width: 80,
			height: 30,
			copy: (text) => {
				sent.push(text);
				return true;
			},
		});
		try {
			session.push(
				at({
					type: "message",
					message: {
						id: msg(1),
						at: "2026-11-22T10:00:00.000Z",
						role: "user",
						content: [{ type: "text", text: "hello there" }],
					},
				}),
			);
			session.push(
				at({ type: "text_delta", messageId: msg(2), text: "the answer is 42" }),
			);
			await t.advance(100);
			const rows = t.frame().split("\n");
			const y = rows.findIndex((r) => r.includes("the answer is 42"));
			const x = rows[y]?.indexOf("the") ?? 0;
			await t.setup.mockMouse.drag(x, y, x + 16, y);
			await t.advance(10);
			expect(sent).toEqual(["the answer is 42"]);
			expect(t.frame()).toContain("copy sent (16 chars)");
			// The user caret and bar are not part of a copy.
			const uy = rows.findIndex((r) => r.includes("hello there"));
			const ux = rows[uy]?.indexOf("hello") ?? 0;
			await t.setup.mockMouse.drag(ux, uy, ux + 30, uy);
			await t.advance(10);
			expect(sent.at(-1)).toBe("hello there");
			await t.advance(2_100, 100);
			expect(t.frame()).not.toContain("copy sent");
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("a click or drag in the transcript leaves focus on the input (AC-7)", async () => {
		const session = pushSession();
		const t = await mountTui({
			session,
			width: 80,
			height: 30,
			copy: () => true,
		});
		try {
			session.push(
				at({ type: "text_delta", messageId: msg(1), text: "the answer is 42" }),
			);
			await t.advance(100);
			const rows = t.frame().split("\n");
			const y = rows.findIndex((r) => r.includes("the answer is 42"));
			const x = rows[y]?.indexOf("the") ?? 0;
			await t.setup.mockMouse.drag(x, y, x + 16, y);
			await t.advance(10);
			await t.setup.mockInput.typeText("after drag");
			await t.advance(10);
			expect(t.frame()).toContain("after drag");
			await t.setup.mockMouse.click(x, y);
			await t.advance(10);
			await t.setup.mockInput.typeText(" and click");
			await t.advance(10);
			expect(t.frame()).toContain("after drag and click");
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("inside tmux with allow-passthrough off, the copy is not sent and one notice names the tmux fix; turning it on works at once", async () => {
		const sent: string[] = [];
		let passthrough: "on" | "off" = "off";
		const session = pushSession();
		const t = await mountTui({
			session,
			width: 120,
			height: 30,
			copy: (text) => {
				sent.push(text);
				return true;
			},
			env: { LANG: "en_US.UTF-8", TMUX: "/tmp/tmux-1/default" },
			tmuxPassthrough: () => passthrough,
		});
		try {
			session.push(
				at({ type: "text_delta", messageId: msg(2), text: "copy me please" }),
			);
			await t.advance(100);
			const rows = t.frame().split("\n");
			const y = rows.findIndex((r) => r.includes("copy me please"));
			const x = rows[y]?.indexOf("copy") ?? 0;
			await t.setup.mockMouse.drag(x, y, x + 7, y);
			await t.advance(50);
			await t.setup.mockMouse.drag(x, y, x + 7, y);
			await t.advance(50);
			expect(sent).toEqual([]);
			expect(t.frame()).not.toContain("copy sent");
			const notices = t.store
				.state()
				.transcript.filter((i) => i.kind === "notice");
			expect(notices.map((n) => n.kind === "notice" && n.text)).toEqual([
				unsupportedCopyNotice(true),
			]);
			passthrough = "on";
			await t.setup.mockMouse.drag(x, y, x + 7, y);
			await t.advance(50);
			expect(sent.length).toBe(1);
			expect(sent[0]).toStartWith("copy me");
			expect(t.frame()).toContain(`copy sent (${sent[0]?.length} chars)`);
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("a drag over the header or rails selects nothing", async () => {
		const sent: string[] = [];
		const t = await mountTui({
			width: 140,
			height: 40,
			copy: (text) => {
				sent.push(text);
				return true;
			},
		});
		try {
			await t.setup.mockMouse.drag(1, 0, 40, 0);
			await t.setup.mockMouse.drag(1, 3, 20, 6);
			await t.advance(10);
			expect(sent).toEqual([]);
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("outside tmux without OSC 52, the notice has no tmux part and tmux is never asked", async () => {
		const sent: string[] = [];
		let asked = 0;
		const session = pushSession();
		const t = await mountTui({
			session,
			width: 120,
			height: 30,
			copy: (text) => {
				sent.push(text);
				return true;
			},
			env: { LANG: "en_US.UTF-8" },
			tmuxPassthrough: () => {
				asked++;
				return "on";
			},
		});
		try {
			setRendererCapabilities(t.setup.renderer, {
				osc52: false,
				osc52_support: "unsupported",
			});
			session.push(
				at({ type: "text_delta", messageId: msg(2), text: "copy me please" }),
			);
			await t.advance(100);
			const rows = t.frame().split("\n");
			const y = rows.findIndex((r) => r.includes("copy me please"));
			const x = rows[y]?.indexOf("copy") ?? 0;
			await t.setup.mockMouse.drag(x, y, x + 7, y);
			await t.advance(50);
			expect(sent).toEqual([]);
			expect(asked).toBe(0);
			const notices = t.store
				.state()
				.transcript.filter((i) => i.kind === "notice");
			expect(notices.map((n) => n.kind === "notice" && n.text)).toEqual([
				unsupportedCopyNotice(false),
			]);
			expect(unsupportedCopyNotice(false)).not.toContain("tmux");
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("without OSC 52 the first copy adds one warning notice and later ones add none", async () => {
		const sent: string[] = [];
		const session = pushSession();
		const t = await mountTui({
			session,
			width: 80,
			height: 30,
			copy: (text) => {
				sent.push(text);
				return true;
			},
			env: { LANG: "en_US.UTF-8", TMUX: "/tmp/tmux-1/default" },
		});
		try {
			setRendererCapabilities(t.setup.renderer, {
				osc52: false,
				osc52_support: "unsupported",
			});
			session.push(
				at({ type: "text_delta", messageId: msg(2), text: "copy me please" }),
			);
			await t.advance(100);
			const rows = t.frame().split("\n");
			const y = rows.findIndex((r) => r.includes("copy me please"));
			const x = rows[y]?.indexOf("copy") ?? 0;
			await t.setup.mockMouse.drag(x, y, x + 7, y);
			await t.advance(50);
			await t.setup.mockMouse.drag(x, y, x + 7, y);
			await t.advance(50);
			expect(sent).toEqual([]);
			const notices = t.store
				.state()
				.transcript.filter((i) => i.kind === "notice");
			expect(notices.length).toBe(1);
			expect(t.frame()).toContain("copy not supported in this terminal");
			expect(t.store.state().warnings).toBe(1);
		} finally {
			t.setup.renderer.destroy();
		}
	});
});
