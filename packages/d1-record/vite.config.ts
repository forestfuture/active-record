// Builds @forestfuture/d1-record: the D1 adapter, and the `d1-record` command.
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      entry: { index: "src/index.ts" },
      target: "es2022",
      tsconfig: "tsconfig.build.json",
      // Provided by the Workers runtime; loaded only when a Model queries its binding (#77).
      external: ["cloudflare:workers"],
      // The two builds run together, so each cleans only its own files.
      clean: ["dist/index.*"],
      dts: { generator: "tsgo" },
      exports: { devExports: true },
      attw: { profile: "esm-only" },
      publint: true,
    },
    {
      // The `d1-record` command (package.json's bin): Node only, never imported by a Worker.
      entry: { cli: "cli/bin.ts" },
      platform: "node",
      target: "node22",
      tsconfig: "cli/tsconfig.json",
      dts: false,
      clean: ["dist/cli.*"],
    },
  ],
});
