# Epic: Safety

Permissions and protections, so pk never changes or runs anything the user did not allow. These come before any tool that writes or runs. Part of the [pk scope](index.md).

## Slice 2: Safe changes

### 7. Permission prompts & modes · done
Writing files and running commands ask first: yes, no, or always for this session, or deny with a note telling the agent what to do instead. Modes: normal, auto accept edits, read only plan mode, and skip all for sandboxes. Shift+Tab switches modes now; `/mode` arrives with #13 (spec 0006).
**Done when:** no write or command runs without permission in normal mode; a deny note reaches the model as guidance; plan mode blocks every write and command; skip all needs an explicit flag and shows a clear warning. (basis: least privilege)
spec [0006](../specs/0006-permission-prompts-modes/index.md)
code in `packages/permissions/src/`, `packages/agent/src/session.ts`, `packages/tools/src/tool.ts`, `packages/tui/src/` (shell, permission panel, HUD), `packages/cli/src/program.ts`
- [x] Design it (spec): `/architect permission prompts & modes`
- [x] Build it: `/develop permission prompts & modes`
  - [x] Plan mode end to end: schema additions, the decision table, `--mode`, the live footer (AC-1, AC-3, AC-7, AC-8, AC-12, AC-13)
  - [x] Deny paths: plain deny stops the turn, a note continues, the `[e]` note field (AC-4, AC-5, AC-6, AC-12, AC-14)
  - [x] Session allow keys: whole tool for writes, exact command for runs (AC-2, AC-6)
  - [x] Live switching: `setMode`, Shift+Tab, deciding a pending prompt again (AC-9, AC-10, AC-14)
  - [x] Skip all: the flag, the red warning, the PTY proof (AC-7, AC-8, AC-10, AC-11, AC-15)
- [x] Verify it: `/check verify permission prompts & modes`
- [x] Test it: `/test permission prompts & modes`
- [x] Review it (fresh model): `/check review permission prompts & modes`
- [x] Document it: `/document permission prompts & modes`

### 10. Permission rules & always ask list · needs a decision
Allow and deny rules (user and project level) for tools, commands and paths, plus an always ask list for destructive commands and writes outside the project, which ask even in auto accept modes.
**Done when:** deny always beats allow; a destructive command (such as deleting files recursively or force pushing) or a write outside the project always asks, except in skip all mode; rules are testable with clear matching for chained and quoted commands.
- [ ] Design it (spec): `/architect permission rules & always ask list`

## Slice 10: Safety extensions

### 32. Command sandbox · needs a decision
Run shell commands inside an OS level sandbox on macOS and Linux, with limited file and network access.
**Done when:** a sandboxed command cannot write outside the project or reach the network unless allowed; a blocked action reports why; the sandbox can be turned off per command with permission.
- [ ] Design it (spec): `/architect command sandbox`

### 33. Undo & checkpoints · needs a decision
Rewind the files pk changed to an earlier point in the conversation.
**Done when:** a user can pick an earlier message and restore the files pk wrote or edited since then; changes made outside pk are detected and never silently overwritten.
- [ ] Design it (spec): `/architect undo & checkpoints`
