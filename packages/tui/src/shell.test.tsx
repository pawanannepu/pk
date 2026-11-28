import { describe, expect, test } from "bun:test";
import { mountTui } from "./test-support.tsx";

describe("the input (spec 0003 AC-15)", () => {
	test("Enter sends the text unchanged and clears the input; blank text is not sent", async () => {
		const t = await mountTui();
		try {
			await t.submit("   ");
			expect(t.recorded.submits).toEqual([]);
			t.setup.mockInput.pressBackspace();
			t.setup.mockInput.pressBackspace();
			t.setup.mockInput.pressBackspace();
			await t.submit("why does the loop retry twice?");
			expect(t.recorded.submits).toEqual(["why does the loop retry twice?"]);
			expect(t.frame()).toContain("ask pk anything");
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("two Enters 10 ms apart call submit once; Enter while a turn runs keeps the draft", async () => {
		const t = await mountTui();
		try {
			await t.submit("first");
			await t.advance(10);
			await t.submit("second");
			expect(t.recorded.submits).toEqual(["first"]);
			expect(t.frame()).toContain("second");
			expect(t.frame()).toContain("turn running");
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("Shift+Enter inserts a newline instead of sending (kitty keyboard protocol)", async () => {
		const t = await mountTui({ kittyKeyboard: true });
		try {
			await t.setup.mockInput.typeText("line one");
			t.setup.mockInput.pressEnter({ shift: true });
			await t.setup.mockInput.typeText("line two");
			await t.setup.renderOnce();
			expect(t.recorded.submits).toEqual([]);
			expect(t.frame()).toContain("line two");
		} finally {
			t.setup.renderer.destroy();
		}
	});
});

describe("keys the shell takes (spec 0003 AC-7)", () => {
	test("Ctrl+C calls onQuit and Ctrl+Z calls onSuspend", async () => {
		const t = await mountTui();
		try {
			t.setup.mockInput.pressCtrlC();
			t.setup.mockInput.pressKey("z", { ctrl: true });
			await t.settle();
			expect(t.quits).toEqual(["quit", "suspend"]);
		} finally {
			t.setup.renderer.destroy();
		}
	});
});

/** Plays turn 1, submits turn 2 (after typing `draft` if given) and steps until the panel shows. */
async function atPermission(draft?: string) {
	const t = await mountTui();
	await t.submit("one");
	await t.advance(6_000, 25);
	await t.submit("two");
	if (draft) await t.setup.mockInput.typeText(draft);
	for (let i = 0; i < 200 && !t.frame().includes("PERMISSION"); i++)
		await t.advance(10, 10);
	// The second request follows 10 ms later, inside the next 33 ms batch.
	await t.advance(50, 10);
	return t;
}

describe("the permission panel (spec 0003 AC-13)", () => {
	test("queues two requests; a y at 100 ms is ignored, a y at 350 ms allows once", async () => {
		const t = await atPermission();
		try {
			expect(t.frame()).toContain("PERMISSION");
			expect(t.frame()).toContain("edit_file wants to write");
			expect(t.frame()).toContain(
				"[y] allow once  [a] this session  [n] deny  [e] deny and explain",
			);
			expect(t.frame()).toContain("1 of 2");
			expect(t.frame()).toContain("waiting");
			expect(t.frame()).toContain('"path": "src/provider/retry.ts"');
			await t.advance(40);
			t.setup.mockInput.pressKey("y");
			await t.settle();
			expect(t.recorded.responses).toEqual([]);
			await t.advance(250);
			t.setup.mockInput.pressKey("y");
			await t.settle();
			await t.setup.renderOnce();
			expect(t.recorded.responses.map(([, a]) => a.decision)).toEqual([
				"allow_once",
			]);
			// The next request is shown and its guard restarts.
			expect(t.frame()).toContain("bash wants to run");
			expect(t.frame()).not.toContain("1 of 2");
			t.setup.mockInput.pressKey("a");
			await t.settle();
			expect(t.recorded.responses.length).toBe(1);
			await t.advance(350);
			t.setup.mockInput.pressKey("A");
			await t.settle();
			expect(t.recorded.responses.map(([, a]) => a.decision)).toEqual([
				"allow_once",
				"allow_session",
			]);
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("keys typed while the panel is open never reach the input", async () => {
		const t = await atPermission();
		try {
			await t.advance(350);
			await t.setup.mockInput.typeText("zxcv");
			await t.setup.renderOnce();
			expect(t.recorded.responses).toEqual([]);
			expect(t.frame()).not.toContain("zxcv");
		} finally {
			t.setup.renderer.destroy();
		}
	});

	test("n denies, the draft is restored, and the lamp stops blinking", async () => {
		const t = await atPermission("half typed");
		try {
			expect(t.frame()).toContain("PERMISSION");
			expect(t.frame()).not.toContain("half typed");
			await t.advance(350);
			t.setup.mockInput.pressKey("n");
			await t.advance(350);
			t.setup.mockInput.pressKey("n");
			await t.advance(500);
			expect(t.recorded.responses.map(([, a]) => a.decision)).toEqual([
				"deny",
				"deny",
			]);
			expect(t.frame()).not.toContain("PERMISSION");
			expect(t.frame()).toContain("half typed");
			expect(t.frame()).not.toContain("waiting");
		} finally {
			t.setup.renderer.destroy();
		}
	});
});
