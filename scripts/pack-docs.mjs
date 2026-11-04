// Copies the documentation site's llms-full.txt into the core's package, so the published package
// carries the guide for its own version (node_modules/@forestfuture/active-record/llms-full.txt).
// Runs from the core's `prepack`, after the docs build.
import { copyFileSync } from "node:fs";

copyFileSync(
  new URL("../site/dist/llms-full.txt", import.meta.url),
  new URL("../packages/active-record/llms-full.txt", import.meta.url),
);
