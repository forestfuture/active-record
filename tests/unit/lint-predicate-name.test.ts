import predicateName from "../../scripts/lint/predicate-name.mjs";
import { ruleTester } from "../support/rule-tester.ts";

// A predicate starts with `is` or `has` (CONTRIBUTING.md), checked where its return type is written (#380)
// or its body answers yes or no (#525).
ruleTester.run("predicate-name", predicateName, {
  valid: [
    "function isOpen(): boolean { return true; }",
    "function hasRows(rows: unknown[]): boolean { return rows.length > 0; }",
    "const isDate = (value: unknown): value is Date => value instanceof Date;",
    "class Door { isLocked(): boolean { return false; } get isOpen(): boolean { return true; } }",
    "class Door { #isShut(): boolean { return false; } }",
    "const door = { isOpen(): boolean { return true; } };",
    // Not predicates: an action that resolves to whether it worked, an assertion, a written-out type.
    "async function save(): Promise<boolean> { return true; }",
    "function assertDate(value: unknown): asserts value is Date {}",
    "function open(): void {}",
    // A signature without a body names what implementations do; they're checked themselves.
    "interface Driver { recover(error: unknown): boolean; }",
    "declare function ready(): boolean;",
    // A callback has no name to read.
    "values.filter((value): value is number => typeof value === 'number');",
    "values.filter((value: number) => value > 0);",
    // An option's key is the API's name, so an inferred one isn't read; a written one still is.
    "validates('age', { if: (record: { age: number }) => record.age > 17 });",
    // `??` and `&&` with a side that isn't boolean-shaped may give back a value.
    "const fallback = (a?: boolean, b?: boolean) => a ?? b;",
    "const first = (a: unknown[], b: number) => a.length > 0 && a[b];",
    // Only a member call to a method that answers yes or no counts: `test` alone is a function.
    "const check = (name: string) => test(name);",
    "const pick = (names: string[]) => names.find((name) => name !== '');",
    // A block body answers yes or no only when every return does, outside nested functions.
    "function pick(a: number, b: string) { if (a > 0) return b; return a === 1; }",
    "function wait() { return () => true; }",
    "function each(rows: number[]) { rows.forEach((row) => { return row > 0; }); }",
    // A body that returns only true or false is a stub or a constant, not a question.
    "const enabled = () => true;",
    "function off() { if (Math.random()) return true; return false; }",
    // An async function resolves to its answer, and a generator yields; neither is a predicate.
    "async function ready(n: number) { return n > 0; }",
    "function* flags(n: number) { return n > 0; }",
    // A name that starts with the letters but not the word.
    "function isolate(): void {}",
  ],
  invalid: [
    {
      name: "a function declaration",
      code: "function sameRow(a: object, b: object): boolean { return a === b; }",
      errors: [{ messageId: "predicateName", data: { name: "sameRow" } }],
    },
    {
      name: "an arrow given to a const",
      code: "const oneFile = (path: string): boolean => path.endsWith('.ts');",
      errors: [{ messageId: "predicateName", data: { name: "oneFile" } }],
    },
    {
      name: "a type predicate",
      code: "function namesAttribute(value: unknown): value is string { return typeof value === 'string'; }",
      errors: [{ messageId: "predicateName", data: { name: "namesAttribute" } }],
    },
    {
      name: "a class method",
      code: "class Attribute { same(a: unknown, b: unknown): boolean { return a === b; } }",
      errors: [{ messageId: "predicateName", data: { name: "same" } }],
    },
    {
      name: "a private method",
      code: "class Attribute { #hidden(): boolean { return true; } }",
      errors: [{ messageId: "predicateName", data: { name: "hidden" } }],
    },
    {
      name: "an arrow in a class field",
      code: "class Check { matches = (value: unknown): boolean => value !== null; }",
      errors: [{ messageId: "predicateName", data: { name: "matches" } }],
    },
    {
      name: "an object method",
      code: "const checks = { allows(id: string): boolean { return id !== ''; } };",
      errors: [{ messageId: "predicateName", data: { name: "allows" } }],
    },
    {
      name: "a function expression given to a const",
      code: "const mentions = function (text: string): boolean { return text !== ''; };",
      errors: [{ messageId: "predicateName", data: { name: "mentions" } }],
    },
    {
      name: "a word that starts with is",
      code: "function isolated(): boolean { return true; }",
      errors: [{ messageId: "predicateName", data: { name: "isolated" } }],
    },
    {
      name: "an arrow whose body is a comparison",
      code: "const same = (a: unknown, b: unknown) => a === b;",
      errors: [{ messageId: "predicateName", data: { name: "same" } }],
    },
    {
      name: "an arrow whose body negates",
      code: "const blank = (text: string) => !text;",
      errors: [{ messageId: "predicateName", data: { name: "blank" } }],
    },
    {
      name: "an arrow whose body joins comparisons",
      code: "const between = (n: number) => (n > 0 && n < 9) || n === -1;",
      errors: [{ messageId: "predicateName", data: { name: "between" } }],
    },
    {
      name: "an arrow whose body chooses between boolean answers",
      code: "const allowed = (open: boolean, n: number) => (open ? n > 0 : false);",
      errors: [{ messageId: "predicateName", data: { name: "allowed" } }],
    },
    {
      name: "an arrow that calls a predicate",
      code: "const ready = (door: { isOpen(): boolean }) => isLocked() || door.isOpen();",
      errors: [{ messageId: "predicateName", data: { name: "ready" } }],
    },
    {
      name: "an arrow that calls a method answering yes or no",
      code: "const internal = (name: string) => name.startsWith('_') || /^x/.test(name);",
      errors: [{ messageId: "predicateName", data: { name: "internal" } }],
    },
    {
      name: "an arrow that calls a method through optional chaining",
      code: "const tagged = (tags?: Set<string>) => tags?.has('new');",
      errors: [{ messageId: "predicateName", data: { name: "tagged" } }],
    },
    {
      name: "a function whose every return is boolean-shaped",
      code: "function allowed(n: number) { if (n < 0) return false; return n % 2 === 0; }",
      errors: [{ messageId: "predicateName", data: { name: "allowed" } }],
    },
    {
      name: "a method whose return is boolean-shaped",
      code: "class Door { open() { return this.state === 'open'; } state = 'shut'; }",
      errors: [{ messageId: "predicateName", data: { name: "open" } }],
    },
  ],
});
