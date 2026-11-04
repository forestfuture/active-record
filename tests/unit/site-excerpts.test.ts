import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { writeExcerpts } from "../../site/excerpts.ts";

/** A repository with a site/ and a skills/ beside it, holding the given files. */
function repository(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "site-excerpts-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return join(root, "site");
}

const skill = `---
name: d1-record
---

<!-- #region rules -->
- Name the fields you take.
<!-- #endregion rules -->
`;

const snippet = `import { batch, Model } from "@forestfuture/active-record";

// #region declare
export class Post extends Model.define({ id: "integer" }) {}
// #endregion declare
`;

// The site's build writes these before Blume reads the pages' <include>s.
describe("the excerpts the site's build writes", () => {
  test("hold each region of a snippet file, with the imports it uses, at <file>/<region>.ts", () => {
    const site = repository({
      "site/snippets/guide/posts.ts": snippet,
      "packages/active-record/skills/active-record/SKILL.md": skill,
    });
    writeExcerpts(site);

    expect(readFileSync(join(site, "docs/_excerpts/guide/posts/declare.ts"), "utf8"))
      .toBe(`import { Model } from "@forestfuture/active-record";

export class Post extends Model.define({ id: "integer" }) {}
`);
  });

  test("hold every snippet file whole, at its own path", () => {
    const site = repository({
      "site/snippets/guide/posts.ts": snippet,
      "site/snippets/guide/schema.sql": "CREATE TABLE posts (id INTEGER);\n",
      "packages/active-record/skills/active-record/SKILL.md": skill,
    });
    writeExcerpts(site);

    expect(readFileSync(join(site, "docs/_excerpts/guide/posts.ts"), "utf8")).toBe(snippet);
    expect(readFileSync(join(site, "docs/_excerpts/guide/schema.sql"), "utf8")).toBe(
      "CREATE TABLE posts (id INTEGER);\n",
    );
  });

  test("hold the agent skill's rules in skill-rules.md", () => {
    const site = repository({
      "site/snippets/guide/posts.ts": snippet,
      "packages/active-record/skills/active-record/SKILL.md": skill,
    });
    writeExcerpts(site);

    expect(readFileSync(join(site, "docs/_excerpts/skill-rules.md"), "utf8")).toBe(
      "- Name the fields you take.\n",
    );
  });

  test("leave nothing from an earlier run", () => {
    const site = repository({
      "site/docs/_excerpts/guide/removed.ts": "export {};\n",
      "site/snippets/guide/posts.ts": snippet,
      "packages/active-record/skills/active-record/SKILL.md": skill,
    });
    writeExcerpts(site);

    expect(existsSync(join(site, "docs/_excerpts/guide/removed.ts"))).toBe(false);
  });

  test("can't be written when the agent skill has no rules region", () => {
    const site = repository({
      "site/snippets/guide/posts.ts": snippet,
      "packages/active-record/skills/active-record/SKILL.md": "---\nname: d1-record\n---\n",
    });

    expect(() => writeExcerpts(site)).toThrow(
      "packages/active-record/skills/active-record/SKILL.md has no rules region",
    );
  });
});
