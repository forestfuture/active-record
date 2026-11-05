// Builds @forestfuture/d1-record: the D1 adapter, and its plugin for the `active-record` command.
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    // The plugin (`/cli`) runs on Node, in the command; the adapter on Workers.
    entry: { index: "src/index.ts", cli: "cli/plugin.ts" },
    target: "es2022",
    tsconfig: "tsconfig.build.json",
    // Provided by the Workers runtime; loaded only when a Model queries its binding (#77).
    external: ["cloudflare:workers"],
    dts: { generator: "tsgo" },
    exports: { devExports: true },
    attw: { profile: "esm-only" },
    publint: true,
  },
});
