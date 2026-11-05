// Builds @forestfuture/active-record: the core, its entries for adapters, and the `active-record` command.
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    // One build, so the entries share the core's modules (one copy of each class) and `exports`
    // lists them all. The command (package.json's bin) runs on Node, and no Worker imports it.
    entry: {
      index: "src/index.ts",
      adapter: "src/for-adapters.ts",
      cli: "cli/for-adapters.ts",
      command: "cli/bin.ts",
    },
    target: "es2022",
    tsconfig: "tsconfig.build.json",
    // Provided by the Workers runtime; loaded only when an adapter looks up a Model's binding.
    external: ["cloudflare:workers"],
    dts: { generator: "tsgo" },
    // In the repo, the package resolves to its source, so the command runs untranspiled with no
    // build; publishConfig points the published package at dist/.
    // `ffar` is its short name (#260). In the repo both run the source, published they run dist/.
    exports: {
      devExports: true,
      exclude: ["command"],
      bin: { "active-record": "cli/bin.ts", ffar: "cli/bin.ts" },
    },
    // ESM-only package for Workers: skip node10/CommonJS resolution checks.
    attw: { profile: "esm-only" },
    publint: true,
  },
});
