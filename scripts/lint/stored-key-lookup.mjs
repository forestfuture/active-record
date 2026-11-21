// The repo's lint rule that the library's own lookups by a computed key say whether the key is stored, so it isn't normalized again (#354).
import { defineRule } from "vite-plus/lint/plugins";
import { constInit, followingOnce } from "./variables.mjs";

/** The Relation methods that take conditions, and normalize them unless they're `asStored`. */
const takesConditions = new Set([
  "where",
  "whereNot",
  "rewhere",
  "findBy",
  "findByOrThrow",
  "findSoleBy",
  "destroyBy",
  "deleteBy",
  "exists",
]);

/** The kinds of node that only add a type to the expression inside them. */
const typeOnly = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression"]);

/** `node` without the type assertions around it: `{ … } as never` is the `{ … }`. */
function unwrapped(node) {
  let inner = node;
  while (typeOnly.has(inner?.type)) inner = inner.expression;
  return inner;
}

/**
 * The conditions `node` gives, through each `const` it names (`resolve` reads one): an
 * `asStored(…)` call, an object, or undefined for a value lint can't follow, such as a parameter.
 */
function conditionsOf(node, resolve) {
  let at = unwrapped(node);
  while (at?.type === "Identifier") at = unwrapped(resolve(at));
  return at;
}

/** Whether `node` is conditions written with a computed key: `{ [attribute]: key }`. */
function hasComputedKey(node) {
  return (
    node?.type === "ObjectExpression" &&
    node.properties.some((property) => property.type === "Property" && property.computed)
  );
}

/** The name of the method a call calls, as in `relation.where(…)`, unless it's computed. */
function methodName(call) {
  const { callee } = call;
  if (callee.type !== "MemberExpression" || callee.computed) return undefined;
  return callee.property.type === "Identifier" ? callee.property.name : undefined;
}

export default defineRule({
  meta: {
    messages: {
      storedKeyLookup:
        "`{{method}}` normalizes these conditions. If the key's value comes from a record, as an " +
        "association's link does, wrap them in `asStored(…)`: normalizing a stored key could find " +
        "another record's row (#354). If the value is the caller's, opt out with a reason after `--`.",
    },
  },
  create(context) {
    return {
      CallExpression(call) {
        const method = methodName(call);
        if (method === undefined || !takesConditions.has(method)) return;
        const resolve = followingOnce(context, constInit);
        const conditions = conditionsOf(call.arguments[0], resolve);
        if (!hasComputedKey(conditions)) return;
        context.report({ node: conditions, messageId: "storedKeyLookup", data: { method } });
      },
    };
  },
});
