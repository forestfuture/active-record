// The repo's lint rule that a test acts on one Model once it starts asserting (#413).
import { defineRule } from "vite-plus/lint/plugins";
import { chainRoot } from "./test-calls.mjs";
import { variableOf } from "./variables.mjs";

/** The functions that take a test's body. */
const testFunctions = new Set(["test", "it"]);

/** The nodes an awaited value goes back through, toward the Model it came from. */
const chainLinks = {
  AwaitExpression: (node) => node.argument,
  CallExpression: (node) => node.callee,
  ChainExpression: (node) => node.expression,
  MemberExpression: (node) => node.object,
  TSAsExpression: (node) => node.expression,
  TSNonNullExpression: (node) => node.expression,
};

/** Whether `node` is a call of `.model(X)`, as `db.model(User)`: the Model it names, if so. */
function modelCalled(node) {
  const { callee, arguments: [model] = [] } = node;
  const isModelCall =
    callee?.type === "MemberExpression" && !callee.computed && callee.property.name === "model";
  return isModelCall && model?.type === "Identifier" ? model.name : undefined;
}

/**
 * The Model an awaited value comes from, following its chain back (`db.model(User).build()`) to a
 * Model's class or a `.model(X)` call, through each `const` it names (`named` reads one).
 */
function modelOf(node, named) {
  for (let at = node; at !== undefined && at !== null;) {
    if (at.type === "CallExpression") {
      const model = modelCalled(at);
      if (model !== undefined) return model;
    }
    if (at.type !== "Identifier") {
      at = chainLinks[at.type]?.(at);
      continue;
    }
    const { model, init } = named(at);
    if (model !== undefined) return model;
    at = init;
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
        // Each const is followed once, so consts that name each other can't loop.
        const followed = new Set();
        const named = (identifier) => {
          const variable = variableOf(context.sourceCode.getScope(identifier), identifier);
          if (variable === undefined || followed.has(variable)) return {};
          followed.add(variable);
          return isClass(variable) ? { model: variable.name } : { init: constInit(variable) };
        };
        const model = modelOf(node.argument, named);
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
