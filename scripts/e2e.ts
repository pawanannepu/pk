/**
 * Compiled binary tests (spec 0001, "Constraints the scaffold must honor").
 *
 *   bun run test:e2e                              # builds the host binary, then tests it
 *   bun run test:e2e --binary dist/pk-linux-x64   # tests an already built binary (CI)
 *
 * 1. `pk --version` prints the root package.json version and exits 0.
 * 2. `pk __tui-smoke` runs in a real PTY: it renders the OpenTUI and Solid screen, survives one
 *    resize, exits on its timer with code 0, and restores the terminal (left the alternate screen,
 *    cursor shown).
 * 3. The native library home ("Process behavior"): cases (1) to (7) of the spec's first proof. The
 *    library goes to `<PK_HOME>/native/<id>/`, never `TMPDIR`, through a self exec (same PID), and
 *    pk fails closed on a folder it cannot trust.
 * It also prints the binary size and startup time, which spec 0001 asks to record per target.
 */
import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { build, hostTarget, nativeLibraryId } from "./build.ts";

const ROOT = join(import.meta.dir, "..");
const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: { binary: { type: "string" } },
});
const binary = values.binary
	? resolve(values.binary)
	: await build(hostTarget());
// The binary was built on this runner, so it embeds this runner's native library.
const nativeId = await nativeLibraryId(hostTarget());
const { version } = (await Bun.file(join(ROOT, "package.json")).json()) as {
	version: string;
};
const isRoot = process.getuid?.() === 0;

let failures = 0;
const check = (ok: boolean, label: string, detail?: string): void => {
	console.log(
		`${ok ? "ok  " : "FAIL"} ${label}${!ok && detail ? `\n     ${detail}` : ""}`,
	);
	if (!ok) failures++;
};

type Env = Record<string, string | undefined>;

interface SmokeRun {
	readonly exitCode: number;
	readonly output: string;
	readonly pid: number;
	readonly result?: SmokeResult;
}

interface SmokeResult {
	readonly resizes: number;
	readonly width: number;
	readonly height: number;
	readonly pid: number;
	readonly native: string | null;
	readonly BUN_TMPDIR: string | null;
	readonly PK_NATIVE_DIR: string | null;
	readonly PK_USER_BUN_TMPDIR: string | null;
}

/** Parses the line the smoke prints after it restored the terminal. Values are JSON. */
function parseResult(output: string): SmokeResult | undefined {
	const match =
		/pk tui smoke ok: resizes=(\d+) size=(\d+)x(\d+) pid=(\d+) native=(\S+) BUN_TMPDIR=(\S+) PK_NATIVE_DIR=(\S+) PK_USER_BUN_TMPDIR=(\S+)/.exec(
			output,
		);
	if (!match) return undefined;
	const json = (value: string | undefined) =>
		JSON.parse(value ?? "null") as string | null;
	return {
		resizes: Number(match[1]),
		width: Number(match[2]),
		height: Number(match[3]),
		pid: Number(match[4]),
		native: json(match[5]),
		BUN_TMPDIR: json(match[6]),
		PK_NATIVE_DIR: json(match[7]),
		PK_USER_BUN_TMPDIR: json(match[8]),
	};
}

async function runSmoke(
	smokeEnv: Env,
	options: {
		durationMs?: number;
		resize?: boolean;
		/** Drives the running smoke (keys, signals) while it is up. */
		during?: (proc: Bun.Subprocess) => Promise<void>;
	} = {},
): Promise<SmokeRun> {
	const env: Record<string, string> = { TERM: "xterm-256color" };
	for (const [key, value] of Object.entries(smokeEnv)) {
		if (typeof value === "string") env[key] = value;
	}
	const chunks: Uint8Array[] = [];
	const proc = Bun.spawn(
		[binary, "__tui-smoke", "--duration", String(options.durationMs ?? 1000)],
		{
			env,
			terminal: {
				cols: 80,
				rows: 24,
				data: (_terminal, data) => chunks.push(data),
			},
		},
	);
	const resizer = options.resize
		? setTimeout(() => proc.terminal?.resize(100, 30), 600)
		: undefined;
	const killer = setTimeout(() => proc.kill("SIGKILL"), 15_000);
	await options.during?.(proc);
	const exitCode = await proc.exited;
	clearTimeout(resizer);
	clearTimeout(killer);
	await Bun.sleep(100); // let the PTY drain
	proc.terminal?.close();
	const output = Buffer.concat(chunks).toString("utf8");
	return { exitCode, output, pid: proc.pid, result: parseResult(output) };
}

