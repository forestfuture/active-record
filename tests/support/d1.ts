import { readFileSync } from "node:fs";
import type { Miniflare } from "miniflare";
import { startMiniflare } from "./miniflare.ts";

const fixtureSchema = new URL("../fixtures/migrations/db/0001_schema.sql", import.meta.url);

export type TestDatabase = Awaited<ReturnType<Miniflare["getD1Database"]>>;

/**
 * Starts an isolated, in-memory D1 database backed by workerd and applies the
 * fixture schema (or another, such as a documentation example's migration).
 * Call once per test file and dispose of it in `afterAll`.
 */
export async function createTestDatabase(schema: URL | readonly URL[] = fixtureSchema): Promise<{
  db: TestDatabase;
  dispose: () => Promise<void>;
}> {
  const mf = startMiniflare({ d1: { DB: "DB" } });
  const db = await mf.getD1Database("DB");
  // Several files apply in order, as a project's migrations do.
  const statements = (Array.isArray(schema) ? schema : [schema])
    .map((file: URL) => readFileSync(file, "utf8"))
    .join(";\n")
    .split(/;\s*$/m)
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => db.prepare(statement));
  await db.batch(statements);
  return { db, dispose: () => mf.dispose() };
}

/**
 * `binding`, recording the number of statements in each batch it sends, and separately each one
 * its sessions send. A batch is one round trip to D1, but onQuery reports its statements one by
 * one, so it can't tell one batch from separate queries.
 */
export function recordingBatches(binding: TestDatabase): {
  binding: TestDatabase;
  batches: number[];
  sessionBatches: number[];
} {
  const batches: number[] = [];
  const sessionBatches: number[] = [];
  const recording = recordingProxy(binding, batches, (session) =>
    recordingProxy(session, sessionBatches, undefined),
  );
  return { binding: recording, batches, sessionBatches };
}

type TestSession = ReturnType<TestDatabase["withSession"]>;

/** `target` with its `batch` recorded in `batches`, and its sessions made by `wrapSession`. */
function recordingProxy<T extends TestDatabase | TestSession>(
  target: T,
  batches: number[],
  wrapSession: ((session: TestSession) => TestSession) | undefined,
): T {
  return new Proxy(target, {
    get(object, key) {
      if (key === "batch") {
        return (statements: Parameters<TestDatabase["batch"]>[0]) => {
          batches.push(statements.length);
          return object.batch(statements);
        };
      }
      if (key === "withSession" && wrapSession !== undefined) {
        return (constraint?: string) =>
          wrapSession((object as TestDatabase).withSession(constraint));
      }
      const value: unknown = Reflect.get(object, key);
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
}
