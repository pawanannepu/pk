# Research cache: stack & architecture (checked 2026-11-21)

Landscape check for spec 0001. Reuse until 2026-12-21 unless asked for "latest today".

## Confirmed
- Bun `bun build --compile --target=...` cross compiles (bun-darwin-x64, bun-darwin-arm64, bun-linux-x64, bun-linux-arm64, baseline and musl variants). https://bun.sh/docs/bundler/executables
- Node single executable applications: core "Stability 1.1, Active development"; asset VFS "1.0 Early development" (Node v26 docs). https://nodejs.org/download/release/v26.13.0/docs/api/single-executable-applications.html
- Ink 8.0.0, engines node >=22. https://registry.npmjs.org/ink/latest
- OpenTUI: Zig core with C ABI, `@opentui/core`, SolidJS and React reconcilers; needs Bun (and Zig to build). opencode reportedly runs on it. https://github.com/anomalyco/opentui
- ratatui 0.30.2 (2026-06-19); `Viewport::Inline(height)` plus `Terminal::insert_before` for scrollback friendly output. https://crates.io/api/v1/crates/ratatui , https://ratatui.rs/examples/apps/inline/
- No official Anthropic Rust SDK; community crates only (anthropic-sdk-rust 0.1.x unofficial). https://docs.rs/crate/anthropic-sdk-rust/latest
- npm: openai 7.62.0 (node >=22), @anthropic-ai/sdk 1.12.0, ai (Vercel AI SDK) 7.0.179 (node >=22). https://registry.npmjs.org/openai/latest , https://registry.npmjs.org/@anthropic-ai/sdk/latest , https://registry.npmjs.org/ai/latest
- OpenAI Codex CLI: codex-rs plus codex-cli directories (Rust core, npm packaging). https://github.com/openai/codex
- opencode: TypeScript on Bun. https://github.com/anomalyco/opencode

## Not confirmed
Bun binary size and startup; Node SEA in LTS; deno compile; Ink on Bun; OpenTUI production readiness date; crossterm version; official OpenAI Rust SDK; async-openai, genai, rig; Vercel AI SDK streaming tool call behavior; Gemini CLI, Aider, Goose stacks.
