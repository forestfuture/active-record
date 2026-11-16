// The repo's lint rule that a test acts on one Model once it starts asserting (#413).
import { defineRule } from "vite-plus/lint/plugins";
import { chainRoot } from "./test-calls.mjs";
import { variableOf } from "./variables.mjs";

/** The functions that take a test's body. */
const testFunctions = new Set(["test", "it"]);

/** The calls that act on a Model: its writes, and validating a record. Any other call looks. */
const actions = new Set(
  ["save", "update", "destroy", "create", "insert", "upsert", "updateAll", "deleteAll"]
    .flatMap((name) => [name, `${name}OrThrow`])
    .concat(["isValid", "insertAll", "upsertAll", "push", "clear", "delete"]),
);

/**
 * The calls a value goes back through toward the Model it came from: a Relation's methods, which
 * give a Relation or its records, and the actions, which give a record. Any other call, such as
 * an association's accessor, gives a value of a Model the rule can't tell, so it stops there.
 */
const throughCalls = new Set([
  ...actions,
  "all",
  "build",
  "count",
  "distinct",
  "exists",
  "find",
  "findBy",
  "findByOrThrow",
  "first",
  "includes",
  "last",
  "limit",
  "merge",
  "none",
  "offset",
  "or",
  "order",
  "reload",
  "reorder",
  "select",
  "take",
  "toArray",
  "where",
  "whereNot",
]);

/** The method a call calls, as `count` in `users.count()`, if it's named. */
function methodOf(call) {
  const callee = call?.type === "CallExpression" ? call.callee : undefined;
  return callee?.type === "MemberExpression" && !callee.computed ? callee.property.name : undefined;
}

/** The nodes that pass a value on unchanged, toward the expression they wrap. */
const wrappers = {
  AwaitExpression: (node) => node.argument,
  ChainExpression: (node) => node.expression,
  TSAsExpression: (node) => node.expression,
  TSNonNullExpression: (node) => node.expression,
};

/** The expression a value comes from, past its wrappers: `user` in `(await user)!`. */
function unwrapped(node) {
  let at = node;
  while (at !== null && at !== undefined && Object.hasOwn(wrappers, at.type)) {
    at = wrappers[at.type](at);
  }
  return at;
}

/**
 * The action an awaited value is, if it's one: a call of an action, or one continued with `then`
 * (`user.save().then(…)`).
 */
function actionOf(node) {
  let call = unwrapped(node);
  while (methodOf(call) === "then") call = unwrapped(call.callee.object);
  return actions.has(methodOf(call)) ? call : undefined;
}

/** Whether `node` is a call of `.model(X)`, as `db.model(User)`: the Model it names, if so. */
function modelCalled(node) {
  const { callee, arguments: [model] = [] } = node;
  const isModelCall =
    callee?.type === "MemberExpression" && !callee.computed && callee.property.name === "model";
  return isModelCall && model?.type === "Identifier" ? model.name : undefined;
}

/**
 * The Model a value comes from, following it back (`db.model(User).find(1)`) to a `.model(X)`
 * call or a Model's class, through each `const` it names (`resolve` reads one). Undefined past a
 * call it doesn't know.
 */
function modelOf(node, resolve) {
  for (let at = unwrapped(node); at !== undefined && at !== null; at = unwrapped(at)) {
    if (at.type === "CallExpression") {
      const model = modelCalled(at);
      if (model !== undefined) return model;
      if (!throughCalls.has(methodOf(at))) return undefined;
      at = at.callee.object;
    } else if (at.type === "MemberExpression") {
      at = at.object;
    } else if (at.type === "Identifier") {
      const { model, init } = resolve(at);
      if (model !== undefined) return model;
      at = init;
    } else {
      return undefined;
    }
  }
  return undefined;
}

/** Whether `variable` is a class: one declared in the file, or a capitalized import. */
function isClass(variable) {
  const [definition] = variable.defs;
  if (definition?.type === "ClassName") return true;
  return definition?.type === "ImportBinding" && /^[A-Z]/.test(variable.name);
}

/**
 * The value a `const` was declared with, for one declared alone or destructured from a list:
 * `const user = …`, `const [user] = …`.
 */
function constInit(variable) {
  const definitions = variable?.defs ?? [];
  if (definitions.length !== 1) return undefined;
  const [{ node, parent }] = definitions;
  if (node.type !== "VariableDeclarator" || parent?.kind !== "const") return undefined;
  return node.id.type === "Identifier" || node.id.type === "ArrayPattern" ? node.init : undefined;
}

/** Whether `node` is a call of Vitest's `expect`, or its `expect.soft`. */
function isExpect(node) {
  return chainRoot(node.callee) === "expect";
}

export default defineRule({
  meta: {
    messages: {
      secondModel:
        "This test acts on {{first}}, then on {{second}}: that's two behaviors, so two tests. " +
        "Reading another Model's rows to see an effect is fine. If acting on both is one " +
        "behavior, opt out with the reason after `--`.",
    },
  },
  create(context) {
    // The tests being walked, innermost last: whether each has asserted yet, and its first Model.
    const tests = [];
    return {
      CallExpression(node) {
        if (testFunctions.has(chainRoot(node.callee))) tests.push({ node, asserted: false });
        else if (isExpect(node) && tests.length > 0) tests.at(-1).asserted = true;
      },
      "CallExpression:exit"(node) {
        if (tests.at(-1)?.node === node) tests.pop();
      },
      AwaitExpression(node) {
        const test = tests.at(-1);
        if (test === undefined || !test.asserted || test.reported) return;
        const action = actionOf(node.argument);
        if (action === undefined) return;
        // Each const is followed once, so consts that name each other can't loop.
        const followed = new Set();
        const resolve = (identifier) => {
          const variable = variableOf(context.sourceCode.getScope(identifier), identifier);
          if (variable === undefined || followed.has(variable)) return {};
          followed.add(variable);
          return isClass(variable) ? { model: variable.name } : { init: constInit(variable) };
        };
        const model = modelOf(action.callee.object, resolve);
        if (model === undefined) return;
        test.first ??= model;
        if (model === test.first) return;
        test.reported = true;
        context.report({
          node,
          messageId: "secondModel",
          data: { first: test.first, second: model },
        });
      },
    };
  },
});
