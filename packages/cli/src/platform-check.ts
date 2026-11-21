import { existsSync, readdirSync } from "node:fs";

export interface PlatformProbe {
	readonly platform: NodeJS.Platform;
	readonly fileExists: (path: string) => boolean;
	readonly listDir: (path: string) => readonly string[];
}

const realProbe: PlatformProbe = {
	platform: process.platform,
	fileExists: existsSync,
	listDir: (path) => {
		try {
			return readdirSync(path);
		} catch {
			return [];
		}
	},
};

/**
 * Returns a message when pk is running somewhere it does not support, so it can exit with a clear
 * reason instead of a native library crash. Supported: macOS 13+ and glibc Linux (spec 0001).
 */
export function unsupportedPlatformMessage(
	probe: PlatformProbe = realProbe,
): string | undefined {
	if (probe.platform === "linux" && isMusl(probe)) {
		return "pk does not support musl based Linux (such as Alpine) yet. Please use a glibc based distribution (glibc 2.35 or later).";
	}
	if (probe.platform === "win32") {
		return "pk does not support Windows yet. It runs on macOS and on glibc based Linux.";
	}
	return undefined;
}

function isMusl(probe: PlatformProbe): boolean {
	if (probe.fileExists("/etc/alpine-release")) return true;
	return ["/lib", "/usr/lib"].some((dir) =>
		probe.listDir(dir).some((name) => name.startsWith("ld-musl-")),
	);
}
