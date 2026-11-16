// The repo's lint rule that a test asserts results, not the SQL text it sent (#400).
import { defineRule } from "vite-plus/lint/plugins";

/** Whether `property` names `sql`: `.sql`, or `["sql"]`. */
function isSqlKey(property, computed) {
  return computed ? property.value === "sql" : property.name === "sql";
}

/** Whether `node` is SQL text: a `sql` binding, or a `sql` property, as an event or toSql has. */
function isSqlText(node) {
  if (node.type === "Identifier") return node.name === "sql";
  return node.type === "MemberExpression" && isSqlKey(node.property, node.computed);
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
function isAnyReadFromSqlText(nodes, held) {
  return nodes.some((node) => isReadFromSqlText(node, held));
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
function isCallReadFromSqlText(call, held) {
  if (isStartsWith(call.callee)) return false;
  if (isReadFromSqlText(call.callee, held)) return true;
  return (
    call.callee.type === "MemberExpression" &&
    isAnyReadFromSqlText(call.arguments.filter(isFunction), held)
  );
}

/** For each kind of node, the nodes whose values it's built from. */
const parts = {
  ArrayExpression: (node) => node.elements,
  BinaryExpression: (node) => [node.left, node.right],
  ChainExpression: (node) => [node.expression],
  ConditionalExpression: (node) => [node.consequent, node.alternate],
  LogicalExpression: (node) => [node.left, node.right],
  MemberExpression: (node) => [node.object],
  ObjectExpression: (node) => node.properties.map((p) => (p.type === "Property" ? p.value : p)),
  ReturnStatement: (node) => [node.argument],
  SpreadElement: (node) => [node.argument],
  TemplateLiteral: (node) => node.expressions,
  TSAsExpression: (node) => [node.expression],
  TSNonNullExpression: (node) => [node.expression],
  TSSatisfiesExpression: (node) => [node.expression],
  UnaryExpression: (node) => [node.argument],
};

/**
 * Whether the value `node` gives is SQL text, or is read from it. `held` gives the value a `const`
 * an identifier names holds, so SQL text kept in one first is seen too.
 */
function isReadFromSqlText(node, held) {
  if (node === null || node === undefined) return false;
  if (isSqlText(node)) return true;
  if (node.type === "Identifier") return isReadFromSqlText(held(node), held);
  if (isFunction(node)) return isAnyReadFromSqlText(returned(node), held);
  if (node.type === "CallExpression") return isCallReadFromSqlText(node, held);
  return isAnyReadFromSqlText(parts[node.type]?.(node) ?? [], held);
}

/** The `const` an identifier names, where one declares it alone: `const text = event.sql`. */
function constOf(variable) {
  const definitions = variable?.defs ?? [];
  if (definitions.length !== 1) return undefined;
  const [{ node, parent }] = definitions;
  const isConst = node.type === "VariableDeclarator" && parent?.kind === "const";
  return isConst && node.id.type === "Identifier" ? node : undefined;
}

/** The variable `identifier` names, from the innermost scope it's declared in. */
function variableOf(scope, identifier) {
  for (let at = scope; at !== null; at = at.upper) {
    const variable = at.set.get(identifier.name);
    if (variable !== undefined) return variable;
  }
  return undefined;
}

/** Whether `callee` is Vitest's `expect`, or its `expect.soft`. */
function isExpect(callee) {
  const isSoft = callee.type === "MemberExpression" && callee.property.name === "soft";
  const name = isSoft ? callee.object : callee;
  return name.type === "Identifier" && name.name === "expect";
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
        if (!isExpect(node.callee)) return;
        // Each const is read once, so consts that name each other can't loop.
        const read = new Set();
        const held = (identifier) => {
          const declarator = constOf(
            variableOf(context.sourceCode.getScope(identifier), identifier),
          );
          if (declarator === undefined || read.has(declarator)) return undefined;
          read.add(declarator);
          return declarator.init;
        };
        if (isReadFromSqlText(node.arguments[0], held))
          context.report({ node, messageId: "sqlText" });
      },
    };
  },
});
