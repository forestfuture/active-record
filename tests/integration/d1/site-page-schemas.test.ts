// The standalone guide pages' projects (site/snippets/pages/<page>/): each committed schema.ts is what
// its migrations generate, so the pages' Models type-check against the tables the pages show.
import { describe, expect, test } from "vite-plus/test";
import { pageProject, schemaCommand, standalonePages } from "../../support/page-projects.ts";

describe("the standalone pages' generated schemas", () => {
  test.each(standalonePages)("%s's schema is current", async (page) => {
    expect(await schemaCommand(pageProject(page).pathname, true)).toMatchObject({ code: 0 });
  });
});
