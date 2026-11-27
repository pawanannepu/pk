import { readFile, realpath, stat } from "node:fs/promises";
import {
	type AgentSession,
	createAgentSession,
	DEFAULT_MAX_TURNS,
	localDate,
} from "@pk/agent";
import { createIdFactory, type Logger } from "@pk/env";
import type { ModelRef, Settings } from "@pk/schema";
import { type FileSystem, readFileTool } from "@pk/tools";
import {
	createProviderRegistry,
	createSetTimer,
	createSleep,
	loadFakeScript,
} from "./providers.ts";

/** The `FileSystem` port tools read through, from `node:fs/promises`. Errors keep their Node `code`. */
export function nodeFileSystem(): FileSystem {
	return {
		realpath: (path) => realpath(path),
		stat: async (path) => {
			const s = await stat(path);
			return {
				kind: s.isFile() ? "file" : s.isDirectory() ? "directory" : "other",
				size: s.size,
				mtimeMs: s.mtimeMs,
			};
		},
		readFile: (path) => readFile(path),
	};
}

/** What `prepareSession` needs from the composition root. */
export interface SessionSetupInput {
	readonly settings: Settings;
	/** The project root, as a real path. */
	readonly projectRoot: string;
	readonly getEnv: (name: string) => string | undefined;
	readonly userSettingsPath: string;
	readonly logger: Logger;
}

/** A session ready for the screen, and the model it talks to. */
export interface PreparedSession {
	readonly session: AgentSession;
	readonly model: ModelRef;
}

/**
 * Steps 3 to 6 of spec 0005 AC-16, in order: `loadFakeScript`, the registry, `mainModel()`,
 * `providerFor(main)`. Then builds the session. Any `ProviderError` is thrown for the caller to print
 * as `pk: <message>`. A missing API key is not checked here: the first turn reports it.
 */
export async function prepareSession(
	input: SessionSetupInput,
): Promise<PreparedSession> {
	const fakeScript = await loadFakeScript(input.getEnv, (path) =>
		readFile(path, "utf8"),
	);
	const newId = createIdFactory({
		now: Date.now,
		randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
	});
	const registry = createProviderRegistry(input.settings, {
		getEnv: input.getEnv,
		newId,
		logger: input.logger,
		sleep: createSleep((fire, ms) => setTimeout(fire, ms), clearTimeout),
		random: Math.random,
		now: Date.now,
		setTimer: createSetTimer((fire, ms) => setTimeout(fire, ms), clearTimeout),
		userSettingsPath: input.userSettingsPath,
		...(fakeScript === undefined ? {} : { fakeScript }),
	});
	const model = registry.mainModel();
	const provider = registry.providerFor(model);
	const session = createAgentSession({
		provider,
		model,
		tools: [readFileTool],
		fs: nodeFileSystem(),
		projectRoot: input.projectRoot,
		today: localDate(
			Date.now(),
			Intl.DateTimeFormat().resolvedOptions().timeZone,
		),
		maxTurns: input.settings.limits?.maxTurns ?? DEFAULT_MAX_TURNS,
		newId,
		now: Date.now,
		logger: input.logger,
	});
	return { session, model };
}

/** Closes the session, waiting at most `ms` (1 s by default) so a stuck turn never holds up an exit. */
export async function closeWithin(
	session: AgentSession,
	ms = 1000,
): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, ms);
	});
	try {
		await Promise.race([session.close(), timeout]);
	} finally {
		clearTimeout(timer);
	}
}
