// A RuleTester for the repo's lint rules (scripts/lint/), running each case as a Vitest test.
import { describe, test } from "vite-plus/test";
import { RuleTester } from "vite-plus/lint/plugins-dev";

RuleTester.describe = describe;
RuleTester.it = test;
RuleTester.itOnly = test.only;

/** Runs a rule's valid and invalid cases, parsing each as TypeScript. */
export const ruleTester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });
