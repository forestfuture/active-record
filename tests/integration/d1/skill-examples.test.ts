import { expect, test } from "vite-plus/test";
import { runSchema } from "../../../packages/active-record/cli/schema/command.ts";

// The agent skill's examples (site/snippets/skill/, checked against SKILL.md in tests/unit/skill.test.ts),
// run through the schema command, which compiles the library, so it lives here (#485).
test("the agent skill's examples' schema is what their migrations and Models generate", async () => {
  const output: string[] = [];
  const cwd = new URL("../../../site/snippets/skill/", import.meta.url).pathname;

  const options = { cwd, models: "models.ts", out: "schema.ts", check: true };

  expect(await runSchema(options, (line) => output.push(line))).toBe(0);
});
