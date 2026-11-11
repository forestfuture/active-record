// The repo's lint rule that a test's name stands alone, with no word leaning on a sibling (#302).
import { defineRule } from "vite-plus/lint/plugins";

/** The functions that take a test's name. */
const testFunctions = new Set(["test", "it"]);

/** Words that make a name lean on the test before it: "redirects HEAD too". */
const leaningWords = [/\btoo\b/];

/**
 * The function a call's chain starts from: `test` in `test("…")`, `test.skip("…")` and
 * `test.each(table)("…")`.
 */
function chainRoot(callee) {
  let node = callee;
  while (node.type === "MemberExpression" || node.type === "CallExpression") {
    node = node.type === "MemberExpression" ? node.object : node.callee;
  }
  return node.type === "Identifier" ? node.name : undefined;
}

/** The text of a name given as a string or a template literal, with `${…}` for each value. */
function nameText(node) {
  if (node?.type === "TemplateLiteral") return node.quasis.map((q) => q.value.cooked).join("${…}");
  return node?.type === "Literal" && typeof node.value === "string" ? node.value : undefined;
}

export default defineRule({
  meta: {
    messages: {
      leans:
        'The name "{{name}}" leans on another test with "{{word}}". Say what this test shows on ' +
        "its own, or opt out with a reason after `--`.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!testFunctions.has(chainRoot(node.callee))) return;
        const name = nameText(node.arguments[0]);
        const word = name === undefined ? undefined : leaningWords.find((w) => w.test(name));
        if (word === undefined) return;
        const data = { name, word: name.match(word)[0] };
        context.report({ node: node.arguments[0], messageId: "leans", data });
      },
    };
  },
});
