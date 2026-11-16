// The repo's lint rule that a test acts on one Model once it starts asserting (#413).
import { defineRule } from "vite-plus/lint/plugins";
import { chainRoot } from "./test-calls.mjs";

/** The functions that take a test's body. */
const testFunctions = new Set(["test", "it"]);

/** The nodes an awaited value goes back through, toward the Model it came from. */
const chainLinks = {
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

/** The Model an awaited value comes from, following its chain back: `db.model(User).build()`. */
function modelOf(node) {
  for (let at = node; at !== undefined && at !== null; at = chainLinks[at.type]?.(at)) {
    if (at.type === "CallExpression") {
      const model = modelCalled(at);
      if (model !== undefined) return model;
    }
  }
  return undefined;
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
        const model = modelOf(node.argument);
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
