import { defineConfig } from "vite-plus";

// These tests run the `active-record` command, which loads the library through jiti from src/,
// compiling it in each test file's first test that loads it: about 0.6 s locally, 2–5 s on CI
// with coverage, past Vitest's 5 s default now and then (#416). An app loads it built.
const commandTestTimeout = 15_000;

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  resolve: {
    // Resolves the package's own name to src/, from tsconfig.json's `paths` (one mapping for
    // TypeScript and tests), so the documentation's examples import it as an app would.
    tsconfigPaths: true,
  },
  test: {
    // `vp run coverage` fails when branch coverage of the library and command line drops below the
    // floor (#121). CI runs the tests in shards and checks the floor on their merged coverage
    // (#365). The Best Practices `dynamic_analysis` criterion asks for 80%.
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "packages/*/cli/**/*.ts"],
      reporter: ["text-summary"],
      thresholds: { branches: 90 },
    },
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"] },
      },
      {
        // The D1 adapter's own tests: real D1 via Miniflare, running in Node (see ADR-0002).
        extends: true,
        test: {
          name: "integration:d1",
          include: ["tests/integration/d1/**/*.test.ts"],
          testTimeout: commandTestTimeout,
        },
      },
      {
        // The portable conformance suite, once per adapter, each through its harness (#267).
        extends: true,
        test: {
          name: "conformance:d1",
          include: ["tests/conformance/**/*.test.ts"],
          setupFiles: ["tests/support/conformance-setup.ts"],
          provide: { adapter: "d1" },
          // Each file starts its own workerd, so a loaded machine (a CI shard running several with
          // coverage, or several local runs at once) slows every D1 statement and can push a test
          // past Vitest's 5 s default and its harness setup past the 10 s hook default (#538).
          testTimeout: 15_000,
          hookTimeout: 30_000,
        },
      },
      // The same suite on Postgres (#269), and pg-record's own tests: the server DATABASE_URL names,
      // as CI provides. Without it, they're left out, as the remote smoke suite is.
      ...(process.env["DATABASE_URL"] === undefined
        ? []
        : [
            {
              extends: true,
              test: {
                name: "conformance:pg",
                include: ["tests/conformance/**/*.test.ts"],
                setupFiles: ["tests/support/conformance-setup.ts"],
                provide: { adapter: "pg" },
              },
            },
            {
              // pg-record's own tests: its clients, on Node and in workerd.
              extends: true,
              test: {
                name: "integration:pg",
                include: ["tests/integration/pg/**/*.test.ts"],
                testTimeout: commandTestTimeout,
              },
            },
          ]),
      // Real remote D1 through Wrangler's remote bindings (docs/agents/remote-smoke.md): only for
      // `vp run test:remote`, which sets D1_REMOTE_SMOKE, so a plain `vp test` stays local even
      // with the credentials in the environment (#202). Still skipped without them.
      ...(process.env["D1_REMOTE_SMOKE"] === "1"
        ? [
            {
              extends: true,
              test: {
                name: "remote",
                include: ["tests/remote/**/*.test.ts"],
                testTimeout: 60_000,
                hookTimeout: 120_000,
              },
            },
          ]
        : []),
    ],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      // Size and complexity limits: small, understandable internals (brief, principle 5).
      complexity: ["error", { max: 10 }],
      "max-depth": ["error", { max: 3 }],
      "max-params": ["error", { max: 4 }],
      "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
      // Turning off one of the repo's own rules says why, after `--` (scripts/lint/).
      "arbor/disable-reason": "error",
      // A predicate starts with 'is' or 'has', where its return type is written (#380) or its body
      // answers yes or no (#525).
      "arbor/predicate-name": "error",
    },
    jsPlugins: ["./scripts/lint/plugin.mjs", "eslint-plugin-regexp"],
    overrides: [
      {
        // Each library and command line module opens with what it owns (scripts/lint/), and stays
        // small enough to read: a module that outgrows the limit is split, not exempted. Its
        // regexes take linear time, since an app's or a database's text reaches them (#404).
        files: ["packages/*/src/**/*.ts", "packages/*/cli/**/*.ts"],
        rules: {
          "arbor/module-header": "error",
          // The library's own lookups by a record's key keep it as stored (#354).
          "arbor/stored-key-lookup": "error",
          "regexp/no-super-linear-move": "error",
          "regexp/no-super-linear-backtracking": "error",
          "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
        },
      },
      {
        // The project reader sits below the schema reader: schema/ imports project/, never back.
        files: ["packages/arbor/cli/project/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["../schema", "../schema/**", "**/cli/schema/**"],
                  message:
                    "cli/project/ sits below cli/schema/: move what both need into cli/project/.",
                },
              ],
            },
          ],
        },
      },
      {
        // The core knows a database only through an Adapter, so it never imports one (ADR-0016):
        // the command loads its adapters' plugins by name, with import() (cli/project/adapters.ts).
        files: ["packages/arbor/**/*.ts"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: [
                    "**/adapters/**",
                    "@forestfuture/arbor/d1",
                    "@forestfuture/arbor/postgresql",
                  ],
                  message: "The core reaches a database through its Adapter: see src/adapter.ts.",
                },
              ],
            },
          ],
        },
      },
      {
        // The registry of adapters, the one module that loads their plugins, with import().
        files: ["packages/arbor/cli/project/adapters.ts"],
        rules: { "no-restricted-imports": "off" },
      },
      {
        // An adapter reaches the core only as an app's install would, through its entries, and
        // never another adapter: its imports stay in its own folder (#301).
        files: ["packages/arbor/src/adapters/**/*.ts", "packages/arbor/cli/adapters/**/*.ts"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["../*", "../**", "**/arbor/src/**", "**/arbor/cli/**"],
                  message:
                    "Import the core from @forestfuture/arbor, or its /adapter or /cli entry.",
                },
                {
                  group: ["@forestfuture/arbor/d1", "@forestfuture/arbor/postgresql"],
                  message: "An adapter never imports another adapter.",
                },
              ],
            },
          ],
        },
      },
      {
        // Comments and test names say what the code does, not where the idea came from
        // (CODING_STANDARDS.md, Names and comments; #515).
        files: ["packages/*/src/**", "packages/*/cli/**", "tests/**"],
        // The words are the names of where an idea came from.
        rules: { "arbor/say-what-it-does": ["error", { words: ["Rails"] }] },
      },
      {
        // A file `active-record schema` writes is left as written: its comments carry table and
        // migration names, and it's regenerated, not edited.
        files: [
          "tests/fixtures/DB.ts",
          "tests/fixtures/LOGS.ts",
          "tests/fixtures/schema-project/schema.ts",
        ],
        rules: { "arbor/say-what-it-does": "off" },
      },
      {
        // A describe() callback holds a whole suite, so it's long by design. The rules below are
        // CODING_STANDARDS.md's Tests: a test waits on an event, a gate, or a polled state, never
        // a fixed delay. It asserts results, not SQL text. It acts on one Model. Its name stands
        // alone.
        files: ["tests/**"],
        rules: {
          "max-lines-per-function": "off",
          "arbor/no-fixed-delay": "error",
          "arbor/no-sql-text": "error",
          "arbor/one-model-per-test": "error",
          "arbor/standalone-test-name": "error",
        },
      },
      {
        // Running a command compiles the library through jiti, too slow for the unit project's
        // 5 s default, so a test that runs one goes where commandTestTimeout applies (#485). The
        // command line's main() stays open to unit tests, for its usage and unknown-flag answers.
        files: ["tests/unit/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["**/cli/*/command.ts"],
                  importNamePattern: "^(run|watch)",
                  message:
                    "Running a command compiles the library: put the test in integration:d1 or integration:pg.",
                },
                {
                  group: ["**/cli/project/load.ts"],
                  importNames: ["loadLibrary"],
                  message:
                    "Running a command compiles the library: put the test in integration:d1 or integration:pg.",
                },
                {
                  group: ["**/cli/schema/models.ts"],
                  importNames: ["withModels"],
                  message:
                    "Running a command compiles the library: put the test in integration:d1 or integration:pg.",
                },
                {
                  group: ["**/cli/console/project.ts"],
                  importNames: ["loadProject"],
                  message:
                    "Running a command compiles the library: put the test in integration:d1 or integration:pg.",
                },
              ],
            },
          ],
        },
      },
      {
        // toSql's SQL text is the result its own tests check.
        files: ["tests/conformance/to-sql.test.ts"],
        rules: { "arbor/no-sql-text": "off" },
      },
    ],
  },
  fmt: {
    // Kept verbatim: the original design brief, skills vendored from upstream, and the guide's
    // page projects' schemas, as active-record schema writes them.
    ignorePatterns: [
      "docs/brief.md",
      ".claude/skills/**",
      "skills-lock.json",
      "site/snippets/pages/*/src/db/schema.ts",
    ],
  },
});
