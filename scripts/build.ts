/**
 * Compiles `pk` into one standalone binary per target (spec 0001, "Packaging").
 *
 *   bun run build                          # the host target
 *   bun run build --target bun-linux-arm64 # one named target
 *
 * Each target is meant to be built on its own OS and CPU (see .github/workflows/build.yml), so the
 * runner's own OpenTUI native package is the one that gets embedded.
 */
import { readdirSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import solidPlugin from "@opentui/solid/bun-plugin";

export const TARGETS = {
	"bun-darwin-arm64": { os: "darwin", arch: "arm64" },
	"bun-darwin-x64-baseline": { os: "darwin", arch: "x64" },
	"bun-linux-x64-baseline": { os: "linux", arch: "x64" },
	"bun-linux-arm64": { os: "linux", arch: "arm64" },
} as const;

export type TargetName = keyof typeof TARGETS;

const ROOT = join(import.meta.dir, "..");
const ENTRY = join(ROOT, "packages/cli/src/main.ts");

export function hostTarget(): TargetName {
	const match = (Object.keys(TARGETS) as TargetName[]).find(
		(name) =>
			TARGETS[name].os === process.platform &&
			TARGETS[name].arch === process.arch,
	);
	if (!match)
		throw new Error(
			`No pk build target for host ${process.platform}-${process.arch}`,
		);
	return match;
}

export function outfileFor(target: TargetName): string {
	const { os, arch } = TARGETS[target];
	return join(ROOT, "dist", `pk-${os}-${arch}`);
}

/**
 * `<opentui version>-<first 12 hex of the SHA 256 of the native library>`: the name of pk's private
 * folder for this library (spec 0001, "Native library home"). The same library always maps to the
 * same folder. It reads the target's own `@opentui/core-<os>-<arch>` package, which is installed
 * because each target is built on its own runner.
 */
export async function nativeLibraryId(target: TargetName): Promise<string> {
	const { os, arch } = TARGETS[target];
	const pkg = join(ROOT, "node_modules/@opentui", `core-${os}-${arch}`);
	const library = readdirSync(pkg).find((name) =>
		/^libopentui\.(dylib|so)$/.test(name),
	);
	if (!library) {
		throw new Error(
			`No OpenTUI native library in ${pkg}. Build each target on its own OS and CPU.`,
		);
	}
	const { version } = (await Bun.file(
		join(ROOT, "node_modules/@opentui/core/package.json"),
	).json()) as { version: string };
	const hash = new Bun.CryptoHasher("sha256")
		.update(await Bun.file(join(pkg, library)).arrayBuffer())
		.digest("hex");
	return `${version}-${hash.slice(0, 12)}`;
}

export async function build(target: TargetName): Promise<string> {
	const { version } = (await Bun.file(join(ROOT, "package.json")).json()) as {
		version: string;
	};
	const outfile = outfileFor(target);
	await mkdir(join(ROOT, "dist"), { recursive: true });

	const define: Record<string, string> = {
		PK_VERSION: JSON.stringify(version),
		PK_NATIVE_ID: JSON.stringify(await nativeLibraryId(target)),
	};
	// Lets Bun drop OpenTUI's musl branch and embed only the glibc native library.
	if (TARGETS[target].os === "linux")
		define["process.env.OPENTUI_LIBC"] = JSON.stringify("glibc");

	const result = await Bun.build({
		entrypoints: [ENTRY],
		plugins: [solidPlugin],
		minify: true,
		define,
		compile: {
			target,
			outfile,
			// A user's project .env or bunfig.toml must never be loaded into pk.
			autoloadDotenv: false,
			autoloadBunfig: false,
		},
	});

	if (!result.success) {
		for (const log of result.logs) console.error(log);
		throw new Error(`build failed for ${target}`);
	}
	return outfile;
}

if (import.meta.main) {
	const { values } = parseArgs({
		args: Bun.argv.slice(2),
		options: { target: { type: "string" } },
	});
	const target = (values.target ?? hostTarget()) as TargetName;
	if (!(target in TARGETS)) {
		console.error(
			`Unknown target "${target}". Known: ${Object.keys(TARGETS).join(", ")}`,
		);
		process.exit(2);
	}
	const started = performance.now();
	const outfile = await build(target);
	const { size } = await stat(outfile);
	const ms = Math.round(performance.now() - started);
	console.log(
		`built ${outfile} (${target}, ${(size / 1024 / 1024).toFixed(1)} MB, ${ms} ms)`,
	);
}
