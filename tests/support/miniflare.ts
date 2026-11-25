// Starts Miniflare for the tests and benchmarks: one Worker and its bindings, in Miniflare's config, kept off the machine's dev registry and telemetry.
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { Miniflare, type WorkerOptions } from "miniflare";

/** The Worker a test runs, and the bindings its env holds. */
export interface TestWorker {
  /** The path of the Worker's bundled module. Without it, the Worker is empty. */
  main?: string;
  compatibilityDate?: string;
  compatibilityFlags?: string[];
  /** D1 bindings, each to its database's id. */
  d1?: Record<string, string>;
  /** Plain-text bindings. */
  vars?: Record<string, string>;
  /** Hyperdrive bindings, each to the connection string it reaches locally. */
  hyperdrives?: Record<string, string>;
  /** The folder D1 databases persist in, as Wrangler's local state. Without it, they're in memory. */
  persistTo?: string;
}

type Env = NonNullable<WorkerOptions["config"]["env"]>;

/** `worker` running in Miniflare. Dispose of it when the test is done. */
export function startMiniflare(worker: TestWorker = {}): Miniflare {
  return new Miniflare({
    enableDevRegistry: false,
    telemetry: { enabled: false },
    resourcePersistencePath: worker.persistTo,
    workers: [
      {
        config: {
          name: "test",
          compatibilityDate: worker.compatibilityDate ?? "2025-09-01",
          compatibilityFlags: worker.compatibilityFlags ?? [],
          manifest: manifest(worker.main),
          env: env(worker),
        },
      },
    ],
  });
}

/** The Worker's one module: the file at `main`, or an empty Worker. */
function manifest(main: string | undefined) {
  const contents = main === undefined ? "export default {}" : readFileSync(main, "utf8");
  const name = main === undefined ? "index.mjs" : basename(main);
  return {
    mainModule: name,
    modulesRoot: main === undefined ? process.cwd() : dirname(main),
    modules: { [name]: { type: "esm" as const, contents } },
  };
}

/** The Worker's env, each binding as Miniflare's config writes it. */
function env({ d1 = {}, vars = {}, hyperdrives = {} }: TestWorker): Env {
  const entries: [string, Env[string]][] = [
    ...Object.entries(d1).map(([name, id]): [string, Env[string]] => [name, { type: "d1", id }]),
    ...Object.entries(vars).map(([name, value]): [string, Env[string]] => [
      name,
      { type: "text", value },
    ]),
    ...Object.entries(hyperdrives).map(([name, connectionString]): [string, Env[string]] => [
      name,
      { type: "hyperdrive", id: name, dev: { connectionString } },
    ]),
  ];
  return Object.fromEntries(entries);
}
