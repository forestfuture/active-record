// Writing prepared writes as one atomic batch, then committing each and running its callbacks; and a save's or destroy's stages, each such a batch on its database.
import type { CompiledSql } from "./compiler.ts";
import type { StatementResult } from "./driver.ts";
import { pinBefore, type Executor } from "./executor.ts";
import type { Model } from "./model.ts";
import { linksOf } from "./record-state.ts";

/**
 * One part of a unit of work, prepared: its statements, what the record takes on once they're
 * written, and the callbacks that run after that.
 */
export interface PreparedWrite {
  statements: readonly CompiledSql[];
  /** Called with the results of its own statements, in order, once the batch succeeded. */
  commit(results: readonly StatementResult[]): void;
  after(): Promise<void>;
}

/** A prepared write for plain statements: nothing to commit, no callbacks. */
export function statementWrite(statements: readonly CompiledSql[]): PreparedWrite {
  return { statements, commit: () => {}, after: async () => {} };
}

/**
 * Sends every write's statements as one atomic batch (or one statement on its own), then
 * commits each write with its own results. Nothing is committed if D1 refuses the batch.
 */
export async function writeAll(
  executor: Executor,
  writes: readonly PreparedWrite[],
): Promise<StatementResult[]> {
  const statements = writes.flatMap((write) => write.statements);
  const results = statements.length === 0 ? [] : await executor.write(statements);
  let offset = 0;
  for (const write of writes) {
    write.commit(results.slice(offset, offset + write.statements.length));
    offset += write.statements.length;
  }
  return results;
}

/** Runs the after-callbacks of written writes, in order. */
export async function runAfter(writes: readonly PreparedWrite[]): Promise<void> {
  for (const write of writes) await write.after();
}

/**
 * One atomic batch of a save's or destroy's writes, on one database: the records it writes, the
 * handles of any statements it sends besides (a dependent's bulk write), and its writes, built
 * when it runs so foreign keys can be linked first. Its database is theirs.
 */
export interface Stage {
  records: readonly Model[];
  handles: readonly Executor[];
  writes(): PreparedWrite[];
}

/** Stage lists merged position by position: every list's first stage in one batch, and so on. */
export function combine(stageLists: readonly (readonly Stage[])[]): Stage[] {
  const length = Math.max(0, ...stageLists.map((stages) => stages.length));
  return Array.from({ length }, (_, index) => {
    const together = stageLists.flatMap((stages) => stages[index] ?? []);
    return {
      records: together.flatMap((stage) => stage.records),
      handles: together.flatMap((stage) => stage.handles),
      writes: () => together.flatMap((stage) => stage.writes()),
    };
  });
}

/** `stage`, with `first` run just before it builds its writes (linking its records' keys). */
export function afterLinking(stage: Stage, first: () => void): Stage {
  return {
    ...stage,
    writes: () => {
      first();
      return stage.writes();
    },
  };
}

/**
 * Writes `stages` one after another, each as one atomic batch on its database, then runs the
 * written writes' after-callbacks in order. Each stage's database is found, and its records pinned
 * to it, before anything is written: a stage on two databases throws `IncompatibleRelation`
 * ("`needs` on one database", #93). If a later stage fails, the earlier ones stay written, so
 * their after-callbacks still run before the error is thrown.
 */
export async function runStages(stages: readonly Stage[], needs: string): Promise<void> {
  const databases: Executor[] = [];
  for (const { records, handles } of stages) {
    databases.push(await pinBefore(linksOf(records), needs, handles));
  }
  const written: PreparedWrite[] = [];
  let failure: { error: unknown } | undefined;
  try {
    for (const [index, stage] of stages.entries()) {
      const writes = stage.writes();
      await writeAll(databases[index]!, writes);
      written.push(...writes);
    }
  } catch (error) {
    failure = { error };
  }
  await runAfter(written);
  if (failure !== undefined) throw failure.error;
}
