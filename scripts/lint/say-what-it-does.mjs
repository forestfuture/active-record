// The repo's lint rule that comments and test names say what the code does, not where the idea came from (#515).
import { defineRule } from "vite-plus/lint/plugins";
import { parseOptOut } from "./opt-outs.mjs";
import { testName } from "./test-calls.mjs";

/** A letter, a digit or `_`: what can't touch a word on either side for it to count as whole. */
const wordCharacter = String.raw`[\p{L}\p{N}_]`;

/**
 * A pattern matching any of the words, each whole and as written: "Rails" finds "Rails'" and
 * "Rails-style", not "guard rails" or "guardrails". Null for no words, which reports nothing.
 */
function wordPattern(words) {
  if (words.length === 0) return null;
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`));
  return new RegExp(`(?<!${wordCharacter})(?:${escaped.join("|")})(?!${wordCharacter})`, "u");
}

/**
 * Whether a comment turns this rule off, naming it or naming no rule (which turns every rule off),
 * so its reason can name what it opts out for.
 */
function isOwnOptOut(text) {
  const names = parseOptOut(text)?.names;
  if (names === undefined) return false;
  return names.length === 0 || names.includes("active-record/say-what-it-does");
}

export default defineRule({
  meta: {
    messages: {
      namesOrigin:
        'Say what the code does, not where the idea came from: drop "{{word}}" from this ' +
        "{{place}}, or opt out with a reason after `--`.",
    },
    schema: [
      {
        type: "object",
        properties: { words: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ words: [] }],
  },
  create(context) {
    const pattern = wordPattern(context.options[0].words);
    if (pattern === null) return {};
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const word = isOwnOptOut(comment.value) ? undefined : pattern.exec(comment.value)?.[0];
          if (word === undefined) continue;
          const data = { word, place: "comment" };
          context.report({ loc: comment.loc, messageId: "namesOrigin", data });
        }
      },
      CallExpression(node) {
        const word = pattern.exec(testName(node) ?? "")?.[0];
        if (word === undefined) return;
        const data = { word, place: "test's name" };
        context.report({ node: node.arguments[0], messageId: "namesOrigin", data });
      },
    };
  },
});
