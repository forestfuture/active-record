import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { runSchema } from "../../packages/active-record/cli/schema/command.ts";

// SKILL.md ships in the package as plain Markdown, so its examples can't be included from files.
// They're kept as type-checked files instead (site/snippets/skill/), and must match them exactly.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const skillPath = "packages/active-record/skills/active-record/SKILL.md";

describe("the agent skill (packages/active-record/skills/active-record/SKILL.md)", () => {
  const blocks = [...read(skillPath).matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1]);

  test("its examples are the type-checked files in site/snippets/skill", () => {
    expect(blocks).toEqual([
      read("site/snippets/skill/models.ts"),
      read("site/snippets/skill/worker.ts"),
    ]);
  });

  test("its examples' schema is what their migrations and Models generate", async () => {
    const output: string[] = [];
    const cwd = new URL("../../site/snippets/skill/", import.meta.url).pathname;

    const options = { cwd, models: "models.ts", out: "schema.ts", check: true };

    expect(await runSchema(options, (line) => output.push(line))).toBe(0);
  });

  test("its rules are a region the docs site and llms.txt read", () => {
    expect(read(skillPath)).toMatch(/<!-- #region rules -->[\s\S]+<!-- #endregion rules -->/);
  });

  // `npx skills add` copies the skill's directory: a SKILL.md at the repository's root would copy
  // the whole repository into the app (#136).
  test("sits alone in its own directory, and not at the repository's root", () => {
    expect(
      readdirSync(new URL("../../packages/active-record/skills/active-record", import.meta.url)),
    ).toEqual(["SKILL.md"]);
    expect(existsSync(new URL("../../SKILL.md", import.meta.url))).toBe(false);
  });

  // skills.sh's Snyk audit flags a skill that sends the agent to a web page as a prompt injection
  // risk (#256).
  test("has no links to web pages", () => {
    expect(read(skillPath)).not.toMatch(/https?:\/\//);
  });

  test("is named for its directory", () => {
    expect(read(skillPath)).toMatch(/^---\nname: active-record\n/);
  });
});
