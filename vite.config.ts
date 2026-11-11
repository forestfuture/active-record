import { defineConfig } from "vite-plus";

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
    // floor, and CI runs it (#121). The Best Practices `dynamic_analysis` criterion asks for 80%.
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
        test: { name: "integration:d1", include: ["tests/integration/d1/**/*.test.ts"] },
      },
      {
        // The portable conformance suite, once per adapter, each through its harness (#267).
        extends: true,
        test: {
          name: "conformance:d1",
          include: ["tests/conformance/**/*.test.ts"],
          setupFiles: ["tests/support/conformance-setup.ts"],
          provide: { adapter: "d1" },
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
              test: { name: "integration:pg", include: ["tests/integration/pg/**/*.test.ts"] },
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
      "d1-record/disable-reason": "error",
    },
    jsPlugins: ["./scripts/lint/plugin.mjs"],
    overrides: [
      {
        // Each library and command line module opens with what it owns (scripts/lint/), and stays
        // small enough to read: a module that outgrows the limit is split, not exempted.
        files: ["packages/*/src/**/*.ts", "packages/*/cli/**/*.ts"],
        rules: {
          "d1-record/module-header": "error",
          "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
        },
      },
      {
        // The project reader sits below the schema reader: schema/ imports project/, never back.
        files: ["packages/active-record/cli/project/**"],
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
        files: ["packages/active-record/**/*.ts"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: [
                    "**/adapters/**",
                    "@forestfuture/active-record/d1",
                    "@forestfuture/active-record/postgresql",
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
        files: ["packages/active-record/cli/project/adapters.ts"],
        rules: { "no-restricted-imports": "off" },
      },
      {
        // An adapter reaches the core only as an app's install would, through its entries, and
        // never another adapter: its imports stay in its own folder (#301).
        files: [
          "packages/active-record/src/adapters/**/*.ts",
          "packages/active-record/cli/adapters/**/*.ts",
        ],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["../*", "../**", "**/active-record/src/**", "**/active-record/cli/**"],
                  message:
                    "Import the core from @forestfuture/active-record, or its /adapter or /cli entry.",
                },
                {
                  group: [
                    "@forestfuture/active-record/d1",
                    "@forestfuture/active-record/postgresql",
                  ],
                  message: "An adapter never imports another adapter.",
                },
              ],
            },
          ],
        },
      },
      {
        // A describe() callback holds a whole suite, so it's long by design. A test waits on an
        // event, a gate, or a polled state, never a fixed delay, and its name stands alone
        // (CODING_STANDARDS.md, Tests).
        files: ["tests/**"],
        rules: {
          "max-lines-per-function": "off",
          "d1-record/no-fixed-delay": "error",
          "d1-record/standalone-test-name": "error",
        },
      },
    ],
  },
  fmt: {
    // Kept verbatim: the original design brief, and skills vendored from upstream.
    ignorePatterns: ["docs/brief.md", ".claude/skills/**", "skills-lock.json"],
  },
});
