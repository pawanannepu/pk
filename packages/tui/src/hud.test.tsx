import { describe, expect, test } from "bun:test";
import { demoId } from "./demo/script.ts";
import { HERO_RUN_MS } from "./hud-constants.ts";
import { at, mountTui, pushSession } from "./test-support.tsx";

const usage = (
	outputTokens: number,
	cost: { source: "catalog"; microUsd: number } | { source: "unknown" },
) =>
	at({
		type: "usage",
		model: { provider: "demo", model: "scripted" },
		usage: {
			inputTokens: 1_000,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			outputTokens,
		},
		cost,
	});

describe("header (spec 0003 AC-8)", () => {
	test("the folder shows home as ~, and the lamp reads ready, working, waiting", async () => {
		const session = pushSession();
		const t = await mountTui({ session, width: 140 });
		try {
			const header = () => t.frame().split("\n")[0] ?? "";
			expect(header()).toContain("~/code/demo");
			expect(header()).toContain("terminal coding agent");
			expect(header()).toContain("◉ ready");
			session.push(at({ type: "turn_start", turnId: demoId("turn", 1) }));
			await t.advance(50);
			expect(header()).toContain("◉ working");
			session.push(
				at({
					type: "permission_request",
					requestId: demoId("req", 1),
					kind: "read",
					call: {
						type: "tool_call",
						id: demoId("call", 1),
						name: "read_file",
						input: { path: "a" },
					},
				}),
			);
			await t.advance(50);
			expect(header()).toContain("◉ waiting");
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("warning count is a session total; error count resets at turn_start; denials do not count", async () => {
		const session = pushSession();
		const t = await mountTui({ session, width: 140 });
		try {
			const header = () => t.frame().split("\n")[0] ?? "";
			session.push(
				at({ type: "notice", level: "warning", code: "x", text: "careful" }),
			);
			session.push(
				at({
					type: "tool_result",
					durationMs: 1,
					result: {
						type: "tool_result",
						callId: demoId("call", 1),
						isError: true,
						content: [{ type: "text", text: "denied by user" }],
					},
				}),
			);
			await t.advance(50);
			expect(header()).toContain("▲ 1");
			expect(header()).not.toContain("err");
			session.push(
				at({
					type: "tool_result",
					durationMs: 1,
					result: {
						type: "tool_result",
						callId: demoId("call", 2),
						isError: true,
						content: [{ type: "text", text: "boom" }],
					},
				}),
			);
			await t.advance(50);
			expect(header()).toContain("◉ 1 err");
			session.push(at({ type: "turn_start", turnId: demoId("turn", 2) }));
			await t.advance(50);
			expect(header()).not.toContain("err");
			expect(header()).toContain("▲ 1");
		} finally {
			t.setup.renderer.destroy();
		}
	});
});

describe("footer (spec 0003 AC-9)", () => {
	test("mode, model, tokens and cost; unpriced calls never show as $0", async () => {
		const session = pushSession();
		const t = await mountTui({ session, width: 140, hints: ["esc stop"] });
		try {
			const footer = () => t.frame().split("\n").at(-2) ?? "";
			expect(footer()).toContain("■ normal");
			expect(footer()).toContain("■ demo/scripted");
			expect(footer()).toContain("esc stop · ctrl+b/f2 rails · ctrl+c quit");
			session.push(usage(100, { source: "unknown" }));
			session.push(usage(100, { source: "unknown" }));
			await t.advance(50);
			expect(footer()).toContain("■ ─ +2 unpriced");
			session.push(usage(100, { source: "catalog", microUsd: 40_000 }));
			await t.advance(50);
			expect(footer()).toContain("■ $0.04 +2 unpriced");
			expect(footer()).toContain("■ 3.3k tok");
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("the mode marker is amber for accept_edits and red for skip_all", async () => {
		const { modeTone } = await import("./ui/footer.tsx");
		expect([
			modeTone("normal"),
			modeTone("plan"),
			modeTone("accept_edits"),
			modeTone("skip_all"),
		]).toEqual(["bracket", "bracket", "amber", "red"]);
	});
});

describe("rails (spec 0003 AC-10) and the toggle (AC-7)", () => {
	test("empty states, then the demo fills every panel", async () => {
		const t = await mountTui({
			width: 140,
			height: 40,
			contextWindow: 200_000,
		});
		try {
			for (const empty of [
				"no plan yet",
				"no files yet",
				"idle",
				"no calls yet",
			])
				expect(t.frame()).toContain(empty);
			await t.playDemo("y");
			const frame = t.frame();
			expect(frame).toMatch(/src\/pro.*etry\.ts \+3 -1/);
			expect(frame).toMatch(/index\.ts r/);
			expect(frame).toContain("$0.0031 +1 unpriced");
			expect(frame).toContain("last turn $0.0000");
			expect(frame).toMatch(/▓░+ {2}7%/);
			expect(frame).toContain("◇ document the backo");
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("without a context window the gauge reads window unknown", async () => {
		const session = pushSession();
		const t = await mountTui({ session, width: 140 });
		try {
			session.push(usage(10, { source: "unknown" }));
			await t.advance(50);
			expect(t.frame()).toContain("window unknown");
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("Ctrl+B and F2 toggle the rails, and the toggle survives a resize", async () => {
		const t = await mountTui({ width: 140, height: 40 });
		try {
			expect(t.frame()).toContain("SESSION");
			t.setup.mockInput.pressKey("b", { ctrl: true });
			await t.advance(10);
			expect(t.frame()).not.toContain("SESSION");
			expect(t.frame()).not.toContain("ACTIVITY");
			t.setup.resize(150, 40);
			await t.advance(10);
			expect(t.frame()).not.toContain("SESSION");
			t.setup.mockInput.pressKey("F2");
			await t.advance(10);
			expect(t.frame()).toContain("SESSION");
		} finally {
			t.setup.renderer.destroy();
		}
	});
});

describe("too_small (spec 0003 AC-6)", () => {
	test("the notice covers the screen, keys are ignored, and the draft survives growing back", async () => {
		const t = await mountTui({ width: 100, height: 30 });
		try {
			await t.setup.mockInput.typeText("keep me");
			t.setup.resize(59, 30);
			await t.advance(10);
			expect(t.frame()).toContain("window too small");
			expect(t.frame()).toContain("59x30, needs 60x16");
			await t.setup.mockInput.typeText("zz");
			t.setup.mockInput.pressEnter();
			await t.advance(10);
			expect(t.recorded.submits).toEqual([]);
			t.setup.mockInput.pressCtrlC();
			expect(t.quits).toEqual(["quit"]);
			t.setup.resize(100, 30);
			await t.advance(10);
			expect(t.frame()).not.toContain("window too small");
			expect(t.frame()).toContain("keep me");
			expect(t.frame()).not.toContain("keep mezz");
		} finally {
			t.setup.renderer.destroy();
		}
	});
});

describe("hero (spec 0003 AC-16) and idle (AC-19)", () => {
	test("the globe turns, stops after 60 s, and nothing is pending once idle", async () => {
		const t = await mountTui({ width: 100, height: 40 });
		try {
			const globe = () => t.frame().split("\n").slice(2, 30).join("\n");
			const first = globe();
			await t.advance(125);
			expect(globe()).not.toEqual(first);
			expect(t.clock.pendingTimerCount).toBeGreaterThan(0);
			await t.advance(HERO_RUN_MS, 1_000);
			expect(t.store.state().heroStopped).toBe(true);
			const stopped = globe();
			await t.advance(1_000, 125);
			expect(globe()).toEqual(stopped);
			expect(t.clock.pendingTimerCount).toBe(0);
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("the hero is gone with the first item; after the demo goes idle no timer is pending", async () => {
		const t = await mountTui({ width: 140, height: 40 });
		try {
			expect(t.frame()).toContain("type a prompt and press enter");
			await t.playDemo("n");
			expect(t.frame()).not.toContain("type a prompt and press enter");
			await t.advance(500);
			expect(t.store.state().turn.status).toBe("idle");
			expect(t.store.state().permissions).toEqual([]);
			expect(t.clock.pendingTimerCount).toBe(0);
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("a small region or ASCII mode shows the ASCIIFont wordmark instead of the globe", async () => {
		for (const options of [
			{ width: 80, height: 20 },
			{ width: 100, height: 40, ascii: true },
		]) {
			const t = await mountTui(options);
			try {
				expect(t.frame()).toContain("type a prompt and press enter");
				expect(t.frame()).not.toMatch(/[⠁-⣿]/);
				expect(t.clock.pendingTimerCount).toBe(0);
			} finally {
				t.setup.renderer.destroy();
			}
		}
	});
});

describe("widths (spec 0003 AC-6)", () => {
	for (const [width, height] of [
		[140, 40],
		[120, 40],
		[80, 30],
	] as const) {
		test(`the played demo at ${width}x${height} matches its committed frame`, async () => {
			const t = await mountTui({ width, height, contextWindow: 200_000 });
			try {
				await t.playDemo("y");
				expect(t.frame()).toMatchSnapshot();
			} finally {
				t.setup.renderer.destroy();
			}
		});
	}
});
