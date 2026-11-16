// The repo's lint rule that a test asserts results, not the SQL text it sent (#400).
import { defineRule } from "vite-plus/lint/plugins";

/** Whether `node` is SQL text: a `sql` binding, or a `.sql` property, as an event or toSql has. */
function isSqlText(node) {
  if (node.type === "Identifier") return node.name === "sql";
  return node.type === "MemberExpression" && !node.computed && node.property.name === "sql";
}

/** Whether the value `node` gives is SQL text, or is read from it. */
function readsSqlText(node) {
  if (node === null || node === undefined) return false;
  if (isSqlText(node)) return true;
  switch (node.type) {
    case "ChainExpression":
    case "TSNonNullExpression":
      return readsSqlText(node.expression);
    case "MemberExpression":
      return readsSqlText(node.object);
    case "CallExpression":
      return readsSqlText(node.callee);
    default:
      return false;
  }
}

/** Whether `callee` is Vitest's `expect`. */
function isExpect(callee) {
  return callee.type === "Identifier" && callee.name === "expect";
}

export default defineRule({
  meta: {
    messages: {
      sqlText:
        "Assert results, bound values or a count, not SQL text. If the text is what's tested, " +
        "such as a safety property, opt out with the reason after `--`.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (isExpect(node.callee) && readsSqlText(node.arguments[0])) {
          context.report({ node, messageId: "sqlText" });
        }
      },
    };
  },
});
