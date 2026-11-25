// Starts Miniflare for the tests and benchmarks: one Worker and its bindings, in Miniflare's config, kept off the machine's dev registry and telemetry.
import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { Miniflare, type WorkerOptions } from "miniflare";

/** The Worker a test runs, and the bindings its env holds. */
export interface TestWorker {
  /** The path of the Worker's bundled module, which must be a single file. Without it, the Worker is empty. */
  main?: string;
  compatibilityDate?: string;
  compatibilityFlags?: string[];
  /** D1 bindings, each to its database's id. */
  d1?: Record<string, string>;
  /** Plain-text bindings. */
  vars?: Record<string, string>;
  /** Hyperdrive bindings, each to the connection string it reaches locally. */
  hyperdrives?: Record<string, string>;
  /** The folder Miniflare keeps its local state in, as Wrangler's `.wrangler/state/v3` is. D1 databases land in its `d1` folder. Without it, they're in memory. */
  persistTo?: string;
}

type Env = NonNullable<WorkerOptions["config"]["env"]>;
type Binding = Env[string];

/** `worker` running in Miniflare. Dispose of it when the test or benchmark is done. */
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
  if (main === undefined) return singleModule(process.cwd(), "index.mjs", "export default {}");
  return singleModule(dirname(main), basename(main), readFileSync(main, "utf8"));
}

function singleModule(modulesRoot: string, name: string, contents: string) {
  return { mainModule: name, modulesRoot, modules: { [name]: { type: "esm" as const, contents } } };
}

/** The Worker's env, each binding as Miniflare's config writes it. */
function env({ d1 = {}, vars = {}, hyperdrives = {} }: TestWorker): Env {
  return {
    ...bindings(d1, (id) => ({ type: "d1", id })),
    ...bindings(vars, (value) => ({ type: "text", value })),
    ...bindings(hyperdrives, (connectionString, name) => ({
      type: "hyperdrive",
      id: name,
      dev: { connectionString },
    })),
  };
}

/** Each of `values` as the binding `toBinding` makes of it, under the same name. */
function bindings(
  values: Record<string, string>,
  toBinding: (value: string, name: string) => Binding,
): Env {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, toBinding(value, name)]),
  );
}
