#!/usr/bin/env node
// The `active-record` executable (package.json's bin, built to dist/command.mjs).
import { main } from "./main.ts";

const code = await main(process.argv.slice(2));
if (code !== "watching") process.exitCode = code;
