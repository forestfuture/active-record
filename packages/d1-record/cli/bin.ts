#!/usr/bin/env node
// The `d1-record` executable (package.json's bin, built to dist/cli.mjs).
import { main } from "./main.ts";

const code = await main(process.argv.slice(2));
if (code !== "watching") process.exitCode = code;
