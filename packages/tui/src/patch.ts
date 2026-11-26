const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

/** A unified patch cut for display, and how many patch lines were cut. */
export interface CutPatch {
	readonly patch: string;
	readonly cut: number;
}

/**
 * Cuts a unified patch to its file headers plus at most `max` patch lines (context, added, removed;
 * `@@` hunk headers do not count) (AC-12). The last kept hunk's header is rewritten to the kept
 * lines, so the result still parses. `cut` is the number of patch lines left out.
 */
export function cutPatch(patch: string, max: number): CutPatch {
	const lines = patch.replace(/\n$/, "").split("\n");
	const firstHunk = lines.findIndex((line) => HUNK.test(line));
	if (firstHunk < 0) return { patch, cut: 0 };
	const headers = lines.slice(0, firstHunk);
	const body = lines.slice(firstHunk);
	const isPatchLine = (line: string) =>
		!HUNK.test(line) && !line.startsWith("\\");
	const total = body.filter(isPatchLine).length;
	if (total <= max) return { patch, cut: 0 };

	const hunks: {
		oldStart: string;
		newStart: string;
		rest: string;
		lines: string[];
	}[] = [];
	for (const line of body) {
		const match = HUNK.exec(line);
		if (match) {
			hunks.push({
				oldStart: match[1] ?? "1",
				newStart: match[2] ?? "1",
				rest: match[3] ?? "",
				lines: [],
			});
		} else hunks.at(-1)?.lines.push(line);
	}

	let budget = max;
	const kept: string[] = [];
	for (const hunk of hunks) {
		if (budget <= 0) break;
		const taken: string[] = [];
		for (const line of hunk.lines) {
			if (isPatchLine(line)) {
				if (budget <= 0) break;
				budget -= 1;
			}
			taken.push(line);
		}
		const oldCount = taken.filter(
			(l) => l.startsWith(" ") || l.startsWith("-"),
		).length;
		const newCount = taken.filter(
			(l) => l.startsWith(" ") || l.startsWith("+"),
		).length;
		kept.push(
			`@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@${hunk.rest}`,
			...taken,
		);
	}
	return { patch: `${[...headers, ...kept].join("\n")}\n`, cut: total - max };
}
