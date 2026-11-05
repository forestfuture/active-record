// The conformance suite's database: the adapter its Vitest project names, opened with a schema.
import { inject } from "vite-plus/test";
import type { AnyDatabase } from "../../packages/active-record/src/database.ts";
import type { Driver } from "../../packages/active-record/src/driver.ts";
import type { QueryListener } from "../../packages/active-record/src/executor.ts";

/** Each adapter the conformance suite runs against, and how its harness opens. */
const harnesses = {
  d1: async (schema: SchemaName) => (await import("./harnesses/d1.ts")).openD1Harness(schema),
  pg: async (schema: SchemaName) => (await import("./harnesses/pg.ts")).openPgHarness(schema),
} satisfies Record<string, (schema: SchemaName) => Promise<Harness>>;

/** The adapters the conformance suite runs against, each through its own harness. */
export type AdapterName = keyof typeof harnesses;

/** A schema the suite's tests ask for by name; each harness has its own SQL for it. */
export type SchemaName = "fixture" | "generated-ids" | "paginated";

/** How a test opens a Database on a harness. */
interface ConnectOptions {
  onQuery?: QueryListener;
  driver?: (driver: Driver) => Driver;
}

/** A fresh database on one adapter, its schema applied. */
export interface Harness {
  readonly adapter: AdapterName;
  /**
   * A Database on it, as the adapter's own `connect` opens one. `driver` wraps the adapter's
   * Driver, for a test that controls when statements land.
   */
  connect(options?: ConnectOptions): AnyDatabase;
  /**
   * Runs one statement of SQL that every adapter accepts, with `?` placeholders, bypassing the
   * library: for seeding rows and reading them back. Resolves to its rows.
   */
  exec(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
  /** `sql`, written with `?` placeholders, as this adapter sends it: on Postgres, with `$1`, `$2`, …. */
  asSent(sql: string): string;
  /** Deletes every row of `tables`, in order. */
  reset(...tables: readonly string[]): Promise<void>;
  dispose(): Promise<void>;
}

/** Opens a harness for the adapter the running project names. Call once per file; dispose in `afterAll`. */
export async function openHarness({
  schema = "fixture",
}: { schema?: SchemaName } = {}): Promise<Harness> {
  return harnesses[providedAdapter()](schema);
}

/**
 * The adapter the running project `provide`s (vite.config.ts). Vitest's `ProvidedContext` can't
 * be augmented from here, since `vitest` is only reachable through `vite-plus`, so it's checked.
 */
export function providedAdapter(): AdapterName {
  const adapter = (inject as (key: string) => unknown)("adapter");
  if (typeof adapter === "string" && Object.hasOwn(harnesses, adapter)) {
    return adapter as AdapterName;
  }
  throw new Error(`A conformance project must provide a known adapter, not ${String(adapter)}`);
}
