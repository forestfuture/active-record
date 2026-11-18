import { expect, test } from "vite-plus/test";
import { runSchema } from "../../../packages/active-record/cli/schema/command.ts";

// Checks the agent skill's examples (site/snippets/skill/) against their migrations and Models.
// It runs the schema command, which compiles the library, so it runs here (#485).
test("the schema of the agent skill's examples is what their migrations and Models generate", async () => {
  const output: string[] = [];
  const cwd = new URL("../../../site/snippets/skill/", import.meta.url).pathname;

  const options = { cwd, models: "models.ts", out: "schema.ts", check: true };

  expect(await runSchema(options, (line) => output.push(line))).toBe(0);
  expect(output).toEqual(["schema.ts is up to date"]);
});
