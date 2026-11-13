// Writing prepared writes as one atomic batch, then committing each and running its callbacks, or telling each it failed; and a save's or destroy's stages, each such a batch on its database.
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
  /**
   * Called when its batch fails, before its rollback callbacks: undoes what preparing it changed,
   * and returns an error to throw in place of the database's, if this write explains it (#40).
   */
  failed?(error: unknown): Error | undefined;
}

/** A prepared write for plain statements: nothing to commit, no callbacks. */
export function statementWrite(statements: readonly CompiledSql[]): PreparedWrite {
  return { statements, commit: () => {}, after: async () => {} };
}

/**
 * Sends every write's statements as one atomic batch (or one statement on its own), then
 * commits each write with its own results. If the database refuses the batch, nothing is
 * committed: each write hears it failed, its rollback callbacks run, then the database's error
 * is thrown (or one a write explains it as), unless a rollback callback throws first (see
 * `whileHandling`).
 */
export async function writeAll(
  executor: Executor,
  writes: readonly PreparedWrite[],
): Promise<StatementResult[]> {
  let results: StatementResult[];
  try {
    results = await send(executor, writes);
  } catch (refusal) {
    await whileHandling(refusal, () => rollBack(writes));
    throw refusal;
  }
  commitAll(writes, results);
  return results;
}

/**
 * Sends every write's statements as one atomic batch. The database's refusal is thrown, or an
 * error one of the writes explains it as.
 */
async function send(
  executor: Executor,
  writes: readonly PreparedWrite[],
): Promise<StatementResult[]> {
  const statements = writes.flatMap((write) => write.statements);
  try {
    return statements.length === 0 ? [] : await executor.write(statements);
  } catch (refusal) {
    throw explained(writes, refusal);
  }
}

/**
 * Tells each refused write it failed: the error one of them explains the refusal as, or else the
 * refusal.
 */
function explained(writes: readonly PreparedWrite[], refusal: unknown): unknown {
  return writes.map((write) => write.failed?.(refusal)).find((each) => each) ?? refusal;
}

/** Commits each written write with its own statements' results, in order. */
function commitAll(writes: readonly PreparedWrite[], results: readonly StatementResult[]): void {
  let offset = 0;
  for (const write of writes) {
    write.commit(results.slice(offset, offset + write.statements.length));
    offset += write.statements.length;
  }
}

/** Runs each refused write's rollback callbacks, in order. */
async function rollBack(writes: readonly PreparedWrite[]): Promise<void> {
  for (const write of writes) await write.afterRollback?.();
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
    // A frozen error can't take one, and trying would throw a TypeError in its place.
    if (thrown instanceof Error && Object.isExtensible(thrown) && !Object.hasOwn(thrown, "cause")) {
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
 * earlier ones stay written: the refused stage's rollback callbacks run, then the earlier ones'
 * after- and commit callbacks, then the error is thrown. A callback that throws on the way
 * skips the callbacks after it, and its error is thrown instead (see `whileHandling`).
 */
export async function runStages(stages: readonly Stage[], needs: string): Promise<void> {
  const databases = await pinGroups(stages, needs);
  const written: PreparedWrite[] = [];
  const failure = await writeStages(stages, databases, written);
  if (failure === undefined) return runAfter(written);
  const { error, refused } = failure;
  await whileHandling(error, () => rollBack(refused));
  await whileHandling(error, () => runAfter(written));
  throw error;
}

/** Why `runStages` stopped: the error, and the writes of the stage it refused (none if unsent). */
interface StageFailure {
  error: unknown;
  refused: readonly PreparedWrite[];
}

/** Writes each stage in turn, adding its writes to `written`; the first failure stops them. */
async function writeStages(
  stages: readonly Stage[],
  databases: Map<object, Executor>,
  written: PreparedWrite[],
): Promise<StageFailure | undefined> {
  for (const stage of stages) {
    let writes: PreparedWrite[] = [];
    let results: StatementResult[];
    try {
      writes = stage.writes();
      results = await send(databases.get(stage.group)!, writes);
    } catch (error) {
      return { error, refused: writes };
    }
    commitAll(writes, results);
    written.push(...writes);
  }
  return undefined;
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
