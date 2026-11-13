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
  /** Its commit callbacks, run once every write's after-callbacks have. */
  afterCommit?(): Promise<void>;
  /** Its rollback callbacks, run when the database refuses the batch it was sent in. */
  afterRollback?(): Promise<void>;
}

/** A prepared write for plain statements: nothing to commit, no callbacks. */
export function statementWrite(statements: readonly CompiledSql[]): PreparedWrite {
  return { statements, commit: () => {}, after: async () => {} };
}

/**
 * Sends every write's statements as one atomic batch (or one statement on its own), then
 * commits each write with its own results. If the database refuses the batch, nothing is
 * committed: each write's rollback callbacks run, then the database's error is thrown.
 */
export async function writeAll(
  executor: Executor,
  writes: readonly PreparedWrite[],
): Promise<StatementResult[]> {
  const statements = writes.flatMap((write) => write.statements);
  const results = statements.length === 0 ? [] : await sendOrRollBack(executor, writes, statements);
  let offset = 0;
  for (const write of writes) {
    write.commit(results.slice(offset, offset + write.statements.length));
    offset += write.statements.length;
  }
  return results;
}

/** Sends `statements`; if the database refuses them, runs `writes`' rollback callbacks and rethrows. */
async function sendOrRollBack(
  executor: Executor,
  writes: readonly PreparedWrite[],
  statements: readonly CompiledSql[],
): Promise<StatementResult[]> {
  try {
    return await executor.write(statements);
  } catch (refusal) {
    await whileHandling(refusal, async () => {
      for (const write of writes) await write.afterRollback?.();
    });
    throw refusal;
  }
}

/**
 * Runs `callbacks` while `error` is being handled. An error one throws replaces it, and when
 * that's an `Error` without a cause of its own, `error` becomes its cause, as Ruby sets an
 * exception's cause when it's raised while another is handled.
 */
async function whileHandling(error: unknown, callbacks: () => Promise<void>): Promise<void> {
  try {
    await callbacks();
  } catch (thrown) {
    if (thrown instanceof Error && !Object.hasOwn(thrown, "cause")) {
      Object.defineProperty(thrown, "cause", { value: error, writable: true, configurable: true });
    }
    throw thrown;
  }
}

/** Runs the after-callbacks of written writes, in order, then their commit callbacks. */
export async function runAfter(writes: readonly PreparedWrite[]): Promise<void> {
  for (const write of writes) await write.after();
  for (const write of writes) await write.afterCommit?.();
}

/**
 * One atomic batch of a save's or destroy's writes, on one database: the records it writes, the
 * handles of any statements it sends besides (a dependent's bulk write), and its writes, built
 * when it runs so foreign keys can be linked first. Its database is theirs, and the same as every
 * other stage of its `group`'s: a record's own database, or an association's to another (#228),
 * which every record of the save writing through that association shares.
 */
export interface Stage {
  group: object;
  records: readonly Model[];
  handles: readonly Executor[];
  writes(): PreparedWrite[];
}

/** A stage of `group`'s writing `records`, and sending the statements of `handles`. */
export function stageOf(
  group: object,
  records: readonly Model[],
  writes: () => PreparedWrite[],
  handles: readonly Executor[] = [],
): Stage {
  return { group, records, handles, writes };
}

/** `stages`, all on the database of `group`. */
export function inGroup(stages: readonly Stage[], group: object): Stage[] {
  return stages.map((stage) => ({ ...stage, group }));
}

/**
 * Stage lists of one group merged position by position: every list's first stage in one batch,
 * and so on.
 */
export function combine(stageLists: readonly (readonly Stage[])[]): Stage[] {
  const length = Math.max(0, ...stageLists.map((stages) => stages.length));
  return Array.from({ length }, (_, index) => {
    const together = stageLists.flatMap((stages) => stages[index] ?? []);
    return stageOf(
      together[0]?.group ?? {},
      together.flatMap((stage) => stage.records),
      () => together.flatMap((stage) => stage.writes()),
      together.flatMap((stage) => stage.handles),
    );
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
 * written writes' after-callbacks in order, then their commit callbacks. Each group's database
 * is found, and its records pinned to it, before anything is written: a group on two databases
 * throws `IncompatibleRelation` ("`needs` on one database", #93). If a later stage fails, the
 * earlier ones stay written, so their after-callbacks and commit callbacks still run before
 * the error is thrown.
 */
export async function runStages(stages: readonly Stage[], needs: string): Promise<void> {
  const databases = await pinGroups(stages, needs);
  const written: PreparedWrite[] = [];
  let failure: { error: unknown } | undefined;
  try {
    for (const stage of stages) {
      const writes = stage.writes();
      await writeAll(databases.get(stage.group)!, writes);
      written.push(...writes);
    }
  } catch (error) {
    failure = { error };
  }
  if (failure === undefined) return runAfter(written);
  await whileHandling(failure.error, () => runAfter(written));
  throw failure.error;
}

/** Each group's one database, its stages' records pinned to it. */
async function pinGroups(stages: readonly Stage[], needs: string): Promise<Map<object, Executor>> {
  const groups = new Map<object, Stage[]>();
  for (const stage of stages) groups.set(stage.group, [...(groups.get(stage.group) ?? []), stage]);
  const databases = new Map<object, Executor>();
  for (const [group, members] of groups) {
    const records = members.flatMap((stage) => stage.records);
    const handles = members.flatMap((stage) => stage.handles);
    databases.set(group, await pinBefore(linksOf(records), needs, handles));
  }
  return databases;
}
