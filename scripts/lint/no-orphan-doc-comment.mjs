// The repo's lint rule that a doc comment isn't followed by another doc comment (#534).
import { defineRule } from "vite-plus/lint/plugins";

/** Whether a comment is a `/** … *\/` doc comment, not a plain block or line comment. */
function isDocComment(comment) {
  return comment.type === "Block" && comment.value.startsWith("*");
}

/**
 * The doc comments followed by another doc comment, with nothing between them but whitespace and
 * other comments: each documents nothing, since the next one sits above the member it was meant for.
 */
function orphans(comments, text) {
  const found = [];
  let unattached = null;
  let previousEnd = 0;
  for (const comment of comments) {
    const isAdjacent = text.slice(previousEnd, comment.range[0]).trim() === "";
    const followsUnattached = unattached !== null && isAdjacent;
    if (isDocComment(comment)) {
      if (followsUnattached) found.push(unattached);
      unattached = comment;
    } else if (!followsUnattached) {
      unattached = null;
    }
    previousEnd = comment.range[1];
  }
  return found;
}

export default defineRule({
  meta: {
    messages: {
      orphan:
        "This doc comment documents nothing: another doc comment follows it. Move it above the " +
        "member it describes, or merge the two.",
    },
  },
  create(context) {
    return {
      Program() {
        const { sourceCode } = context;
        for (const comment of orphans(sourceCode.getAllComments(), sourceCode.text)) {
          context.report({ loc: comment.loc, messageId: "orphan" });
        }
      },
    };
  },
});
