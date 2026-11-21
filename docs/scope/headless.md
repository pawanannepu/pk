# Epic: Headless

Running pk without a person at the keyboard, and measuring how well it works. Part of the [pk scope](index.md).

## Slice 8: Headless and measurement

### 26. Headless mode · needs a decision
`pk -p "task"` runs without interaction and returns text or JSON with the final answer, turn count, token usage, cost, duration and the files changed.
**Done when:** the JSON output is a documented, versioned contract; exit codes tell success, failure and turn limit apart; permissions follow flags and rules since nobody can be asked; a run never hangs waiting for input.
- [ ] Design it (spec): `/architect headless mode`

### 27. pk-bench harness · needs a decision
An evaluation harness that runs pk headlessly on small coding tasks in fresh copies, checks the results with hidden tests, and reports pass rate, cost, turns and variance across repeated runs, so providers, models and prompts can be compared.
**Done when:** one command runs a task set against chosen providers, models or prompt versions; hidden tests stay out of the agent's reach; reports show pass rate, cost, turns and variance per configuration and can be compared over time. (basis: grading agent output by running tests, as in SWE-bench; keeping the tests hidden is pk's own choice)
- [ ] Design it (spec): `/architect pk-bench harness`

### 28. pk-bench task suite · needs a decision
The starter set of small coding tasks: bug fixes, small features, refactors and test writing, across a few languages, each with hidden tests.
**Done when:** the suite has enough tasks to separate a strong model from a weak one with low variance, runs offline after setup, and is easy to extend with one folder per task.
- [ ] Design it (spec): `/architect pk-bench task suite`
