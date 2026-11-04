// Builds @forestfuture/active-record: the core, its adapter entry, and its entry for the command line.
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: { index: "src/index.ts", adapter: "src/for-adapters.ts", cli: "src/for-cli.ts" },
    target: "es2022",
    tsconfig: "src/tsconfig.json",
    dts: { generator: "tsgo" },
    // In the repo, the package resolves to its source, so the command runs untranspiled with no
    // build; publishConfig points the published package at dist/.
    exports: { devExports: true },
    // ESM-only package for Workers: skip node10/CommonJS resolution checks.
    attw: { profile: "esm-only" },
    publint: true,
  },
});
