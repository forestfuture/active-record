// The repo's lint rule against tests that wait a fixed delay, which pass until a slow run doesn't (#293).
import { defineRule } from "vite-plus/lint/plugins";

const timersPromises = new Set(["node:timers/promises", "timers/promises"]);

/** Whether `node` is the identifier `name`. */
function isNamed(node, name) {
  return node?.type === "Identifier" && node.name === name;
}

/** Whether `node` is an arrow function or a function expression: a Promise's executor can be either. */
function isFunction(node) {
  return node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";
}

/** Whether `callee` is the global `setTimeout`: `setTimeout` or `globalThis.setTimeout`. */
function isGlobalSetTimeout(callee) {
  if (callee.type !== "MemberExpression") return isNamed(callee, "setTimeout");
  return isNamed(callee.object, "globalThis") && isNamed(callee.property, "setTimeout");
}

/** The function `node` sits directly in, if any. */
function enclosingFunction(node) {
  let scope = node.parent;
  while (scope !== undefined && scope !== null && !isFunction(scope)) scope = scope.parent;
  return scope ?? undefined;
}

/** The name of the resolve a Promise's executor takes, when `node` sits directly in one. */
function executorResolve(node) {
  const scope = enclosingFunction(node);
  const promise = scope?.parent;
  const isExecutor =
    promise?.type === "NewExpression" &&
    isNamed(promise.callee, "Promise") &&
    promise.arguments[0] === scope;
  const resolve = isExecutor ? scope.params[0] : undefined;
  return resolve?.type === "Identifier" ? resolve.name : undefined;
}

/** What a function with no parameters does, when its body is one expression. */
function onlyExpression(callback) {
  if (!isFunction(callback) || callback.params.length > 0) return undefined;
  const { body } = callback;
  if (body.type !== "BlockStatement") return body;
  return body.body.length === 1 ? body.body[0].expression : undefined;
}

/** Whether `callback` is `resolve`, or a function that only calls it with no value. */
function onlyResolves(callback, resolve) {
  if (callback?.type === "Identifier") return callback.name === resolve;
  const call = onlyExpression(callback);
  return (
    call?.type === "CallExpression" && call.arguments.length === 0 && isNamed(call.callee, resolve)
  );
}

/** Whether `callback` is a resolve by its name: `resolve`, or a gate's `gate.resolve`. */
function isNamedResolve(callback) {
  const named = callback?.type === "MemberExpression" ? callback.property : callback;
  return isNamed(named, "resolve");
}

/** Whether a global `setTimeout` call waits: its callback is a resolve, by name or its executor's. */
function resolvesLater(node) {
  const [callback] = node.arguments;
  if (isNamedResolve(callback)) return true;
  const resolve = executorResolve(node);
  return resolve !== undefined && onlyResolves(callback, resolve);
}

export default defineRule({
  meta: {
    messages: {
      fixedDelay:
        "Wait on an event, a gate, or a polled state, not a fixed delay: a slow run outlasts it. " +
        "If the delay is what's tested, opt out with a reason after `--`.",
    },
  },
  create(context) {
    const promised = new Set();
    /** Names the promised timers module is imported under, whole: `timers` in `timers.setTimeout`. */
    const timersModules = new Set();
    const isPromisedSetTimeout = (callee) =>
      callee.type === "MemberExpression"
        ? callee.object.type === "Identifier" &&
          timersModules.has(callee.object.name) &&
          isNamed(callee.property, "setTimeout")
        : callee.type === "Identifier" && promised.has(callee.name);
    return {
      ImportDeclaration(node) {
        if (!timersPromises.has(node.source.value)) return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") timersModules.add(specifier.local.name);
          else if (specifier.imported.name === "setTimeout") promised.add(specifier.local.name);
        }
      },
      CallExpression(node) {
        const { callee } = node;
        if (isPromisedSetTimeout(callee)) {
          context.report({ node, messageId: "fixedDelay" });
          return;
        }
        if (isGlobalSetTimeout(callee) && resolvesLater(node)) {
          context.report({ node, messageId: "fixedDelay" });
        }
      },
    };
  },
});
