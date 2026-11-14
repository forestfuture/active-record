import predicateName from "../../scripts/lint/predicate-name.mjs";
import { ruleTester } from "../support/rule-tester.ts";

// A predicate starts with `is` or `has` (CONTRIBUTING.md), checked where its return type is written (#380).
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
    // Inferred returns are out of reach: a lint rule has no types.
    "const same = (a: unknown, b: unknown) => a === b;",
    // A signature without a body names what implementations do; they're checked themselves.
    "interface Driver { recover(error: unknown): boolean; }",
    "declare function ready(): boolean;",
    // A callback has no name to read.
    "values.filter((value): value is number => typeof value === 'number');",
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
  ],
});
