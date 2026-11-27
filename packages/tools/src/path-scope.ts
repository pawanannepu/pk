import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import { fsErrorCode, ToolError } from "./errors.ts";
import type { FileSystem } from "./tool.ts";

/** A path checked to be inside the project root. */
export interface ScopedPath {
	/** The real absolute path: the target's realpath, or its nearest existing parent's plus the rest. */
	readonly real: string;
	/** The real path relative to the root (`.` for the root itself), for result texts and the FILES rail. */
	readonly display: string;
	/** False when the target does not exist. */
	readonly exists: boolean;
}

/** True when a `relative()` result leaves its base. */
function escapes(rel: string): boolean {
	return rel === ".." || rel.startsWith("../") || isAbsolute(rel);
}

/** The AC-12 refusal text. */
export function outsideText(input: string, root: string, tool: string): string {
	return `${input} is outside the project (${root}). ${tool} can only read files inside the project for now.`;
}

/** The realpath of `target`, or of its nearest existing parent plus the missing rest. */
async function realOrNearest(
	target: string,
	fs: FileSystem,
	display: string,
): Promise<{ real: string; exists: boolean }> {
	const missing: string[] = [];
	let current = target;
	for (;;) {
		try {
			const real = await fs.realpath(current);
			return {
				real: missing.length === 0 ? real : join(real, ...missing.toReversed()),
				exists: missing.length === 0,
			};
		} catch (error) {
			const code = fsErrorCode(error);
			if (code === "EACCES" || code === "EPERM") {
				throw new ToolError(
					"tool.access_denied",
					`pk is not allowed to read ${display}.`,
				);
			}
			if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
			const parent = dirname(current);
			if (parent === current) throw error;
			missing.push(basename(current));
			current = parent;
		}
	}
}

/**
 * Resolves a tool's `path` input inside the project (spec 0005 AC-12). A relative path resolves
 * against the root and is refused before the disk is touched when it leaves it through `..`. Every
 * path is then checked on its real path against the real root, so a symlink cannot lead outside.
 * `~` is not expanded. Throws `ToolError` `tool.outside_project` or `tool.access_denied`.
 */
export async function resolveInProject(
	input: string,
	projectRoot: string,
	fs: FileSystem,
	tool: string,
): Promise<ScopedPath> {
	const outside = () =>
		new ToolError(
			"tool.outside_project",
			outsideText(input, projectRoot, tool),
		);
	let target: string;
	if (isAbsolute(input)) {
		target = resolve(input);
	} else {
		target = resolve(projectRoot, input);
		if (escapes(relative(projectRoot, target))) throw outside();
	}
	const root = await fs.realpath(projectRoot);
	const { real, exists } = await realOrNearest(target, fs, input);
	const rel = relative(root, real);
	if (escapes(rel)) throw outside();
	return { real, display: rel === "" ? "." : rel, exists };
}
