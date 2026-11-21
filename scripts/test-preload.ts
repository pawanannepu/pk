// bun test preload (bunfig.toml): every test run gets a fresh, empty PK_HOME, so no test can read
// or write your real ~/.pk (or XDG dirs). Removed again when the run ends.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "pk-test-home-"));
process.env.PK_HOME = home;
process.on("exit", () => rmSync(home, { recursive: true, force: true }));
