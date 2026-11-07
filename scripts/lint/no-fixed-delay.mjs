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
  let ancestor = node.parent;
  while (ancestor !== undefined && ancestor !== null && !isFunction(ancestor)) {
    ancestor = ancestor.parent;
  }
  return ancestor ?? undefined;
}

/** The name of the resolve a Promise's executor takes, when `node` sits directly in one. */
function executorResolve(node) {
  const fn = enclosingFunction(node);
  const promise = fn?.parent;
  const isExecutor =
    promise?.type === "NewExpression" &&
    isNamed(promise.callee, "Promise") &&
    promise.arguments[0] === fn;
  const resolve = isExecutor ? fn.params[0] : undefined;
  return resolve?.type === "Identifier" ? resolve.name : undefined;
}

/** What a function with no parameters does, when its body is one expression. */
function onlyExpression(callback) {
  if (!isFunction(callback) || callback.params.length > 0) return undefined;
  const { body } = callback;
  if (body.type !== "BlockStatement") return body;
  return body.body.length === 1 ? body.body[0].expression : undefined;
}

/** Whether `args` pass no value: none, or `undefined`. */
function noValue(args) {
  return args.length === 0 || (args.length === 1 && isNamed(args[0], "undefined"));
}

/** What `callback` calls, when it's a function that only calls one thing, with no value. */
function calledWithNoValue(callback) {
  const call = onlyExpression(callback);
  return call?.type === "CallExpression" && noValue(call.arguments) ? call.callee : undefined;
}

/** Whether `callback` is `resolve`, or a function that only calls it with no value. */
function onlyResolves(callback, resolve) {
  if (callback?.type === "Identifier") return callback.name === resolve;
  return isNamed(calledWithNoValue(callback), resolve);
}

/** Whether `callee` is a resolve by its name: `resolve`, or a gate's `gate.resolve`. */
function isNamedResolve(callee) {
  const named = callee?.type === "MemberExpression" ? callee.property : callee;
  return isNamed(named, "resolve");
}

/**
 * Whether a global `setTimeout` call waits: its callback is a resolve, by name or its executor's,
 * given no value. One given a value (`setTimeout(resolve, 50, "hung")`) bounds a race.
 */
function resolvesLater(node) {
  const [callback, , ...values] = node.arguments;
  if (values.length > 0) return false;
  if (isNamedResolve(callback) || isNamedResolve(calledWithNoValue(callback))) return true;
  const resolve = executorResolve(node);
  return resolve !== undefined && onlyResolves(callback, resolve);
}

export default defineRule({
  meta: {
    messages: {
      fixedDelay:
        "Wait on an event, a gate, or a polled state, not a fixed delay: a slow run outlasts it. " +
        "If the delay is what's tested, or it only paces or bounds another wait, opt out with a " +
        "reason after `--`.",
    },
  },
  create(context) {
    /** Names `setTimeout` from the promised timers module is imported under. */
    const promisedSetTimeouts = new Set();
    /** Names the promised timers module is imported under, whole: `timers` in `timers.setTimeout`. */
    const timersModules = new Set();
    const isPromisedSetTimeout = (callee) =>
      callee.type === "MemberExpression"
        ? callee.object.type === "Identifier" &&
          timersModules.has(callee.object.name) &&
          isNamed(callee.property, "setTimeout")
        : callee.type === "Identifier" && promisedSetTimeouts.has(callee.name);
    return {
      ImportDeclaration(node) {
        if (!timersPromises.has(node.source.value)) return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") timersModules.add(specifier.local.name);
          else if (specifier.imported.name === "setTimeout")
            promisedSetTimeouts.add(specifier.local.name);
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
