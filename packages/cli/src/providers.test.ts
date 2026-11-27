import { describe, expect, test } from "bun:test";
import { createIdFactory, loadSettings, silentLogger } from "@pk/env";
import { ProviderError, type Sleep } from "@pk/provider";
import {
	checkStreamOrder,
	MessageId,
	type ModelRequest,
	type ProviderStreamEvent,
	type Settings,
} from "@pk/schema";
import {
	createProviderRegistry,
	createSetTimer,
	createSleep,
	loadFakeScript,
	type RegistryDeps,
} from "./providers.ts";

const SETTINGS_PATH = "/home/u/.config/pk/settings.json";
const SSE = [
	`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Hi" } }] })}`,
	`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
	"data: [DONE]",
	"",
].join("\n\n");

function deps(
	over: Partial<RegistryDeps> & { env?: Record<string, string> } = {},
) {
	const seen: { url: string; headers: Headers }[] = [];
	const sleep: Sleep = async () => {};
	const base: RegistryDeps = {
		getEnv: (name) => over.env?.[name],
		newId: createIdFactory({
			now: () => 1_700_000_000_000,
			randomBytes: (n) => new Uint8Array(n),
		}),
		logger: silentLogger,
		sleep,
		random: () => 0.5,
		now: () => 0,
		setTimer: () => () => {},
		userSettingsPath: SETTINGS_PATH,
		fetch: async (input, init) => {
			seen.push({ url: String(input), headers: new Headers(init?.headers) });
			return new Response(SSE, {
				headers: { "content-type": "text/event-stream" },
			});
		},
	};
	return { deps: { ...base, ...over }, seen };
}

const request = (provider: string, model: string): ModelRequest => ({
	model: { provider, model },
	system: "",
	messages: [
		{
			id: MessageId.parse("msg_01JDX8Z3QK5V7W9Y0A2B4C6D01"),
			at: "2026-11-27T10:00:00.000Z",
			role: "user",
			content: [{ type: "text", text: "hi" }],
		},
	],
	tools: [],
});

async function settle(stream: AsyncIterable<ProviderStreamEvent>) {
	const events: ProviderStreamEvent[] = [];
	try {
		for await (const event of stream) events.push(event);
		return { events, error: undefined as unknown };
	} catch (error) {
		return { events, error };
	}
}

const signal = () => new AbortController().signal;

describe("provider registry (AC-9)", () => {
	test("registry → adapter over a fixture → events, with the built in openai entry", async () => {
		const { deps: d, seen } = deps({
			env: { OPENAI_API_KEY: "sk-test-0123456789abcdefghij" },
		});
		const settings: Settings = {
			model: { main: { provider: "openai", model: "gpt-x" } },
		};
		const registry = createProviderRegistry(settings, d);
		expect(registry.mainModel()).toEqual({
			provider: "openai",
			model: "gpt-x",
		});
		const { events, error } = await settle(
			registry
				.providerFor(registry.mainModel())
				.stream(request("openai", "gpt-x"), { signal: signal() }),
		);
		expect(error).toBeUndefined();
		expect(events).toEqual([
			{ type: "text_delta", text: "Hi" },
			{ type: "stop", reason: "end_turn" },
		]);
		expect(checkStreamOrder(events)).toEqual([]);
		expect(seen[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
	});

	test("an unset key is missing_key at call time; a later export takes effect", async () => {
		const env: Record<string, string> = {};
		const { deps: d } = deps({ env });
		const provider = createProviderRegistry({}, d).providerFor({
			provider: "openai",
			model: "gpt-x",
		});
		const first = await settle(
			provider.stream(request("openai", "gpt-x"), { signal: signal() }),
		);
		expect((first.error as ProviderError).code).toBe("provider.missing_key");
		env.OPENAI_API_KEY = "sk-test-0123456789abcdefghij";
		const second = await settle(
			provider.stream(request("openai", "gpt-x"), { signal: signal() }),
		);
		expect(second.error).toBeUndefined();
	});

	test("Ollama with no key sends Bearer pk-no-key to its own base URL", async () => {
		const { deps: d, seen } = deps();
		const registry = createProviderRegistry(
			{
				providers: {
					ollama: { api: "openai_chat", baseURL: "http://localhost:11434/v1" },
				},
			},
			d,
		);
		await settle(
			registry
				.providerFor({ provider: "ollama", model: "qwen" })
				.stream(request("ollama", "qwen"), { signal: signal() }),
		);
		expect(seen[0]?.url).toBe("http://localhost:11434/v1/chat/completions");
		expect(seen[0]?.headers.get("authorization")).toBe("Bearer pk-no-key");
	});

	test("keychain, unknown provider, anthropic api and no main model each fail clearly", async () => {
		const { deps: d } = deps();
		const registry = createProviderRegistry(
			{
				providers: {
					openai: { api: "openai_chat", apiKey: { keychain: true } },
					claude: { api: "anthropic_messages" },
				},
			},
			d,
		);
		const keychain = await settle(
			registry
				.providerFor({ provider: "openai", model: "x" })
				.stream(request("openai", "x"), { signal: signal() }),
		);
		expect((keychain.error as ProviderError).code).toBe(
			"provider.keychain_unavailable",
		);
		const thrown = (fn: () => unknown): ProviderError => {
			try {
				fn();
			} catch (error) {
				return error as ProviderError;
			}
			throw new ProviderError({
				code: "provider.server",
				message: "expected a throw",
				providerId: "pk",
			});
		};
		const unknown = thrown(() =>
			registry.providerFor({ provider: "groq", model: "x" }),
		);
		expect([unknown.code, unknown.message]).toEqual([
			"provider.unknown_provider",
			`No provider "groq". Add providers.groq to ${SETTINGS_PATH}.`,
		]);
		expect(
			thrown(() => registry.providerFor({ provider: "claude", model: "x" }))
				.code,
		).toBe("provider.unsupported_api");
		const noModel = thrown(() => registry.mainModel());
		expect([noModel.code, noModel.message]).toEqual([
			"provider.no_model",
			`No model set. Add "model": { "main": "openai/<model>" } to ${SETTINGS_PATH}.`,
		]);
	});

	test("a project file cannot redirect the key: providers is user only", async () => {
		const files: Record<string, string> = {
			[SETTINGS_PATH]: JSON.stringify({
				model: { main: "openai/gpt-x" },
				providers: {
					openai: {
						api: "openai_chat",
						baseURL: "https://user.example/v1",
						apiKey: { env: "OPENAI_API_KEY" },
					},
				},
			}),
			"/work/app/.pk/settings.json": JSON.stringify({
				providers: {
					openai: { api: "openai_chat", baseURL: "https://evil.example/v1" },
				},
			}),
		};
		const loaded = await loadSettings({
			userFile: SETTINGS_PATH,
			projectRoot: "/work/app",
			home: "/home/u",
			flags: {},
			skipProject: false,
			readFile: async (path) => files[path],
		});
		const { deps: d, seen } = deps({
			env: { OPENAI_API_KEY: "sk-test-0123456789abcdefghij" },
		});
		const registry = createProviderRegistry(loaded.settings, d);
		await settle(
			registry
				.providerFor(registry.mainModel())
				.stream(request("openai", "gpt-x"), { signal: signal() }),
		);
		expect(seen[0]?.url).toBe("https://user.example/v1/chat/completions");
	});
});

describe("PK_FAKE_SCRIPT (AC-10)", () => {
	const SCRIPT = JSON.stringify({
		v: 1,
		steps: [
			{ error: { code: "provider.overloaded" } },
			{
				events: [
					{ type: "text_delta", text: "scripted" },
					{ type: "stop", reason: "end_turn" },
				],
			},
		],
	});

	test("registry → fake provider (wrapped in withRetry) → events, for any model ref", async () => {
		const script = await loadFakeScript(
			(name) => (name === "PK_FAKE_SCRIPT" ? "/tmp/script.json" : undefined),
			async () => SCRIPT,
		);
		const { deps: d } = deps(
			script === undefined ? {} : { fakeScript: script },
		);
		const registry = createProviderRegistry({}, d);
		expect(registry.mainModel()).toEqual({ provider: "fake", model: "fake" });
		const { events, error } = await settle(
			registry
				.providerFor({ provider: "anything", model: "x" })
				.stream(request("anything", "x"), { signal: signal() }),
		);
		expect(error).toBeUndefined();
		expect(events).toEqual([
			{ type: "text_delta", text: "scripted" },
			{ type: "stop", reason: "end_turn" },
		]);
	});

	test("unset is no script; a bad file is fake_script_invalid", async () => {
		expect(
			await loadFakeScript(
				() => undefined,
				async () => "",
			),
		).toBeUndefined();
		const bad = await loadFakeScript(
			() => "/x.json",
			async () => "{not json",
		).catch((e: unknown) => e);
		expect((bad as ProviderError).code).toBe("provider.fake_script_invalid");
		const invalid = await loadFakeScript(
			() => "/x.json",
			async () => '{"v":1,"steps":[]}',
		).catch((e: unknown) => e);
		expect((invalid as ProviderError).code).toBe(
			"provider.fake_script_invalid",
		);
	});
});

describe("createSleep and createSetTimer", () => {
	test("sleep resolves after the wait, or early on abort, and removes its listener", async () => {
		const sleep = createSleep(
			(fire, ms) => setTimeout(fire, ms),
			(h) => clearTimeout(h),
		);
		const start = Date.now();
		await sleep(5, signal());
		expect(Date.now() - start).toBeGreaterThanOrEqual(4);
		const controller = new AbortController();
		const waiting = sleep(60_000, controller.signal);
		controller.abort();
		await waiting;
		const setTimer = createSetTimer(
			(fire, ms) => setTimeout(fire, ms),
			(h) => clearTimeout(h),
		);
		let fired = false;
		setTimer(1, () => {
			fired = true;
		})();
		await new Promise((r) => setTimeout(r, 5));
		expect(fired).toBe(false);
	});
});
