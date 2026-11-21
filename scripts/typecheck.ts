/**
 * Runs `tsc --noEmit` in every workspace package, each with its own tsconfig. Per package configs
 * are what make a `Bun.*` call in a core package a type error (core packages get Node types only).
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const packagesDir = join(ROOT, "packages");
const packages = readdirSync(packagesDir, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.sort();

const tsc = join(ROOT, "node_modules/.bin/tsc");
const projects = [
	...packages.map((name) => ({
		name: `@pk/${name}`,
		dir: join(packagesDir, name),
	})),
];
projects.push({ name: "scripts", dir: join(ROOT, "scripts") });
// Colocated tests, checked together with Bun's types (they import bun:test).
projects.push({ name: "tests", dir: join(ROOT, "tsconfig.test.json") });

const results = await Promise.all(
	projects.map(async ({ name, dir }) => {
		const proc = Bun.spawn([tsc, "--noEmit", "-p", dir], {
			cwd: ROOT,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [out, err, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return { name, code, output: `${out}${err}`.trim() };
	}),
);

let failed = 0;
for (const { name, code, output } of results) {
	if (code === 0) {
		console.log(`ok   ${name}`);
	} else {
		failed++;
		console.log(`FAIL ${name}\n${output}\n`);
	}
}
if (failed > 0) {
	console.error(`typecheck failed in ${failed} package(s)`);
	process.exit(1);
}
