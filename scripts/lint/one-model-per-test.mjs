// The repo's lint rule that a test acts on one Model once it starts asserting (#413).
import { defineRule } from "vite-plus/lint/plugins";
import { chainRoot, isExpect } from "./test-calls.mjs";
import { constInit, followingOnce } from "./variables.mjs";

// What the rule can't follow, and leaves alone: a record in a `let` or `var`, or destructured
// from an object; records acted on in a loop or through `Promise.all`; a call through an
// association (`user.posts().create(…)`); a Model imported under a lowercase name; and an
// action in a helper declared before the first `expect` and called after it. Awaits count by
// where they're written, so one in a helper written after the first `expect` counts.

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

/** Whether `node` reads a matcher's `rejects` or `resolves`. */
function isSettling(node) {
  return !node.computed && ["rejects", "resolves"].includes(node.property.name);
}

/**
 * The value `expect` is given, when `node` awaits its `rejects` or `resolves`
 * (`expect(user.saveOrThrow()).rejects.toThrow()`), which is what the await waits for.
 */
function expectedPromise(node) {
  if (node?.type !== "CallExpression") return undefined;
  let at = node.callee;
  let settles = false;
  while (at?.type === "MemberExpression") {
    settles ||= isSettling(at);
    at = at.object;
  }
  return settles && at?.type === "CallExpression" && isExpect(at) ? at.arguments[0] : undefined;
}

/**
 * The action an awaited value is, if it's one: a call of an action, one continued with `then`
 * (`user.save().then(…)`), or one given to `expect` for its `rejects` or `resolves`.
 */
function actionOf(node) {
  let call = unwrapped(node);
  call = unwrapped(expectedPromise(call)) ?? call;
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
      const { model, init } = resolve(at) ?? {};
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
 * The statement `node` is in, where an opt-out on the line before it applies, though the
 * formatter wraps `expect(` and its `await` onto two lines.
 */
function statementOf(node) {
  let at = node;
  while (at.parent && !/Statement$|Declaration$/.test(at.type)) at = at.parent;
  return at;
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
        // An await of expect(…).rejects or .resolves is an assertion, though its expect is
        // visited after it.
        if (test !== undefined && expectedPromise(unwrapped(node.argument)) !== undefined) {
          test.asserted = true;
        }
        if (test === undefined || !test.asserted || test.reported) return;
        const action = actionOf(node.argument);
        if (action === undefined) return;
        const resolve = followingOnce(context, (variable) =>
          isClass(variable) ? { model: variable.name } : { init: constInit(variable) },
        );
        const model = modelOf(action.callee.object, resolve);
        if (model === undefined) return;
        test.first ??= model;
        if (model === test.first) return;
        test.reported = true;
        context.report({
          node: statementOf(node),
          messageId: "secondModel",
          data: { first: test.first, second: model },
        });
      },
    };
  },
});
