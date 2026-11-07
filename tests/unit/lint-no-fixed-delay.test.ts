import { describe, test } from "vite-plus/test";
import { RuleTester } from "vite-plus/lint/plugins-dev";
import noFixedDelay from "../../scripts/lint/no-fixed-delay.mjs";

RuleTester.describe = describe;
RuleTester.it = test;
RuleTester.itOnly = test.only;

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

// A test that waits a fixed delay passes until a slow run doesn't (#293).
tester.run("no-fixed-delay", noFixedDelay, {
  valid: [
    // Not waits: a write scheduled for later, and a race's bound that resolves with a value.
    "setTimeout(() => input.write(line), 20);",
    "Promise.race([closed, new Promise((resolve) => setTimeout(() => resolve({ hung: true }), 20_000))]);",
    'Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 20_000, "hung"))]);',
    // Waiting on an event, a gate, or a polled state.
    'new Promise((resolve) => emitter.once("end", resolve));',
    "await gate.promise;",
    "await waitFor(() => done);",
    // Code a test types into the console is a string, not the test's own.
    'input.write("await new Promise((resolve) => setTimeout(resolve, 10))");',
    // A timer outside a Promise's executor, calling something that isn't a resolve.
    "function later(run) { setTimeout(run, 10); }",
    'import { setTimeout } from "node:timers"; setTimeout(run, 5);',
  ],
  invalid: [
    {
      name: "a Promise resolved by a timer",
      code: "await new Promise((resolve) => setTimeout(resolve, 50));",
      errors: [{ messageId: "fixedDelay" }],
    },
    {
      name: "its resolve under another name, in a block",
      code: "new Promise((done) => { setTimeout(done, 10); }).then(run);",
      errors: [{ messageId: "fixedDelay" }],
    },
    {
      name: "a function executor",
      code: "new Promise(function (resolve) { setTimeout(resolve, 5); });",
      errors: [{ messageId: "fixedDelay" }],
    },
    {
      name: "a callback that only resolves",
      code: "await new Promise((resolve) => setTimeout(() => resolve(), 50));",
      errors: [{ messageId: "fixedDelay" }],
    },
    {
      name: "a callback that resolves with undefined",
      code: "await new Promise((done) => setTimeout(() => done(undefined), 50));",
      errors: [{ messageId: "fixedDelay" }],
    },
    {
      name: "the global's own setTimeout",
      code: "await new Promise((resolve) => globalThis.setTimeout(resolve, 50));",
      errors: [{ messageId: "fixedDelay" }],
    },
    {
      name: "a gate's resolve",
      code: "setTimeout(gate.resolve, 50);",
      errors: [{ messageId: "fixedDelay" }],
    },
    {
      name: "a resolve from outside an executor",
      code: "const { promise, resolve } = Promise.withResolvers(); setTimeout(resolve, 50);",
      errors: [{ messageId: "fixedDelay" }],
    },
    {
      name: "a helper's resolve",
      code: "function later(resolve) { setTimeout(resolve, 10); }",
      errors: [{ messageId: "fixedDelay" }],
    },
    {
      name: "Node's promised setTimeout",
      code: 'import { setTimeout } from "node:timers/promises"; await setTimeout(50);',
      errors: [{ messageId: "fixedDelay" }],
    },
    {
      name: "Node's promised setTimeout, through a namespace",
      code: 'import * as timers from "node:timers/promises"; await timers.setTimeout(50);',
      errors: [{ messageId: "fixedDelay" }],
    },
    {
      name: "Node's promised setTimeout, through the default export",
      code: 'import timers from "node:timers/promises"; await timers.setTimeout(50);',
      errors: [{ messageId: "fixedDelay" }],
    },
    {
      name: "Node's promised setTimeout, renamed",
      code: 'import { setTimeout as sleep } from "timers/promises"; await sleep(50);',
      errors: [{ messageId: "fixedDelay" }],
    },
  ],
});
