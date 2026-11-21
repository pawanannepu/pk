# Epic: Tools

What the model can do in the project. Reading and searching run freely; writing and running go through [safety](safety.md). Part of the [pk scope](index.md).

## Slice 2: Safe changes

### 8. File write & exact edit tools with diffs · needs a decision
Create and overwrite files, and make precise edits by exact string replacement, only to files the agent has read first. Every change shows a colored diff.
**Done when:** an edit to a file not yet read, or changed on disk since it was read, is refused with a reason the model sees; a replacement string that matches zero or several places is refused; every write and edit shows a diff that reads correctly with color off.
- [ ] Design it (spec): `/architect file write & exact edit tools with diffs`

### 9. Shell command tool · needs a decision
Run shell commands in the project with a timeout and capped output, behind a permission prompt.
**Done when:** long commands time out with a clear message; huge output is capped and says so; exit code and output go back to the model; Esc stops a running command; commands never see the stored secrets.
- [ ] Design it (spec): `/architect shell command tool`

## Slice 3: Find your way around

### 11. Search & listing tools · needs a decision
Find files by pattern, search code by regex, and list directories, all respecting ignore rules (such as `.gitignore`).
**Done when:** ignored files never appear unless asked for; results are capped and sorted usefully; searching a large repository stays fast; binary files are skipped. (basis: gitignore pattern format)
- [ ] Design it (spec): `/architect search & listing tools`

### 12. To do list tool · needs a decision
A visible to do list the agent keeps for multi step work, shown in the terminal and with `/todos`.
**Done when:** the list updates live as items move from pending to in progress to done; it survives compaction and resume; headless output includes it.
- [ ] Design it (spec): `/architect to do list tool`

## Slice 11: Extensibility

### 36. MCP server support · needs a decision
Connect external tool servers over the Model Context Protocol so the model can call their tools, under the same permission rules.
**Done when:** a configured MCP server's tools appear to the model, every call goes through permissions, a crashing server never crashes pk, and `/mcp` shows server status. (basis: Model Context Protocol specification)
- [ ] Design it (spec): `/architect MCP server support`

### 37. Web fetch & search tools · needs a decision
Tools to read a URL and search the web, for docs lookup while coding.
**Done when:** fetched pages come back as readable text with a size cap; fetched content is treated as data, never as instructions; both tools respect permission rules and work without any one vendor's search service being required.
- [ ] Design it (spec): `/architect web fetch & search tools`
