// The repo's lint rule that an opt-out from one of its own rules gives a reason after `--` (#302).
import { defineRule } from "vite-plus/lint/plugins";

/** A comment that turns rules off, and what follows the directive: the rules, then any reason. */
const directive = /^\s*(?:oxlint|eslint)-disable(?:-next-line|-line)?(\s.*)?$/s;

/** A directive's rule names and its reason, or null for a comment that isn't one. */
function parse(text) {
  const match = directive.exec(text);
  if (match === null) return null;
  // Oxlint takes the reason from after the first `--`, spaced or not.
  const [rules, reason = ""] = (match[1] ?? "").split(/--(.*)/s);
  return { names: rules.split(/[\s,]+/).filter(Boolean), reason };
}

/**
 * What's wrong with a comment, as a message id, or null. Oxlint hides the report on an opt-out
 * from this rule, so tests/unit/lint-opt-outs.test.ts runs the rule over the repo to see it.
 */
function problem(text) {
  const optOut = parse(text);
  if (optOut === null) return null;
  if (optOut.names.includes("d1-record/disable-reason")) return "turnsItselfOff";
  // Naming no rule turns off every rule, the repo's own included. A reason has a letter in it.
  const coversOwn =
    optOut.names.length === 0 || optOut.names.some((n) => n.startsWith("d1-record/"));
  return coversOwn && !/\p{L}/u.test(optOut.reason) ? "noReason" : null;
}

export default defineRule({
  meta: {
    messages: {
      noReason:
        "Say why the repo's own rule is turned off here, after `--`: " +
        "`// oxlint-disable-next-line d1-record/<rule> -- <why>`.",
      turnsItselfOff: "Leave d1-record/disable-reason on: it's what makes an opt-out say why.",
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