const tailOf = (run: SmokeRun) => JSON.stringify(run.output.slice(-400));
const entriesOf = (dir: string) => {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
};
const modeOf = (path: string) => (lstatSync(path).mode & 0o777).toString(8);

const scratch = realpathSync(await mkdtemp(join(tmpdir(), "pk-e2e-")));
const readOnlyTmp = join(scratch, "ro-tmp");
const writableTmp = join(scratch, "tmp");
await mkdir(readOnlyTmp);
await mkdir(writableTmp);
await chmod(readOnlyTmp, 0o555);
const base: Env = {
	...process.env,
	NO_COLOR: undefined,
	BUN_TMPDIR: undefined,
};
for (const key of ["PK_NATIVE_DIR", "PK_USER_BUN_TMPDIR"])
	base[key] = undefined;

/** A fresh, not yet created PK_HOME for one case, and where its private folder will be. */
const caseHome = async (name: string) => {
	const parent = join(scratch, name);
	await mkdir(parent, { mode: 0o700 });
	const home = join(parent, "home");
	return {
		home,
		nativeRoot: join(home, "native"),
		target: join(home, "native", nativeId),
	};
};

try {
	// 1. --version
	const versionHome = await caseHome("version");
	const env = { ...base, PK_HOME: versionHome.home };
	const versionRun = Bun.spawnSync([binary, "--version"], {
		env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const printed = versionRun.stdout.toString().trim();
	check(
		versionRun.exitCode === 0,
		"pk --version exits 0",
		`exit ${versionRun.exitCode}: ${versionRun.stderr}`,
	);
	check(
		printed === version,
		`pk --version prints ${version}`,
		`printed "${printed}"`,
	);
	check(
		entriesOf(versionHome.home).length === 0,
		"pk --version does not touch the native library home",
		`found ${entriesOf(versionHome.home).join(", ")}`,
	);

	// Startup: median of 5 warm runs of --version.
	const times: number[] = [];
	for (let i = 0; i < 5; i++) {
		const started = performance.now();
		Bun.spawnSync([binary, "--version"], {
			env,
			stdout: "ignore",
			stderr: "ignore",
		});
		times.push(performance.now() - started);
	}
	times.sort((a, b) => a - b);
	const { size } = await stat(binary);
	console.log(
		`info binary ${(size / 1024 / 1024).toFixed(1)} MB, --version startup median ${Math.round(times[2] ?? 0)} ms`,
	);

	// 2. __tui-smoke in a PTY with one resize.
	const mainHome = await caseHome("smoke");
	const smoke = await runSmoke(
		{ ...base, PK_HOME: mainHome.home, TMPDIR: writableTmp },
		{ durationMs: 1500, resize: true },
	);
	const tail = tailOf(smoke);
	check(
		smoke.exitCode === 0,
		"pk __tui-smoke exits 0 on its timer",
		`exit ${smoke.exitCode}, tail ${tail}`,
	);
	check(
		smoke.output.includes("tui smoke"),
		"smoke screen rendered",
		`tail ${tail}`,
	);
	check(
		smoke.output.includes("\x1b[?1049h"),
		"entered the alternate screen",
		`tail ${tail}`,
	);
	check(
		smoke.output.includes("\x1b[?1049l"),
		"left the alternate screen",
		`tail ${tail}`,
	);
	check(
		smoke.output.lastIndexOf("\x1b[?25h") >
			smoke.output.lastIndexOf("\x1b[?25l"),
		"cursor shown again",
		`tail ${tail}`,
	);
	check(
		smoke.result !== undefined,
		"smoke reported its result after restore",
		`tail ${tail}`,
	);
	if (smoke.result) {
		check(
			smoke.result.resizes >= 1,
			"handled the resize",
			`resizes=${smoke.result.resizes}`,
		);
		check(
			smoke.result.width === 100 && smoke.result.height === 30,
			"saw the new size 100x30",
			`size=${smoke.result.width}x${smoke.result.height}`,
		);
	}
	check(
		entriesOf(writableTmp).length === 0,
		"nothing written to a writable TMPDIR",
		`found ${entriesOf(writableTmp).join(", ")}`,
	);

	// The terminal is in raw mode, so Ctrl+C and Ctrl+Z arrive as keys, not signals.
	const restored = (run: SmokeRun) =>
		run.output.lastIndexOf("\x1b[?1049l") >
			run.output.lastIndexOf("\x1b[?1049h") &&
		run.output.lastIndexOf("\x1b[?25h") > run.output.lastIndexOf("\x1b[?25l");
	const interrupted = await runSmoke(
		{ ...base, PK_HOME: mainHome.home, TMPDIR: writableTmp },
		{
			durationMs: 5000,
			during: async (proc) => {
				await Bun.sleep(800);
				proc.terminal?.write("\x03");
			},
		},
	);
	check(
		interrupted.exitCode === 130 &&
			restored(interrupted) &&
			interrupted.result === undefined,
		"Ctrl+C exits 130 at once with the terminal restored",
		`exit ${interrupted.exitCode}, tail ${tailOf(interrupted)}`,
	);
	const suspended = await runSmoke(
		{ ...base, PK_HOME: mainHome.home, TMPDIR: writableTmp },
		{
			durationMs: 1500,
			during: async (proc) => {
				await Bun.sleep(800);
				proc.terminal?.write("\x1a");
				await Bun.sleep(500);
				proc.kill("SIGCONT");
			},
		},
	);
	const entered = suspended.output.split("\x1b[?1049h").length - 1;
	check(
		suspended.exitCode === 0 && entered >= 2 && restored(suspended),
		"Ctrl+Z hands the terminal back; SIGCONT redraws and the smoke ends on its timer",
		`exit ${suspended.exitCode}, alternate screen entered ${entered} time(s), tail ${tailOf(suspended)}`,
	);

	// spec 0003 AC-22: the scripted demo through the real shell, at 140x40.
	const demoBase: Record<string, string> = {
		TERM: "xterm-256color",
		LANG: "en_US.UTF-8",
		PK_HOME: mainHome.home,
		TMPDIR: writableTmp,
		PATH: process.env.PATH ?? "",
	};
	/** Plays two turns (both prompts answered), and the third turn's error when `full`, then Ctrl+C. */
	const playDemo = async (env: Record<string, string>, full: boolean) => {
		const chunks: Uint8Array[] = [];
		const proc = Bun.spawn([binary, "__tui-demo", "--speed", "4"], {
			env,
			terminal: { cols: 140, rows: 40, data: (_t, data) => chunks.push(data) },
		});
		const killer = setTimeout(() => proc.kill("SIGKILL"), 60_000);
		const text = () => Buffer.concat(chunks).toString("utf8");
		const waitFor = async (
			needle: string,
			timeoutMs = 8_000,
		): Promise<boolean> => {
			const until = Date.now() + timeoutMs;
			while (Date.now() < until) {
				if (text().includes(needle)) return true;
				await Bun.sleep(50);
			}
			return false;
		};
		const type = (keys: string) => proc.terminal?.write(keys);
		const steps: Array<[string, boolean]> = [];
		steps.push(["screen up", await waitFor("ask pk anything")]);
		type("why does the loop retry twice?\r");
		steps.push(["turn 1 cost", await waitFor("$0.0012")]);
		await Bun.sleep(300); // turn_end follows the last usage event
		type("fix the retry\r");
		steps.push(["permission panel", await waitFor("PERMISSION")]);
		await Bun.sleep(400);
		type("y");
		await Bun.sleep(700);
		type("y");
		steps.push(["bash result", await waitFor("2 tests failed")]);
		if (full) {
			// The renderer redraws only changed cells, so the full figure shows only on a fresh frame.
			steps.push(["turn 2 cost", await waitFor("$0.0031")]);
			await Bun.sleep(300);
			type("search callers\r");
			steps.push(["error block", await waitFor("rate_limited")]);
		} else {
			await Bun.sleep(300); // let the diff and the last frame land
		}
		type("\x03");
		const exitCode = await proc.exited;
		clearTimeout(killer);
		await Bun.sleep(100);
		proc.terminal?.close();
		const missed = steps.filter(([, ok]) => !ok).map(([name]) => name);
		return { exitCode, output: text(), missed };
	};
	{
		const demo = await playDemo(demoBase, true);
		const { output } = demo;
		const restoredDemo =
			output.lastIndexOf("\x1b[?1049l") > output.lastIndexOf("\x1b[?1049h") &&
			output.lastIndexOf("\x1b[?25h") > output.lastIndexOf("\x1b[?25l");
		check(
			demo.missed.length === 0,
			"demo: three turns, two prompts answered, the error block",
			`missed ${demo.missed.join(", ")}`,
		);
		check(
			demo.exitCode === 130 && restoredDemo,
			"demo: Ctrl+C exits 130 with the terminal restored",
			`exit ${demo.exitCode}, tail ${JSON.stringify(output.slice(-300))}`,
		);
	}

	// spec 0005 AC-1 and AC-16: real `pk` on a real session. The fake provider asks for read_file on
	// a fixture, the loop runs it, and the answer streams back; Ctrl+C then exits 130, restored.
	{
		const project = join(scratch, "agent-project");
		await mkdir(join(project, ".git"), { recursive: true });
		await Bun.write(join(project, "hello.txt"), "pk e2e fixture\n");
		const callId = "call_01JDX8Z3QK5V7W9Y0A2B4C6D01";
		const usage = {
			type: "usage",
			usage: {
				inputTokens: 10,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				outputTokens: 5,
			},
		};
		const scriptPath = join(scratch, "agent-script.json");
		await Bun.write(
			scriptPath,
			JSON.stringify({
				v: 1,
				steps: [
					{
						events: [
							{ type: "tool_call_start", callId, name: "read_file" },
							{
								type: "tool_call_end",
								callId,
								input: { path: "hello.txt" },
							},
							usage,
							{ type: "stop", reason: "tool_use" },
						],
					},
					{
						events: [
							{ type: "text_delta", text: "FIXTURE-ANSWER-OK" },
							usage,
							{ type: "stop", reason: "end_turn" },
						],
					},
				],
			}),
		);
		const chunks: Uint8Array[] = [];
		const proc = Bun.spawn([binary], {
			cwd: project,
			env: { ...demoBase, PK_FAKE_SCRIPT: scriptPath },
			terminal: { cols: 140, rows: 40, data: (_t, data) => chunks.push(data) },
		});
		const killer = setTimeout(() => proc.kill("SIGKILL"), 30_000);
		const output = () => Buffer.concat(chunks).toString("utf8");
		const waitFor = async (needle: string, timeoutMs = 8_000) => {
			const until = Date.now() + timeoutMs;
			while (Date.now() < until) {
				if (output().includes(needle)) return true;
				await Bun.sleep(50);
			}
			return false;
		};
		const up = await waitFor("ask pk anything");
		proc.terminal?.write("what is in hello.txt?\r");
		const answered = await waitFor("FIXTURE-ANSWER-OK");
		const touched = output().includes("hello.txt");
		await Bun.sleep(300);
		proc.terminal?.write("\x03");
		const exitCode = await proc.exited;
		clearTimeout(killer);
		await Bun.sleep(100);
		proc.terminal?.close();
		const out = output();
		check(
			up && answered && touched,
			"pk: the model reads a fixture through read_file and the answer streams back",
			`screen up ${up}, answered ${answered}, hello.txt shown ${touched}, tail ${JSON.stringify(out.slice(-300))}`,
		);
		check(
			exitCode === 130 &&
				out.lastIndexOf("\x1b[?1049l") > out.lastIndexOf("\x1b[?1049h") &&
				out.lastIndexOf("\x1b[?25h") > out.lastIndexOf("\x1b[?25l"),
			"pk: Ctrl+C closes the session and exits 130 with the terminal restored",
			`exit ${exitCode}, tail ${JSON.stringify(out.slice(-300))}`,
		);
	}

	// spec 0003 AC-3 and AC-4: the color codes the binary actually writes, per color depth.
	{
		/** Every SGR sequence in the output, split into its parameters. */
		const sgr = (output: string) =>
			output
				.split("\x1b[")
				.slice(1)
				.flatMap((part) => /^([0-9;]*)m/.exec(part)?.[1] ?? []);
		const has = (codes: string[], re: RegExp) => codes.some((c) => re.test(c));
		const play = async (name: string, env: Record<string, string>) => {
			const run = await playDemo(env, false);
			if (run.missed.length > 0 || run.exitCode !== 130)
				check(
					false,
					`${name}: demo played`,
					`missed ${run.missed.join(", ")}, exit ${run.exitCode}`,
				);
			return sgr(run.output);
		};
		const { COLORTERM: _unset, ...noColorterm } = demoBase;

		const c16 = await play("16 colors", { ...noColorterm, TERM: "xterm" });
		const rgb16 = c16.filter((c) => /(^|;)[34]8;2;/.test(c));
		check(
			rgb16.length === 0 &&
				has(c16, /(^|;)38;5;3$/) &&
				has(c16, /(^|;)38;5;2$/) &&
				has(c16, /(^|;)38;5;1$/) &&
				!has(c16, /(^|;)48;5;/),
			"16 colors (TERM=xterm, no COLORTERM): amber, green and red are palette slots 3, 2 and 1; no RGB; the background is the terminal's",
			`RGB codes ${JSON.stringify(rgb16.slice(0, 5))}, background codes ${JSON.stringify(c16.filter((c) => /(^|;)48;/.test(c)).slice(0, 5))}`,
		);

		const tc = await play("truecolor", { ...demoBase, COLORTERM: "truecolor" });
		check(
			has(tc, /(^|;)48;2;7;8;10$/),
			"truecolor (COLORTERM=truecolor): the canvas is #07080A",
		);

		const nc = await play("NO_COLOR", {
			...demoBase,
			COLORTERM: "truecolor",
			NO_COLOR: "1",
		});
		// OpenTUI clears blank cells with a white foreground; on a space it never shows.
		const shown = nc.filter(
			(c) => /(^|;)[34]8;/.test(c) && c !== "38;2;255;255;255",
		);
		check(
			shown.length === 0 && !has(nc, /(^|;)48;/),
			"NO_COLOR: no colors, the terminal's own background",
			JSON.stringify(shown.slice(0, 5)),
		);

		const termHome = await caseHome("background-terminal");
		await mkdir(termHome.home, { recursive: true, mode: 0o700 });
		await Bun.write(
			join(termHome.home, "settings.json"),
			JSON.stringify({ ui: { background: "terminal" } }),
		);
		const tb = await play("ui.background terminal", {
			...demoBase,
			COLORTERM: "truecolor",
			PK_HOME: termHome.home,
		});
		check(
			!has(tb, /(^|;)48;2;7;8;10$/) && has(tb, /(^|;)38;2;/),
			'ui.background "terminal" in truecolor: colors stay, the canvas is the terminal\'s',
		);
	}

	// 3. Native library home.
	const libraryIn = (dir: string) =>
		entriesOf(dir).some((name) => name.startsWith(".bun-"));

	// (1) Read only, empty TMPDIR; your BUN_TMPDIR unset, empty, then set: exec, private folder, restore.
	const userBunTmp = join(scratch, "user-bun-tmp");
	await mkdir(userBunTmp);
	for (const [label, bunTmp] of [
		["unset", undefined],
		["empty", ""],
		["set", userBunTmp],
	] as const) {
		const c = await caseHome(`case1-${label}`);
		const run = await runSmoke({
			...base,
			PK_HOME: c.home,
			TMPDIR: readOnlyTmp,
			BUN_TMPDIR: bunTmp,
		});
		const r = run.result;
		const name = `(1) read only TMPDIR, BUN_TMPDIR ${label}`;
		check(
			run.exitCode === 0 && r !== undefined,
			`${name}: smoke exits 0`,
			`exit ${run.exitCode}, tail ${tailOf(run)}`,
		);
		check(entriesOf(readOnlyTmp).length === 0, `${name}: TMPDIR still empty`);
		check(
			modeOf(c.target) === "700" && libraryIn(c.target),
			`${name}: library in <PK_HOME>/native/<id>/ (mode 0700)`,
			`mode ${entriesOf(c.target).length ? modeOf(c.target) : "missing"}, entries ${entriesOf(c.target).join(", ")}`,
		);
		if (r) {
			check(
				r.pid === run.pid,
				`${name}: same PID (an exec, not a child)`,
				`spawned ${run.pid}, smoke ${r.pid}`,
			);
			check(
				r.native === c.target,
				`${name}: BUN_TMPDIR was the private folder`,
				`native=${r.native}`,
			);
			check(
				r.BUN_TMPDIR === (bunTmp ?? null) &&
					r.PK_NATIVE_DIR === null &&
					r.PK_USER_BUN_TMPDIR === null,
				`${name}: your BUN_TMPDIR restored, markers gone`,
				JSON.stringify(r),
			);
		}
	}
	check(
		entriesOf(userBunTmp).length === 0,
		"(1) nothing written to your own BUN_TMPDIR",
	);

	// (2) A stale PK_NATIVE_DIR equal to the target, without BUN_TMPDIR: still execs.
	{
		const c = await caseHome("case2");
		const run = await runSmoke({
			...base,
			PK_HOME: c.home,
			TMPDIR: readOnlyTmp,
			PK_NATIVE_DIR: c.target,
		});
		check(
			run.exitCode === 0 && libraryIn(c.target) && run.result?.pid === run.pid,
			"(2) stale PK_NATIVE_DIR alone is not trusted: execs, library in the private folder",
			`exit ${run.exitCode}, tail ${tailOf(run)}`,
		);
		check(
			run.result?.PK_NATIVE_DIR === null,
			"(2) marker gone after the restore",
		);
	}

	if (isRoot) {
		console.log(
			"skip (3), (4), (5): running as root, which ignores permissions",
		);
	} else {
		// (3) <PK_HOME>/native created beforehand as 0755.
		{
			const c = await caseHome("case3");
			await mkdir(c.nativeRoot, { recursive: true, mode: 0o700 });
			await chmod(c.nativeRoot, 0o755);
			const run = await runSmoke({
				...base,
				PK_HOME: c.home,
				TMPDIR: readOnlyTmp,
			});
			check(
				run.exitCode === 1 && run.output.includes(c.nativeRoot),
				"(3) native folder with mode 0755: exits 1 naming the folder",
				`exit ${run.exitCode}, tail ${tailOf(run)}`,
			);
			check(entriesOf(readOnlyTmp).length === 0, "(3) TMPDIR still empty");
		}

		// (4) <PK_HOME>/native planted as a symlink.
		{
			const c = await caseHome("case4");
			const planted = join(scratch, "case4", "planted");
			await mkdir(c.home, { mode: 0o700 });
			await mkdir(planted, { mode: 0o700 });
			await symlink(planted, c.nativeRoot);
			const run = await runSmoke({
				...base,
				PK_HOME: c.home,
				TMPDIR: readOnlyTmp,
			});
			check(
				run.exitCode === 1 && run.output.includes("symlink"),
				"(4) native folder is a symlink: exits 1",
				`exit ${run.exitCode}, tail ${tailOf(run)}`,
			);
			check(
				entriesOf(planted).length === 0,
				"(4) nothing written at the link's target",
			);
		}

		// (5) PK_HOME inside a folder others can write (0777, no sticky bit).
		{
			const open = join(scratch, "case5-open");
			await mkdir(open);
			await chmod(open, 0o777);
			const run = await runSmoke({
				...base,
				PK_HOME: join(open, "home"),
				TMPDIR: readOnlyTmp,
			});
			check(
				run.exitCode === 1 &&
					run.output.includes("can be changed by other users"),
				"(5) PK_HOME inside a 0777 folder: exits 1",
				`exit ${run.exitCode}, tail ${tailOf(run)}`,
			);
			await chmod(open, 0o700);
		}
	}

	// (6) PK_HOME reached through a symlinked parent folder.
	{
		const real = join(scratch, "case6-real");
		const link = join(scratch, "case6-link");
		await mkdir(real, { mode: 0o700 });
		await symlink(real, link);
		const run = await runSmoke({
			...base,
			PK_HOME: join(link, "home"),
			TMPDIR: readOnlyTmp,
		});
		const expected = join(real, "home", "native", nativeId);
		check(
			run.exitCode === 0 &&
				run.result?.native === expected &&
				libraryIn(expected),
			"(6) symlinked PK_HOME parent works; BUN_TMPDIR held the resolved path",
			`exit ${run.exitCode}, native=${run.result?.native}, tail ${tailOf(run)}`,
		);
	}

	// (7) Two smokes started at the same moment on a fresh PK_HOME.
	{
		const c = await caseHome("case7");
		const smokeEnv = { ...base, PK_HOME: c.home, TMPDIR: readOnlyTmp };
		const [a, b] = await Promise.all([runSmoke(smokeEnv), runSmoke(smokeEnv)]);
		console.log(
			`info (7) concurrent smokes exited ${a.exitCode} and ${b.exitCode}; library files: ${entriesOf(c.target).join(", ")}`,
		);
		check(
			a.exitCode === 0 && b.exitCode === 0,
			"(7) two smokes at the same moment both exit 0",
			`tails ${tailOf(a)} / ${tailOf(b)}`,
		);
	}
} finally {
	// Put permissions back so the scratch folder can be removed.
	for (const dir of [readOnlyTmp, join(scratch, "case3", "home", "native")]) {
		await chmod(dir, 0o700).catch(() => {});
	}
	if (statSync(scratch, { throwIfNoEntry: false })) {
		await rm(scratch, { recursive: true, force: true });
	}
}

if (failures > 0) {
	console.error(`${failures} e2e check(s) failed`);
	process.exit(1);
}
console.log("e2e passed");
