# Epic: Safety

Permissions and protections, so pk never changes or runs anything the user did not allow. These come before any tool that writes or runs. Part of the [pk scope](index.md).

## Slice 2: Safe changes

### 7. Permission prompts & modes · needs a decision
Writing files and running commands ask first: yes, no, or always for this session, or deny with a note telling the agent what to do instead. Modes: normal, auto accept edits, read only plan mode, and skip all for sandboxes. `/mode` switches.
**Done when:** no write or command runs without permission in normal mode; a deny note reaches the model as guidance; plan mode blocks every write and command; skip all needs an explicit flag and shows a clear warning. (basis: least privilege)
- [ ] Design it (spec): `/architect permission prompts & modes`

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
