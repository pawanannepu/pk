import { afterAll, describe, expect, test } from "bun:test";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Spec 0001, "Dependency rules" and "Module map". The script reads packages/ next to its own
// folder, so each case copies it into a temp tree beside a small fixture workspace and runs it.

const SCRIPT = join(import.meta.dir, "check-boundaries.ts");
const roots: string[] = [];

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});

type Files = Record<string, string>;

const manifest = (
	name: string,
	deps: Record<string, string> = {},
	extra = {},
) => JSON.stringify({ name: `@pk/${name}`, dependencies: deps, ...extra });

/** A clean two package workspace: env depends on schema, the way the module map allows. */
const BASE: Files = {
	"packages/schema/package.json": manifest("schema", { zod: "4.0.0" }),
	"packages/schema/src/index.ts":
		'import { z } from "zod";\nexport const id = z.string();\n',
	"packages/env/package.json": manifest("env", { "@pk/schema": "workspace:*" }),
	"packages/env/src/index.ts":
		'import { join } from "node:path";\nimport { id } from "@pk/schema";\nimport { local } from "./local.ts";\nexport const all = [join, id, local];\n',
	"packages/env/src/local.ts": "export const local = 1;\n",
};

function run(files: Files): { code: number; out: string } {
	const root = mkdtempSync(join(tmpdir(), "pk-boundaries-"));
	roots.push(root);
	mkdirSync(join(root, "scripts"));
	copyFileSync(SCRIPT, join(root, "scripts", "check-boundaries.ts"));
	for (const [path, content] of Object.entries({ ...BASE, ...files })) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}
	const proc = Bun.spawnSync(
		[process.execPath, join(root, "scripts", "check-boundaries.ts")],
		{ cwd: root, stdout: "pipe", stderr: "pipe" },
	);
	return {
		code: proc.exitCode ?? -1,
		out: proc.stdout.toString() + proc.stderr.toString(),
	};
}

const envSource = (body: string) => ({ "packages/env/src/index.ts": body });

describe("check-boundaries: a clean workspace", () => {
	test("passes and counts the packages", () => {
		const result = run({});

		expect(result.code).toBe(0);
		expect(result.out).toContain(
			"Boundary check passed: 2 packages, no violations.",
		);
	});

	test("a core package's test file may import bun:test", () => {
		const result = run({
			"packages/env/src/index.test.ts":
				'import { test } from "bun:test";\ntest("x", () => {});\n',
		});

		expect(result.code).toBe(0);
	});

	test("Bun. inside a comment does not count as using Bun", () => {
		const result = run(
			envSource(
				"// call Bun.spawn later\n/** Unlike Bun.file, this stays neutral. */\nexport const x = 1;\n",
			),
		);

		expect(result.code).toBe(0);
	});

	test("a shebang line does not break the scan", () => {
		const result = run(envSource("#!/usr/bin/env bun\nexport const x = 1;\n"));

		expect(result.code).toBe(0);
	});
});

describe("check-boundaries: imports", () => {
	test("an undeclared import fails and names the file", () => {
		const result = run(
			envSource('import { z } from "zod";\nexport const x = z;\n'),
		);

		expect(result.code).toBe(1);
		expect(result.out).toContain(
			'packages/env/src/index.ts: imports "zod" but @pk/env/package.json does not declare it',
		);
	});

	test("an undeclared type only import is caught too", () => {
		const result = run(
			envSource(
				'import type { ZodType } from "zod";\nexport type T = ZodType;\n',
			),
		);

		expect(result.code).toBe(1);
		expect(result.out).toContain(
			'imports "zod" but @pk/env/package.json does not declare it',
		);
	});

	test("an undeclared dynamic import is caught", () => {
		const result = run(envSource('export const load = () => import("zod");\n'));

		expect(result.code).toBe(1);
		expect(result.out).toContain('imports "zod"');
	});

	test("an undeclared re-export is caught", () => {
		const result = run(envSource('export { z } from "zod";\n'));

		expect(result.code).toBe(1);
		expect(result.out).toContain('imports "zod"');
	});

	test("a deep import into another @pk package fails", () => {
		const result = run(
			envSource(
				'import { id } from "@pk/schema/src/index.ts";\nexport const x = id;\n',
			),
		);

		expect(result.code).toBe(1);
		expect(result.out).toContain(
			'deep import "@pk/schema/src/index.ts"; use the package entry "@pk/schema"',
		);
	});

	test("a package importing itself by name fails", () => {
		const result = run(
			envSource('import { local } from "@pk/env";\nexport const x = local;\n'),
		);

		expect(result.code).toBe(1);
		expect(result.out).toContain(
			'imports its own package "@pk/env"; use a relative import',
		);
	});

	test("a relative import that reaches outside the package fails", () => {
		const result = run(
			envSource(
				'import { id } from "../../schema/src/index.ts";\nexport const x = id;\n',
			),
		);

		expect(result.code).toBe(1);
		expect(result.out).toContain(
			"reaches outside its package; import @pk/<name> instead",
		);
	});
});

