import { expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { SmokeScreen } from "./smoke.tsx";

test("the smoke screen renders its title and size, and counts a resize", async () => {
	const seen: Array<[number, number]> = [];
	const setup = await testRender(
		() => (
			<SmokeScreen version="1.2.3" onResize={(w, h) => seen.push([w, h])} />
		),
		{ width: 60, height: 6 },
	);
	try {
		await setup.renderOnce();
		const first = setup.captureCharFrame();
		expect(first).toContain("pk 1.2.3 - tui smoke");
		expect(first).toContain("size 60x6 - resizes 0");

		setup.resize(72, 8);
		await setup.renderOnce();
		expect(setup.captureCharFrame()).toContain("size 72x8 - resizes 1");
		expect(seen).toEqual([[72, 8]]);
	} finally {
		setup.renderer.destroy();
	}
});

test("Ctrl+C and Ctrl+Z (keys in raw mode) reach cli's interrupt and suspend handlers", async () => {
	const calls: string[] = [];
	const setup = await testRender(
		() => (
			<SmokeScreen
				version="1.2.3"
				onInterrupt={() => calls.push("interrupt")}
				onSuspend={() => calls.push("suspend")}
			/>
		),
		{ width: 40, height: 4 },
	);
	try {
		await setup.renderOnce();
		setup.mockInput.pressKey("c");
		setup.mockInput.pressCtrlC();
		setup.mockInput.pressKey("z", { ctrl: true });
		await setup.renderOnce();
		expect(calls).toEqual(["interrupt", "suspend"]);
	} finally {
		setup.renderer.destroy();
	}
});
