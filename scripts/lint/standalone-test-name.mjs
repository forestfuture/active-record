// The repo's lint rule that a test's name stands alone, with no word leaning on a sibling (#302).
import { defineRule } from "vite-plus/lint/plugins";

/** The functions that take a test's or a suite's name. */
const testFunctions = new Set(["test", "it", "describe"]);

/**
 * Words that make a name lean on the test before it: "redirects HEAD too", and a name that opens
 * with "…", "..." or "and", going on from that test's name.
 */
const leaningWords = [
  /\btoo\b/i,
  /\balso\b/i,
  /\bas well\b(?! as\b)/i,
  /\bso do(es)?\b/i,
  /^(…|\.\.\.)/,
  /^[Aa]nd\s/,
];

/** For each kind of link in a call's chain, the node it goes on from, toward the chain's start. */
const chainLinks = {
  MemberExpression: (node) => node.object,
  CallExpression: (node) => node.callee,
  TaggedTemplateExpression: (node) => node.tag,
};

/**
 * The function a call's chain starts from: `test` in `test("…")`, `test.skip("…")`,
 * `test.each(table)("…")`, and `test.each` followed by a tagged template table.
 */
function chainRoot(callee) {
  let node = callee;
  while (Object.hasOwn(chainLinks, node.type)) node = chainLinks[node.type](node);
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
