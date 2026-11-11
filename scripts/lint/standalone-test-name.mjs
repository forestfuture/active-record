// The repo's lint rule that a test's name stands alone, with no word leaning on a sibling (#302).
import { defineRule } from "vite-plus/lint/plugins";

/** Words that make a name lean on the test before it: "redirects HEAD too". */
const leaningWords = [/\btoo\b/];

/** The text of a name given as a string, if it is one. */
function nameText(node) {
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
        if (node.callee.type !== "Identifier" || node.callee.name !== "test") return;
        const name = nameText(node.arguments[0]);
        const word = name === undefined ? undefined : leaningWords.find((w) => w.test(name));
        if (word === undefined) return;
        const data = { name, word: name.match(word)[0] };
        context.report({ node: node.arguments[0], messageId: "leans", data });
      },
    };
  },
});
