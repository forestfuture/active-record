// The repo's lint rule that comments and test names say what the code does, not where the idea came from (#515).
import { defineRule } from "vite-plus/lint/plugins";
import { parseOptOut } from "./opt-outs.mjs";
import { testName } from "./test-calls.mjs";

/** The word, whole and capitalized: "Rails'" and "Rails-style", not "guard rails" or "guardrails". */
const rails = /\bRails\b/;

/**
 * Whether a comment turns this rule off, naming it or naming no rule (which turns every rule off),
 * so its reason can name what it opts out for.
 */
function isOwnOptOut(text) {
  const names = parseOptOut(text)?.names;
  if (names === undefined) return false;
  return names.length === 0 || names.includes("active-record/no-rails-mention");
}

export default defineRule({
  meta: {
    messages: {
      mentionsRails:
        'Say what the code does, not where the idea came from: drop "Rails" from this ' +
        "{{place}}, or opt out with a reason after `--`.",
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (isOwnOptOut(comment.value) || !rails.test(comment.value)) continue;
          const data = { place: "comment" };
          context.report({ loc: comment.loc, messageId: "mentionsRails", data });
        }
      },
      CallExpression(node) {
        const name = testName(node);
        if (name === undefined || !rails.test(name)) return;
        const data = { place: "test's name" };
        context.report({ node: node.arguments[0], messageId: "mentionsRails", data });
      },
    };
  },
});
