// The repo's lint rule that a predicate starts with `is` or `has` (CONTRIBUTING.md), where its return type is written (#380).
import { defineRule } from "vite-plus/lint/plugins";

/** A name that starts with the word `is` or `has`: `isOpen`, `hasRows`, `is`; not `isolate`. */
const predicateName = /^(?:is|has)(?:[A-Z0-9_]|$)/;

/** Whether a written return type says the function answers yes or no: `boolean`, or `x is T`. */
function isPredicateType(returnType) {
  const type = returnType?.typeAnnotation;
  if (type?.type === "TSBooleanKeyword") return true;
  return type?.type === "TSTypePredicate" && !type.asserts;
}

/** The kinds of node whose key names the function they hold: a method or a property. */
const keyed = new Set(["MethodDefinition", "Property", "PropertyDefinition"]);

/** The name a method's or property's key gives the function it holds, unless it's computed. */
function keyName(holder) {
  const key = keyed.has(holder?.type) && !holder.computed ? holder.key : undefined;
  return key?.type === "Identifier" || key?.type === "PrivateIdentifier" ? key.name : undefined;
}

/** The name a function is given: its own, its const's, or its method's or property's key. */
function nameOf(fn) {
  if (fn.id) return fn.id.name;
  const { parent } = fn;
  if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier") {
    return parent.id.name;
  }
  return keyName(parent);
}

export default defineRule({
  meta: {
    messages: {
      predicateName:
        "`{{name}}` answers yes or no, so start its name with `is` or `has` (CONTRIBUTING.md). " +
        "If it's an action that says whether it worked, or a public name kept as Rails has it, " +
        "opt out with a reason after `--`.",
    },
  },
  create(context) {
    /** Reports a function with a body whose written return type is a predicate's, by its name. */
    const check = (fn) => {
      if (fn.body === null || fn.body === undefined || !isPredicateType(fn.returnType)) return;
      const name = nameOf(fn);
      if (name === undefined || predicateName.test(name)) return;
      context.report({ node: fn, messageId: "predicateName", data: { name } });
    };
    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
    };
  },
});
