/**
 * @pk/cli: the `pk` binary entry and composition root (spec 0001). The only place packages are
 * wired together, and the only importer of `commander`.
 */
export { EXIT, type ExitCode } from "./exit-codes.ts";
export { type Io, main } from "./program.ts";
export { pkVersion } from "./version.ts";
