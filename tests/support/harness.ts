// The conformance suite's database: the adapter its Vitest project names, opened with a schema.
import { inject } from "vite-plus/test";
import type { AnyDatabase } from "../../src/database.ts";
import type { Driver } from "../../src/driver.ts";
import type { QueryListener } from "../../src/executor.ts";

/** The adapters the conformance suite runs against, each through its own harness. */
export type AdapterName = "d1";

/** A schema the suite's tests ask for by name; each harness has its own SQL for it. */
export type SchemaName = "fixture" | "generated-ids";

/** How a test opens a Database on a harness. */
export interface ConnectOptions {
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
  /** Deletes every row of `tables`, in order. */
  reset(...tables: readonly string[]): Promise<void>;
  dispose(): Promise<void>;
}

/** Opens a harness for the adapter the running project names. Call once per file; dispose in `afterAll`. */
export async function openHarness({
  schema = "fixture",
}: { schema?: SchemaName } = {}): Promise<Harness> {
  const adapter = providedAdapter();
  switch (adapter) {
    case "d1":
      return (await import("./harnesses/d1.ts")).openD1Harness(schema);
  }
}

/**
 * The adapter the running project `provide`s (vite.config.ts). Vitest's `ProvidedContext` can't
 * be augmented from here, since `vitest` is only reachable through `vite-plus`, so it's checked.
 */
function providedAdapter(): AdapterName {
  const adapter = (inject as (key: string) => unknown)("adapter");
  if (adapter === "d1") return adapter;
  throw new Error(`A conformance project must provide a known adapter, not ${String(adapter)}`);
}
