import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { exampleBlock, site, writeExcerpts } from "../../site/excerpts.ts";
import { guidePages } from "../support/guide-pages.ts";

const pages = guidePages();

// The guide's examples come from type-checked files; each is shown with the imports it uses.
describe("the guide's example blocks", () => {
  const file = join(mkdtempSync(join(tmpdir(), "examples-")), "example.ts");
  writeFileSync(
    file,
    `import { belongsTo, hasMany, Model } from "@forestfuture/active-record";
import { connect, type Database } from "@forestfuture/d1-record";
import { User } from "../shared/users";
import { Tag } from "./tags";
import { schema } from "../db/schema";
import { ApplicationRecord } from "./application-record";
import { column } from "./columns";

// #region declare
export class Post extends Model.define({ id: "integer" }) {
  author = belongsTo(User);
  tags = hasMany(Tag);
}
// #endregion declare

// #region commented
// the Post model's column
export const label = "a Post";
// #endregion commented

// #region base
export class Comment extends ApplicationRecord {}
// #endregion base

// #region schema
export const shown = schema;
// #endregion schema

export async function read(db: Database) {
  // #region read
  const posts = await db.model(Post).toArray();
  // #endregion read
  return posts;
}
`,
  );

  test("the generated schema is imported as written, not as one of the app's models", () => {
    expect(exampleBlock(file, "schema")).toBe(`import { schema } from "../db/schema";

export const shown = schema;`);
  });

  test("start with the imports their code uses, and only those; the app's models come from ./models", () => {
    expect(exampleBlock(file, "declare"))
      .toBe(`import { belongsTo, hasMany, Model } from "@forestfuture/active-record";
import { User, Tag } from "./models";

export class Post extends Model.define({ id: "integer" }) {
  author = belongsTo(User);
  tags = hasMany(Tag);
}`);
  });

  test("ignore names that only appear in comments or strings", () => {
    expect(exampleBlock(file, "commented")).toBe(`// the Post model's column
export const label = "a Post";`);
  });

  test("show the app's base class from ./application-record", () => {
    expect(exampleBlock(file, "base"))
      .toBe(`import { ApplicationRecord } from "./application-record";

export class Comment extends ApplicationRecord {}`);
  });

  test("are dedented, and have no imports when their code uses none", () => {
    expect(exampleBlock(file, "read")).toBe("const posts = await db.model(Post).toArray();");
  });

  test("every excerpt a guide page includes is one the site's build writes", () => {
    const excerpts = mkdtempSync(join(tmpdir(), "excerpts-"));
    writeExcerpts(site, excerpts);
    const includes = pages.flatMap(({ name: page, text }) =>
      // A formatter may wrap an <include> across lines; Blume still splices it.
      [...text.matchAll(/^<include[^>]*>\s*\/_excerpts\/(\S+?)\s*<\/include>$/gm)].map(
        ([, path]) => `${page}: ${path}`,
      ),
    );
    const missing = includes.filter(
      (include) => !existsSync(join(excerpts, include.split(": ")[1]!)),
    );

    expect(includes.length).toBeGreaterThan(80);
    expect(missing).toEqual([]);
  });

  test("an example written inline in a page imports whatever it uses from the package", () => {
    const index = ["active-record", "d1-record"]
      .map((name) =>
        readFileSync(new URL(`../../packages/${name}/src/index.ts`, import.meta.url), "utf8"),
      )
      .join("\n");
    const exported = [...index.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)].flatMap(([, list]) =>
      list!.split(",").map((name) =>
        name
          .replace(/\btype\s+/, "")
          .split(" as ")
          .pop()!
          .trim(),
      ),
    );
    const unimported = pages.flatMap(({ name: page, text }) =>
      [...text.matchAll(/```ts[^\n]*\n([\s\S]*?)```/g)].flatMap(([, code]) =>
        exported
          // A bare name, not a property such as `binding.batch`, nor `d1` in `active-record`.
          .filter((name) => name && new RegExp(`(?<![.\\w])${name}\\b(?!-)`).test(code!))
          .filter((name) => !new RegExp(`import[^;]*\\b${name}\\b`).test(code!))
          .map((name) => `${page}: ${name}`),
      ),
    );

    expect(unimported).toEqual([]);
  });
});
