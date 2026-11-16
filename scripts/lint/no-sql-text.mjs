// The repo's lint rule that a test asserts results, not the SQL text it sent (#400).
import { defineRule } from "vite-plus/lint/plugins";

/** Whether `node` is SQL text: a `sql` binding, or a `.sql` property, as an event or toSql has. */
function isSqlText(node) {
  if (node.type === "Identifier") return node.name === "sql";
  return node.type === "MemberExpression" && !node.computed && node.property.name === "sql";
}

/** Whether `node` is an arrow function or a function expression, such as a `map` callback. */
function isFunction(node) {
  return node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";
}

/** The values a function returns: an arrow's expression, or its block's own `return`s. */
function returned(fn) {
  if (fn.body.type !== "BlockStatement") return [fn.body];
  return fn.body.body.filter((statement) => statement.type === "ReturnStatement");
}

/** Whether any of `nodes` gives SQL text, or a value read from it. */
function anyReads(nodes) {
  return nodes.some((node) => readsSqlText(node));
}

/** Whether `callee` is a `startsWith` method, which picks out a kind of statement (#400). */
function isStartsWith(callee) {
  return callee.type === "MemberExpression" && callee.property.name === "startsWith";
}

/**
 * Whether a call's value is read from SQL text: a method of SQL text (`sql.split(" ")`), a method
 * of a value read from it, or a callback's value (`events.map((event) => event.sql)`). SQL given
 * to a call, as the code under test, isn't.
 */
function callReads(call) {
  if (isStartsWith(call.callee)) return false;
  if (readsSqlText(call.callee)) return true;
  return call.callee.type === "MemberExpression" && anyReads(call.arguments.filter(isFunction));
}

/** For each kind of node, the nodes whose values it's built from. */
const parts = {
  ArrayExpression: (node) => node.elements,
  BinaryExpression: (node) => [node.left, node.right],
  ChainExpression: (node) => [node.expression],
  LogicalExpression: (node) => [node.left, node.right],
  MemberExpression: (node) => [node.object],
  ObjectExpression: (node) => node.properties.map((p) => (p.type === "Property" ? p.value : p)),
  ReturnStatement: (node) => [node.argument],
  SpreadElement: (node) => [node.argument],
  TSNonNullExpression: (node) => [node.expression],
  UnaryExpression: (node) => [node.argument],
};

/** Whether the value `node` gives is SQL text, or is read from it. */
function readsSqlText(node) {
  if (node === null || node === undefined) return false;
  if (isSqlText(node)) return true;
  if (isFunction(node)) return anyReads(returned(node));
  if (node.type === "CallExpression") return callReads(node);
  return anyReads(parts[node.type]?.(node) ?? []);
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
