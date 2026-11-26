import { describe, expect, test } from "bun:test";
import { mountTui } from "./test-support.tsx";

/** Every drawn cell of a captured frame: text, fg and bg intents. */
async function playedSpans(env: Record<string, string>, ascii = false) {
	const t = await mountTui({ width: 100, height: 130, env, ascii });
	await t.playDemo("y");
	const spans = t.setup.captureSpans().lines.flatMap((line) => line.spans);
	const frame = t.frame();
	t.setup.renderer.destroy();
	return { spans, frame };
}

describe("NO_COLOR (spec 0003 AC-4)", () => {
	test("the full demo transcript emits no color: every intent is default", async () => {
		const { spans, frame } = await playedSpans({
			NO_COLOR: "1",
			LANG: "en_US.UTF-8",
			TERM: "xterm-256color",
		});
		// Every item kind the script produces is on screen.
		for (const needle of [
			"why does the loop",
			"thought for",
			"read_file",
			"project root found",
			"retrying after 429",
			"ERROR",
			"2 tests failed",
		]) {
			expect(frame).toContain(needle);
		}
		const coloredBg = spans.filter((s) => s.bg.intent !== "default");
		expect(coloredBg.map((s) => s.text)).toEqual([]);
		// A blank cell's foreground is never seen, so only drawn characters are checked.
		const coloredFg = spans.filter(
			(s) => s.text.trim() !== "" && s.fg.intent !== "default",
		);
		expect(coloredFg.map((s) => s.text)).toEqual([]);
	});

	test("changed diff rows keep their sign column and tool lines keep their status glyph", async () => {
		const { frame } = await playedSpans({ NO_COLOR: "1", LANG: "en_US.UTF-8" });
		const rows = frame.split("\n");
		expect(rows.some((r) => /^\s+25 - const RETRIES = 2;/.test(r))).toBe(true);
		expect(rows.some((r) => /^\s+25 \+ const RETRIES = 3;/.test(r))).toBe(true);
		expect(rows.some((r) => /^\s+27 \+ const MAX_DELAY_MS/.test(r))).toBe(true);
		for (const name of ["read_file", "edit_file", "bash", "grep"]) {
			// The transcript's tool line: two columns in, the status glyph, then the name.
			expect(rows.some((r) => new RegExp(`^ {2}[◆◇✖] ${name} `).test(r))).toBe(
				true,
			);
		}
	});
});

describe("16 colors (spec 0003 AC-3)", () => {
	test("only indexed and default intents are used", async () => {
		const { spans } = await playedSpans({ LANG: "en_US.UTF-8", TERM: "xterm" });
		const rgb = spans.filter(
			(s) =>
				s.text.trim() !== "" &&
				(s.fg.intent === "rgb" || s.bg.intent === "rgb"),
		);
		expect(rgb.map((s) => s.text)).toEqual([]);
	});
});

describe("ASCII (spec 0003 AC-5)", () => {
	test("a non UTF-8 locale renders only printable ASCII", async () => {
		const { frame } = await playedSpans({ LANG: "C", TERM: "xterm-256color" });
		const bad = [
			...new Set(
				frame
					.replace(/\n/g, "")
					.split("")
					.filter((c) => c < " " || c > "~"),
			),
		];
		expect(bad).toEqual([]);
		expect(frame).toContain("ERROR");
	});

	test("the hero is printable ASCII too, with the ASCII art wordmark", async () => {
		for (const [env, ascii] of [
			[{ LANG: "C", TERM: "xterm-256color" }, false],
			[{ LANG: "en_US.UTF-8" }, true],
		] as const) {
			const t = await mountTui({ width: 100, height: 40, env, ascii });
			try {
				const frame = t.frame();
				expect(/^[\x20-\x7e\n]*$/.test(frame)).toBe(true);
				expect(frame).toContain("|_| |_|\\_\\");
				expect(frame).toContain("type a prompt and press enter");
			} finally {
				t.setup.renderer.destroy();
			}
		}
	});

	test("ui.ascii forces ASCII in a UTF-8 locale", async () => {
		const { frame } = await playedSpans({ LANG: "en_US.UTF-8" }, true);
		expect(/^[\x20-\x7e\n]*$/.test(frame)).toBe(true);
	});
});
