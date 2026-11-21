// The repo's lint rule that a test's name stands alone, with no word leaning on a sibling (#302).
import { defineRule } from "vite-plus/lint/plugins";
import { testName } from "./test-calls.mjs";

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
        const name = testName(node);
        const word = name === undefined ? undefined : leaningWords.find((w) => w.test(name));
        if (word === undefined) return;
        const data = { name, word: name.match(word)[0] };
        context.report({ node: node.arguments[0], messageId: "leans", data });
      },
    };
  },
});
