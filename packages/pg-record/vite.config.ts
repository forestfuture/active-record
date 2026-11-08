// Builds @forestfuture/pg-record: the Postgres adapter, and its plugin for the `active-record` command.
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    // The plugin (`/cli`) runs on Node, in the command; the adapter on Workers and Node.
    entry: { index: "src/index.ts", cli: "cli/plugin.ts" },
    target: "es2022",
    tsconfig: "tsconfig.build.json",
    // `pg` is the app's, a peer dependency; `cloudflare:workers` is the Workers runtime's,
    // loaded only when a Model queries its binding.
    external: ["pg", "cloudflare:workers"],
    dts: { generator: "tsgo" },
    exports: { devExports: true },
    attw: { profile: "esm-only" },
    publint: true,
  },
});
