// The repo's lint rule that an opt-out from one of its own rules gives a reason after `--` (#302).
import { defineRule } from "vite-plus/lint/plugins";
import { parseOptOut } from "./opt-outs.mjs";

/**
 * What's wrong with a comment, as a message id, or null. Oxlint hides the report on an opt-out
 * from this rule, so tests/unit/lint-opt-outs.test.ts runs the rule over the repo to see it.
 */
function problem(text) {
  const optOut = parseOptOut(text);
  if (optOut === null) return null;
  if (optOut.names.includes("active-record/disable-reason")) return "turnsItselfOff";
  // Naming no rule turns off every rule, the repo's own included. A reason has a letter in it.
  const isOwnRuleOff =
    optOut.names.length === 0 || optOut.names.some((n) => n.startsWith("active-record/"));
  return isOwnRuleOff && !/\p{L}/u.test(optOut.reason) ? "noReason" : null;
}

export default defineRule({
  meta: {
    messages: {
      noReason:
        "Say why this turns off the repo's own rules, after `--`. Naming no rule turns them all " +
        "off. `// oxlint-disable-next-line active-record/<rule> -- <why>`.",
      turnsItselfOff: "Leave active-record/disable-reason on: it's what makes an opt-out say why.",
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const messageId = problem(comment.value);
          if (messageId !== null) context.report({ loc: comment.loc, messageId });
        }
      },
    };
  },
});
