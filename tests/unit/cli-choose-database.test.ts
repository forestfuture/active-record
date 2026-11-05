import { describe, expect, test } from "vite-plus/test";
import { chooseDatabase } from "../../packages/active-record/cli/project/databases.ts";

/** Databases as the commands hold them: anything with a binding. */
const bound = (...bindings: string[]) => bindings.map((binding) => ({ binding }));

describe("choosing the database a command works on", () => {
  test.each([
    ["one binding, none named", ["DB"], undefined, { binding: "DB" }],
    ["one binding, named", ["DB"], "DB", { binding: "DB" }],
    [
      "one binding, another named",
      ["DB"],
      "LOGS",
      "No database is bound as LOGS; this config has DB",
    ],
    [
      "several, none named",
      ["DB", "LOGS"],
      undefined,
      "This config has several databases; choose one with --database (DB or LOGS)",
    ],
    ["several, one named", ["DB", "LOGS"], "LOGS", { binding: "LOGS" }],
    [
      "several, another named",
      ["DB", "LOGS", "CACHE"],
      "AUDIT",
      "No database is bound as AUDIT; this config has DB, LOGS or CACHE",
    ],
    ["a name in another case", ["db"], "DB", "No database is bound as DB; this config has db"],
  ])("%s", (_case, bindings, named, expected) => {
    expect(chooseDatabase(bound(...bindings), named)).toEqual(expected);
  });

  test("returns the database itself, not a copy", () => {
    const databases = [
      { binding: "DB", note: "first" },
      { binding: "LOGS", note: "second" },
    ];

    expect(chooseDatabase(databases, "LOGS")).toBe(databases[1]);
  });
});
