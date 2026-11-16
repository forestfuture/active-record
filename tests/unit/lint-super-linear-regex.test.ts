import regexp from "eslint-plugin-regexp";
import { describe, expect, test } from "vite-plus/test";
import config from "../../vite.config.ts";
import { ruleTester } from "../support/rule-tester.ts";

type Rule = Parameters<typeof ruleTester.run>[1];

/** One of eslint-plugin-regexp's rules, which Oxlint runs as an ESLint rule. */
function regexpRule(name: string): Rule {
  const rule = regexp.rules[name];
  if (rule === undefined) throw new Error(`eslint-plugin-regexp has no rule ${name}`);
  // Its type is ESLint's; the rule tester takes Oxlint's own, which runs it the same way.
  return rule as unknown as Rule;
}

// A regex that takes super-linear time on a long input is a lint error in the library's and the
// command's code, where an app's or a database's text arrives (#404). Review found four by hand:
// #116, #311, #390 and #391.
ruleTester.run("no-super-linear-move", regexpRule("no-super-linear-move"), {
  valid: [
    // Anchored, so it can only start at the beginning.
    'const leaving = /^(?:quit|exit)(?:\\s*;)?$/; leaving.test("exit");',
    // An unclosed [ runs to the end, so a run of them is read once (#390, #404).
    'const name = /\\[[^\\]]*\\]?/g; "a [b]".replace(name, "");',
  ],
  invalid: [
    {
      name: "trailing zeros found from anywhere, as #391's decimal cast did",
      code: 'const zeros = /0*$/; zeros.exec("100");',
      errors: 1,
    },
    {
      name: "an unclosed [ rescanned from each one, as #390's CHECK reader did",
      code: 'const name = /\\[[^\\]]*\\]/g; "a [b]".replace(name, "");',
      errors: 1,
    },
  ],
});

ruleTester.run("no-super-linear-backtracking", regexpRule("no-super-linear-backtracking"), {
  valid: ['const line = /^(?:quit|exit)(?:\\s*;)?$/; line.test("quit");'],
  invalid: [
    {
      name: "spaces on both sides of an optional ; that can trade them",
      code: 'const line = /^\\s*(?:quit|exit)\\s*;?\\s*$/; line.test("quit");',
      output: 'const line = /^\\s*(?:quit|exit)\\s*(?:;\\s*)?$/; line.test("quit");',
      errors: 1,
    },
  ],
});

describe("the lint config", () => {
  test("turns both rules on for the library's and the command's code", () => {
    const overrides = config.lint?.overrides ?? [];
    const modules = overrides.find(({ files }) => files.includes("packages/*/src/**/*.ts"));

    expect(modules?.files).toContain("packages/*/cli/**/*.ts");
    expect(modules?.rules).toMatchObject({
      "regexp/no-super-linear-move": "error",
      "regexp/no-super-linear-backtracking": "error",
    });
  });
});
