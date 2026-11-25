import noOrphanDocComment from "../../scripts/lint/no-orphan-doc-comment.mjs";
import { ruleTester } from "../support/rule-tester.ts";

// A doc comment sits directly above what it documents, so one followed by another documents
// nothing (CODING_STANDARDS.md, Names and comments; #534).
ruleTester.run("no-orphan-doc-comment", noOrphanDocComment, {
  valid: [
    "interface Row {\n  /** The id. */\n  id: number;\n  /** The name. */\n  name: string;\n}",
    "/** Adds one. */\n// A note for readers of the body.\nfunction next(n: number) { return n + 1; }",
    "/** Adds one. */\n/* A note for readers of the body. */\nfunction next(n: number) { return n + 1; }",
    "/* Not a doc comment. */\n/** Adds one. */\nfunction next(n: number) { return n + 1; }",
    "/**/\n/** Adds one. */\nfunction next(n: number) { return n + 1; }",
  ],
  invalid: [
    {
      name: "two doc comments in a row in an interface",
      code: "interface Row {\n  /** The id. */\n  /** The name. */\n  name: string;\n}",
      errors: [{ messageId: "orphan", line: 2 }],
    },
    {
      name: "two doc comments in a row before a function",
      code: "/** Adds one. */\n/** Adds two. */\nfunction next(n: number) { return n + 2; }",
      errors: [{ messageId: "orphan", line: 1 }],
    },
    {
      name: "two doc comments separated only by a line comment",
      code: "/** Adds one. */\n// A note.\n/** Adds two. */\nfunction next(n: number) { return n + 2; }",
      errors: [{ messageId: "orphan", line: 1 }],
    },
    {
      name: "two doc comments separated only by a plain block comment",
      code: "/** Adds one. */\n/* A note. */\n/** Adds two. */\nfunction next(n: number) { return n + 2; }",
      errors: [{ messageId: "orphan", line: 1 }],
    },
  ],
});
