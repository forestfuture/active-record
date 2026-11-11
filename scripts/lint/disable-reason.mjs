// The repo's lint rule that turning off one of its own rules says why, after `--` (#302).
import { defineRule } from "vite-plus/lint/plugins";

/** A comment that turns rules off, and what follows the directive: the rules, then any reason. */
const directive = /^\s*(?:oxlint|eslint)-disable(?:-next-line|-line)?(\s.*)?$/s;

/** Whether a directive's list of rules takes in the repo's own: naming one, or naming none, so all. */
function coversOwnRule(rules) {
  return rules.trim() === "" || rules.includes("d1-record/");
}

/** Whether a directive's text turns off one of the repo's own rules with no reason after `--`. */
function lacksReason(text) {
  const match = directive.exec(text);
  if (match === null) return false;
  // Oxlint takes the reason from after the first `--`, spaced or not. A reason has a word in it.
  const [rules, reason = ""] = (match[1] ?? "").split(/--(.*)/s);
  return coversOwnRule(rules) && !/\p{L}/u.test(reason);
}

export default defineRule({
  meta: {
    messages: {
      noReason:
        "Say why the repo's own rule is turned off here, after `--`: " +
        "`// oxlint-disable-next-line d1-record/<rule> -- <why>`.",
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (lacksReason(comment.value))
            context.report({ loc: comment.loc, messageId: "noReason" });
        }
      },
    };
  },
});