describe("check-boundaries: runtime neutral core packages", () => {
	test("importing bun in a core package fails", () => {
		const result = run(
			envSource('import { $ } from "bun";\nexport const x = $;\n'),
		);

		expect(result.code).toBe(1);
		expect(result.out).toContain('core packages must not import "bun"');
	});

	test("importing bun:test outside a test file fails", () => {
		const result = run(
			envSource('import { test } from "bun:test";\nexport const x = test;\n'),
		);

		expect(result.code).toBe(1);
		expect(result.out).toContain('core packages must not import "bun:test"');
	});

	test("using the Bun global in a core package fails", () => {
		const result = run(envSource("export const v = Bun.version;\n"));

		expect(result.code).toBe(1);
		expect(result.out).toContain(
			"packages/env/src/index.ts: core packages must not use Bun.*",
		);
	});

	test("JSX outside packages/tui fails", () => {
		const result = run({
			"packages/env/src/view.tsx":
				"export const View = () => <text>hi</text>;\n",
		});

		expect(result.code).toBe(1);
		expect(result.out).toContain(
			"packages/env/src/view.tsx: JSX (.tsx) is only allowed in packages/tui",
		);
	});
});

describe("check-boundaries: package manifests", () => {
	test("a dependency the module map does not allow fails", () => {
		const result = run({
			"packages/env/package.json": manifest("env", {
				"@pk/schema": "workspace:*",
				"@pk/agent": "workspace:*",
			}),
		});

		expect(result.code).toBe(1);
		expect(result.out).toContain(
			"@pk/env may not depend on @pk/agent (spec 0001 module map)",
		);
	});

	test("an external dependency the module map does not allow fails", () => {
		const result = run({
			"packages/env/package.json": manifest("env", {
				"@pk/schema": "workspace:*",
				"left-pad": "1.0.0",
			}),
		});

		expect(result.code).toBe(1);
		expect(result.out).toContain("@pk/env may not depend on left-pad");
	});

	test("a @pk dependency must use workspace:*", () => {
		const result = run({
			"packages/env/package.json": manifest("env", { "@pk/schema": "^0.0.0" }),
		});

		expect(result.code).toBe(1);
		expect(result.out).toContain('@pk/env: @pk/schema must be "workspace:*"');
	});

	test("devDependencies in a package fail", () => {
		const result = run({
			"packages/env/package.json": manifest(
				"env",
				{ "@pk/schema": "workspace:*" },
				{ devDependencies: { typescript: "7.0.2" } },
			),
		});

		expect(result.code).toBe(1);
		expect(result.out).toContain(
			"packages/env/package.json: devDependencies is not used in packages",
		);
	});

	test("a package name that does not match its folder fails", () => {
		const result = run({
			"packages/env/package.json": JSON.stringify({
				name: "env",
				dependencies: { "@pk/schema": "workspace:*" },
			}),
		});

		expect(result.code).toBe(1);
		expect(result.out).toContain(
			'packages/env/package.json: name must be "@pk/env"',
		);
	});

	test("a package missing from the module map fails", () => {
		const result = run({
			"packages/extras/package.json": manifest("extras"),
			"packages/extras/src/index.ts": "export {};\n",
		});

		expect(result.code).toBe(1);
		expect(result.out).toContain(
			"packages/extras: not in spec 0001's module map",
		);
	});

	test("a cycle in the @pk dependency graph is reported", () => {
		const result = run({
			"packages/schema/package.json": manifest("schema", {
				zod: "4.0.0",
				"@pk/env": "workspace:*",
			}),
		});

		expect(result.code).toBe(1);
		expect(result.out).toMatch(
			/dependency cycle: @pk\/(schema|env) -> @pk\/(env|schema) -> @pk\/\1/,
		);
	});

	test("every violation is listed, each once, with the total", () => {
		const result = run({
			"packages/env/src/index.ts":
				'import { z } from "zod";\nimport { y } from "zod";\nexport const v = [z, y, Bun.version];\n',
		});

		expect(result.code).toBe(1);
		expect(result.out).toContain("Boundary check failed (2):");
		expect(result.out.match(/does not declare it/g)?.length).toBe(1);
	});
});
