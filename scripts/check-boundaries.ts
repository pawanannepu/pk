/**
 * Enforces the module map of spec 0001 ("Module map" and "Dependency rules"). Fails on any violation.
 *
 * - Each package may declare only the dependencies its row allows (`@pk/*` and external).
 * - Every import must be declared in the importing package's package.json. No deep imports.
 * - The `@pk/*` dependency graph has no cycles.
 * - Core packages never import `bun` or `bun:*` and never mention `Bun.` (tests may import `bun:test`).
 * - JSX (`.tsx`) lives only in `tui`: its implicit `@opentui/solid` import would bypass these rules.
 *
 * Imports are read with Bun.Transpiler (static, dynamic, `export ... from`) plus a text scan for type
 * only imports, which the transpiler drops.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative } from "node:path";

type Rule = {
	readonly pk: readonly string[];
	readonly external: readonly string[];
	readonly core: boolean;
};

const ALL_PK_EXCEPT = (...excluded: string[]) =>
	Object.keys(RULES).filter((name) => !excluded.includes(name));

/** The "May depend on" column of spec 0001's module map. `core` packages must stay runtime neutral. */
const RULES: Record<string, Rule> = {
	schema: { pk: [], external: ["zod"], core: true },
	env: { pk: ["schema"], external: [], core: true },
	provider: { pk: ["schema", "env"], external: [], core: true },
	"provider-openai": {
		pk: ["provider", "schema", "env"],
		external: ["openai", "zod"], // zod for chunk schemas (spec 0004)
		core: true,
	},
	"provider-anthropic": {
		pk: ["provider", "schema", "env"],
		external: ["@anthropic-ai/sdk"],
		core: true,
	},
	permissions: { pk: ["schema", "env"], external: [], core: true },
	tools: { pk: ["schema", "env"], external: ["zod"], core: true }, // zod for tool input schemas (spec 0005)
	agent: {
		pk: ["schema", "env", "provider", "permissions", "tools"],
		external: [],
		core: true,
	},
	tui: {
		pk: ["schema", "agent", "env"],
		external: ["@opentui/core", "@opentui/solid", "solid-js"],
		core: false,
	},
	headless: { pk: ["schema", "agent", "env"], external: [], core: true },
	// platform implements interfaces declared by core packages; it may depend on any of them.
	platform: {
		pk: [
			"schema",
			"env",
			"provider",
			"permissions",
			"tools",
			"agent",
			"headless",
		],
		external: [],
		core: false,
	},
	cli: { pk: [], external: ["commander"], core: false }, // pk filled below: any @pk/* except bench
	bench: { pk: ["schema"], external: [], core: false },
};
RULES.cli = {
	pk: ALL_PK_EXCEPT("cli", "bench"),
	external: ["commander"],
	core: false,
};

const ROOT = join(import.meta.dir, "..");
const PACKAGES_DIR = join(ROOT, "packages");
const BUILTINS = new Set(builtinModules);
const errorSet = new Set<string>();
const fail = (message: string) => errorSet.add(message);

interface PackageJson {
	name?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
}

function sourceFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules") continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
		else if (/\.(ts|tsx|mts|cts)$/.test(entry) && !entry.endsWith(".d.ts"))
			out.push(path);
	}
	return out;
}

/** The package name an import specifier refers to: `@scope/name/sub` → `@scope/name`, `name/sub` → `name`. */
function packageOf(specifier: string): string {
	const parts = specifier.split("/");
	return specifier.startsWith("@")
		? parts.slice(0, 2).join("/")
		: (parts[0] ?? specifier);
}

const TYPE_ONLY_IMPORT =
	/^\s*(?:import|export)\s+type\s[^;]*?\sfrom\s+["']([^"']+)["']/gm;
const BUN_GLOBAL = /\bBun\./;

