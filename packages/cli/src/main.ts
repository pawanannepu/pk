#!/usr/bin/env bun
// The `pk` executable. scripts/build.ts compiles this file into the single binary.
import { main } from "./program.ts";

const code = await main(process.argv);
process.exitCode = code;
