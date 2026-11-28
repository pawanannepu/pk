import { describe, expect, test } from "bun:test";
import { SKIP_ALL_LINE } from "./hud/state.ts";
import { type MountOptions, mountTui } from "./test-support.tsx";

type Mounted = Awaited<ReturnType<typeof mountTui>>;

const footer = (t: Mounted) => t.frame().split("\n").at(-2) ?? "";

const shiftTab = async (t: Mounted) => {
	t.setup.mockInput.pressTab({ shift: true });
	// The store applies events in 33 ms batches.
	await t.advance(50);
};

/** Plays turn 1, submits turn 2 and steps until the first permission panel shows. */
async function atPermission(options: MountOptions = {}) {
	const t = await mountTui(options);
	await t.submit("one");
	await t.advance(6_000, 25);
	await t.submit("two");
	for (let i = 0; i < 200 && !t.frame().includes("PERMISSION"); i++)
		await t.advance(10, 10);
	await t.advance(50, 10);
	return t;
}

describe("Shift+Tab (spec 0006 AC-10)", () => {
	test("cycles normal, accept_edits, plan and back; the footer and SESSION rail follow", async () => {
		const t = await mountTui();
		try {
			expect(footer(t)).toContain("■ normal");
			expect(footer(t)).toContain("shift+tab mode");
			await shiftTab(t);
			expect(footer(t)).toContain("■ accept_edits");
			await shiftTab(t);
			expect(footer(t)).toContain("■ plan");
			// The SESSION rail's mode row.
			expect(
				t
					.frame()
					.split("\n")
					.some((line) => line.startsWith(" plan ")),
			).toBe(true);
			await shiftTab(t);
			expect(footer(t)).toContain("■ normal");
			expect(t.recorded.modes).toEqual(["accept_edits", "plan", "normal"]);
			expect(t.frame()).not.toContain(SKIP_ALL_LINE);
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("two presses before any event is read step two modes", async () => {
		const t = await mountTui();
		try {
			t.setup.mockInput.pressTab({ shift: true });
			t.setup.mockInput.pressTab({ shift: true });
			await t.advance(50);
			expect(t.recorded.modes).toEqual(["accept_edits", "plan"]);
			expect(footer(t)).toContain("■ plan");
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("with the skip flag the cycle reaches skip_all and adds the red line on each entry", async () => {
		const t = await mountTui({ skipAllAvailable: true });
		try {
			for (let i = 0; i < 3; i++) await shiftTab(t);
			expect(footer(t)).toContain("■ skip_all");
			expect(t.frame()).toContain(SKIP_ALL_LINE);
			await shiftTab(t);
			expect(footer(t)).toContain("■ normal");
			expect(t.frame()).toContain(SKIP_ALL_LINE);
			for (let i = 0; i < 3; i++) await shiftTab(t);
			const lines = t.frame().split(SKIP_ALL_LINE).length - 1;
			expect(lines).toBe(2);
			// The red line does not end the hero.
			expect(t.store.state().hasMessage).toBe(false);
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("starting in skip_all shows the red line at mount", async () => {
		const t = await mountTui({ mode: "skip_all", skipAllAvailable: true });
		try {
			expect(t.frame()).toContain(SKIP_ALL_LINE);
			expect(footer(t)).toContain("■ skip_all");
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("ignored during the panel guard and while the note field is open", async () => {
		const t = await atPermission();
		try {
			t.setup.mockInput.pressTab({ shift: true });
			await t.settle();
			expect(t.recorded.modes).toEqual([]);
			await t.advance(350);
			t.setup.mockInput.pressKey("e");
			await t.advance(20);
			t.setup.mockInput.pressTab({ shift: true });
			await t.advance(20);
			expect(t.recorded.modes).toEqual([]);
		} finally {
			t.setup.renderer.destroy();
		}
	});
});

describe("deny and explain (spec 0006 AC-6)", () => {
	test("e opens the note field; y, a, n are typed as text; Enter sends the trimmed note", async () => {
		const t = await atPermission();
		try {
			await t.advance(350);
			t.setup.mockInput.pressKey("E");
			await t.advance(20);
			expect(t.frame()).toContain("note ›");
			expect(t.frame()).toContain("enter send · esc back");
			expect(t.frame()).not.toContain("[y] allow once");
			await t.setup.mockInput.typeText("  any new tests  ");
			await t.advance(20);
			expect(t.frame()).toContain("any new tests");
			expect(t.recorded.responses).toEqual([]);
			t.setup.mockInput.pressEnter();
			await t.advance(20);
			expect(t.recorded.responses.map(([, a]) => a)).toEqual([
				{ decision: "deny", note: "any new tests" },
			]);
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("Esc goes back to the keys and sends nothing; an empty note is a plain deny", async () => {
		// With the kitty protocol a lone Esc arrives at once instead of after the parser's wait.
		const t = await atPermission({ kittyKeyboard: true });
		try {
			await t.advance(350);
			t.setup.mockInput.pressKey("e");
			await t.advance(20);
			await t.setup.mockInput.typeText("draft");
			t.setup.mockInput.pressEscape();
			await t.advance(20);
			expect(t.frame()).toContain("[e] deny and explain");
			expect(t.recorded.responses).toEqual([]);
			// The guard is not restarted, so e works at once.
			t.setup.mockInput.pressKey("e");
			await t.advance(20);
			expect(t.frame()).toContain("note ›");
			expect(t.frame()).not.toContain("draft");
			await t.setup.mockInput.typeText("   ");
			t.setup.mockInput.pressEnter();
			await t.advance(20);
			expect(t.recorded.responses.map(([, a]) => a)).toEqual([
				{ decision: "deny" },
			]);
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("a pasted note turns newlines into spaces", async () => {
		const t = await atPermission();
		try {
			await t.advance(350);
			t.setup.mockInput.pressKey("e");
			await t.advance(20);
			await t.setup.mockInput.pasteBracketedText("use\nthe\tfixture");
			await t.advance(20);
			t.setup.mockInput.pressEnter();
			await t.advance(20);
			expect(t.recorded.responses.map(([, a]) => a)).toEqual([
				{ decision: "deny", note: "use the fixture" },
			]);
		} finally {
			t.setup.renderer.destroy();
		}
	});
});
