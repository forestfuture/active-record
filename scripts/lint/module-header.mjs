// The repo's lint rule that every library and command module opens with the line saying what it owns.
import { defineRule } from "vite-plus/lint/plugins";

// Every module opens with a `//` comment whose first line says what it owns, so the first comment
// lines of src/ and cli/ read as a map (AGENTS.md). A shebang line may come first.
export default defineRule({
  meta: {
    messages: {
      missing:
        "Open the file with a `//` comment whose first line says what this module owns (its line in the map).",
    },
  },
  create(context) {
    return {
      Program(node) {
        const text = context.sourceCode.text.replace(/^#!.*\n/, "");
        if (!text.startsWith("//")) context.report({ node, messageId: "missing" });
      },
    };
  },
});
