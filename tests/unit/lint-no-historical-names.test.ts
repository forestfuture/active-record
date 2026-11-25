import noHistoricalNames from "../../scripts/lint/no-historical-names.mjs";
import { ruleTester } from "../support/rule-tester.ts";

// Example data uses everyday names, never a historical person's (docs/agents/docs-pages.md; #567).
ruleTester.run("no-historical-names", noHistoricalNames, {
  valid: [
    'const user = { name: "Jane", email: "sam@example.com" };',
    'test("finds Jane by her email", () => {});',
    // A word that holds a name inside it isn't the name.
    'const adapter = "adapters";',
    'expect(message).toBe("a graceful exit");',
    "const hoppers = `${count} hoppers`;",
    // Comments aren't checked.
    "// Ada's rows, as the first test seeds them.\nconst a = 1;",
  ],
  invalid: [
    {
      name: "a name in a string",
      code: 'const user = { name: "Ada" };',
      errors: [{ messageId: "historical", data: { name: "Ada" } }],
    },
    {
      name: "a name in an email address",
      code: 'const email = "grace@example.com";',
      errors: [{ messageId: "historical", data: { name: "grace" } }],
    },
    {
      name: "a surname in a domain",
      code: 'const email = "jane@lovelace.dev";',
      errors: [{ messageId: "historical", data: { name: "lovelace" } }],
    },
    {
      name: "a name joined by an underscore",
      code: 'const column = "ada_id";',
      errors: [{ messageId: "historical", data: { name: "ada" } }],
    },
    {
      name: "a name in a template literal",
      code: "const email = `${prefix}linus@example.com`;",
      errors: [{ messageId: "historical", data: { name: "linus" } }],
    },
    {
      name: "a name in SQL",
      code: "const seed = \"INSERT INTO users (name) VALUES ('Turing')\";",
      errors: [{ messageId: "historical", data: { name: "Turing" } }],
    },
    {
      name: "a test's name",
      code: 'test("finds Hopper by her email", () => {});',
      errors: [{ messageId: "historical", data: { name: "Hopper" } }],
    },
    {
      name: "a variable's name",
      code: "const hedy = 1;",
      errors: [{ messageId: "historical", data: { name: "hedy" } }],
    },
    {
      name: "a name starting a camel-case variable",
      code: "const adaPosts = [];",
      errors: [{ messageId: "historical", data: { name: "ada" } }],
    },
    {
      name: "a name ending a camel-case variable",
      code: "const authorEdsger = 1;",
      errors: [{ messageId: "historical", data: { name: "Edsger" } }],
    },
    {
      name: "a name in capitals starting a camel-case variable",
      code: "const ADAUser = 1;",
      errors: [{ messageId: "historical", data: { name: "ADA" } }],
    },
    {
      name: "a name after an acronym in a camel-case variable",
      code: "const XMLHopper = 1;",
      errors: [{ messageId: "historical", data: { name: "Hopper" } }],
    },
    {
      name: "a name in capitals",
      code: 'const name = "ALAN";',
      errors: [{ messageId: "historical", data: { name: "ALAN" } }],
    },
  ],
});