function scan(
	file: string,
	source: string,
): { imports: string[]; usesBunGlobal: boolean } {
	const transpiler = new Bun.Transpiler({
		loader: file.endsWith(".tsx") ? "tsx" : "ts",
		// Report JSX as the import it really becomes (tui's tsconfig sets the same jsxImportSource).
		tsconfig: JSON.stringify({
			compilerOptions: { jsx: "react-jsx", jsxImportSource: "@opentui/solid" },
		}),
	});
	const code = source.replace(/^#![^\n]*/, ""); // the transpiler rejects a shebang line
	const found = new Set(
		transpiler.scanImports(code).map((entry) => entry.path),
	);
	// Bun's scanner always appends a bare "react" for JSX files; keep it only if the file really imports it.
	if (!/from\s+["']react["']|import\(\s*["']react["']/.test(source))
		found.delete("react");
	for (const match of source.matchAll(TYPE_ONLY_IMPORT))
		if (match[1]) found.add(match[1]);
	// Scan transpiled code, so a `Bun.` inside a comment or a string of docs does not count.
	const usesBunGlobal = BUN_GLOBAL.test(transpiler.transformSync(code));
	return { imports: [...found], usesBunGlobal };
}

const packageNames = readdirSync(PACKAGES_DIR).filter((name) =>
	existsSync(join(PACKAGES_DIR, name, "package.json")),
);
const graph = new Map<string, string[]>();

for (const name of packageNames) {
	const dir = join(PACKAGES_DIR, name);
	const rule = RULES[name];
	if (!rule) {
		fail(
			`packages/${name}: not in spec 0001's module map. Add it to the spec (/architect) and to RULES here.`,
		);
		continue;
	}

	const manifest = JSON.parse(
		readFileSync(join(dir, "package.json"), "utf8"),
	) as PackageJson;
	if (manifest.name !== `@pk/${name}`)
		fail(`packages/${name}/package.json: name must be "@pk/${name}"`);
	for (const field of [
		"devDependencies",
		"peerDependencies",
		"optionalDependencies",
	] as const) {
		if (manifest[field] && Object.keys(manifest[field]).length > 0) {
			fail(
				`packages/${name}/package.json: ${field} is not used in packages; shared tooling lives in the root`,
			);
		}
	}

	const declared = Object.keys(manifest.dependencies ?? {});
	const pkDeps: string[] = [];
	for (const dep of declared) {
		if (dep.startsWith("@pk/")) {
			const target = dep.slice(4);
			pkDeps.push(target);
			if (!rule.pk.includes(target))
				fail(`@pk/${name} may not depend on ${dep} (spec 0001 module map)`);
			if (manifest.dependencies?.[dep] !== "workspace:*")
				fail(`@pk/${name}: ${dep} must be "workspace:*"`);
		} else if (!rule.external.includes(dep)) {
			fail(`@pk/${name} may not depend on ${dep} (spec 0001 module map)`);
		}
	}
	graph.set(name, pkDeps);

	for (const file of sourceFiles(join(dir, "src"))) {
		const rel = relative(ROOT, file);
		const source = readFileSync(file, "utf8");
		const isTest = /\.test\.tsx?$/.test(file);

		if (file.endsWith(".tsx") && name !== "tui")
			fail(`${rel}: JSX (.tsx) is only allowed in packages/tui`);
		const { imports, usesBunGlobal } = scan(file, source);
		if (rule.core && usesBunGlobal)
			fail(`${rel}: core packages must not use Bun.* (put it in platform)`);

		for (const specifier of imports) {
			if (specifier.startsWith(".") || specifier.startsWith("/")) {
				if (
					specifier.includes("/packages/") ||
					/^(\.\.\/){2,}/.test(specifier)
				) {
					fail(
						`${rel}: relative import "${specifier}" reaches outside its package; import @pk/<name> instead`,
					);
				}
				continue;
			}
			if (specifier === "bun" || specifier.startsWith("bun:")) {
				if (rule.core && !(isTest && specifier === "bun:test")) {
					fail(
						`${rel}: core packages must not import "${specifier}" (only *.test.ts may import bun:test)`,
					);
				}
				continue;
			}
			if (specifier.startsWith("node:") || BUILTINS.has(specifier)) continue;

			const pkg = packageOf(specifier);
			if (pkg.startsWith("@pk/") && specifier !== pkg) {
				fail(
					`${rel}: deep import "${specifier}"; use the package entry "${pkg}"`,
				);
			}
			if (pkg === `@pk/${name}`) {
				fail(`${rel}: imports its own package "${pkg}"; use a relative import`);
			} else if (!declared.includes(pkg)) {
				fail(
					`${rel}: imports "${pkg}" but @pk/${name}/package.json does not declare it`,
				);
			}
		}
	}
}

// Cycles in the declared @pk/* graph.
const visiting = new Set<string>();
const done = new Set<string>();
const walk = (node: string, path: string[]): void => {
	if (done.has(node)) return;
	if (visiting.has(node)) {
		fail(
			`dependency cycle: ${[...path.slice(path.indexOf(node)), node].map((n) => `@pk/${n}`).join(" -> ")}`,
		);
		return;
	}
	visiting.add(node);
	for (const next of graph.get(node) ?? []) walk(next, [...path, node]);
	visiting.delete(node);
	done.add(node);
};
for (const node of graph.keys()) walk(node, []);

const errors = [...errorSet];
if (errors.length > 0) {
	console.error(
		`Boundary check failed (${errors.length}):\n${errors.map((e) => `  - ${e}`).join("\n")}`,
	);
	process.exit(1);
}
console.log(
	`Boundary check passed: ${packageNames.length} packages, no violations.`,
);
