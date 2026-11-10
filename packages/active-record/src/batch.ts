// A Batch's steps, and the free `batch()`: its one database pinned, before-callbacks, one atomic write, then after-callbacks.
import { savingGroups } from "./autosave.ts";
import { IncompatibleRelation, RecordNotSaved } from "./errors.ts";
import { prepareDestroy, prepareSave, refusalError, stagesOf, type Claimed } from "./lifecycle.ts";
import { RecordStatement, recordStatementParts } from "./record-statement.ts";
import { linksOf, state } from "./record-state.ts";
import { runAfter, writeAll, type PreparedWrite } from "./unit-of-work.ts";
import { pinBefore, pinClaimed, type Executor } from "./executor.ts";
import { modelOf, type Model } from "./model.ts";
import { dependentsElsewhere } from "./dependents.ts";
import { statementParts, type Statement, type WriteResult } from "./statement.ts";

/** The Executor an entry was built on: its Relation's, or its record's. */
function executorOf(entry: BatchEntry): Executor {
  return entry instanceof RecordStatement
    ? entry[recordStatementParts].record[state].executor
    : entry[statementParts].executor;
}

/**
 * The records a batch entry writes: a save's whole autosave graph, or a destroy's record. One
 * that would also write on another database (#228) is refused, since a batch writes one.
 */
function recordsOf(entry: BatchEntry, needs: string): Model[] {
  if (!(entry instanceof RecordStatement)) return [];
  const { record, kind } = entry[recordStatementParts];
  const { name } = modelOf(record);
  if (kind === "destroy") {
    const [elsewhere] = dependentsElsewhere(modelOf(record));
    if (elsewhere !== undefined) {
      throw new IncompatibleRelation(
        `${needs} on one database, and destroying this ${name} writes its dependent ` +
          `${elsewhere.label}, on another database; destroy it outside the batch`,
      );
    }
    return [record];
  }
  const [own, elsewhere] = savingGroups(record);
  if (elsewhere !== undefined) {
    throw new IncompatibleRelation(
      `${needs} on one database, and saving this ${name} autosaves records through ` +
        `${elsewhere.through!.label}, on another database; save it outside the batch`,
    );
  }
  return own!.records;
}

/**
 * A batch's steps: its one database found and every record pinned to it, before anything runs
 * (#93); then before-callbacks, one atomic write, then after-callbacks. Records a callback added
 * on the way are pinned too, before the write.
 */
export async function runBatch<const T extends readonly BatchEntry[]>(
  entries: T,
  needs: string,
  handles: readonly Executor[] = [],
): Promise<BatchResults<T>> {
  const statements = entries.filter((entry) => !(entry instanceof RecordStatement));
  const all = [...handles, ...statements.map(executorOf)];
  const records = entries.flatMap((entry) => recordsOf(entry, needs));
  if (all.length === 0 && records.length === 0) return [] as BatchResults<T>;
  const database = await pinBefore(linksOf(records), needs, all);
  // Each record is written once, even if listed twice or already saved by its owner.
  const claimed: Claimed = new Set();
  const prepared: PreparedEntry[] = [];
  for (const entry of entries) {
    prepared.push(
      entry instanceof RecordStatement ? await recordEntry(entry, claimed) : statementEntry(entry),
    );
  }
  await pinClaimed(linksOf(claimed), database, needs);
  const writes = prepared.flatMap(({ writes }) => writes());
  await writeAll(database, writes);
  await runAfter(writes);
  return prepared.map(({ result }) => result()) as BatchResults<T>;
}

/**
 * `db.batch`, on the database the entries were built on: the current one, for statements and
 * records from a Model's statics (`Product.toUpdateAll(…)`, `Product.build(…).toSave()`), or one
 * explicit `db`. Atomic, as `db.batch` is; entries from two databases throw `IncompatibleRelation`.
 */
export async function batch<const T extends readonly BatchEntry[]>(
  entries: T,
): Promise<BatchResults<T>> {
  // The database they're on now: entries from a Model's statics and from db.model(…) can be one.
  return runBatch(entries, "batch() needs its statements and records");
}

/** What `db.batch` accepts: statements, and records' save or destroy. */
export type BatchEntry = Statement<unknown> | RecordStatement;

/** `db.batch`'s result for each entry: a statement's `WriteResult`, or the saved or destroyed record. */
export type BatchResults<T extends readonly BatchEntry[]> = {
  -readonly [K in keyof T]: T[K] extends RecordStatement<infer R>
    ? R
    : T[K] extends Statement<infer Row>
      ? WriteResult<Row>
      : never;
};

interface PreparedEntry {
  /** Built when the batch is: every entry is prepared first, so foreign keys are linked. */
  writes: () => PreparedWrite[];
  result: () => unknown;
}

function statementEntry(statement: Statement<unknown>): PreparedEntry {
  let written: WriteResult<unknown> | undefined;
  const { query, landed, resultOf } = statement[statementParts];
  const write: PreparedWrite = {
    statements: [query],
    commit: ([result]) => {
      if (result !== undefined) written = resultOf(result);
      landed();
    },
    after: async () => {},
  };
  return { writes: () => [write], result: () => written };
}

/** A record's prepared save or destroy; a refusal throws, as a Rails transaction's `save!` does. */
async function recordEntry(statement: RecordStatement, claimed: Claimed): Promise<PreparedEntry> {
  const { record, kind } = statement[recordStatementParts];
  const plan = await (kind === "save"
    ? prepareSave(record, claimed)
    : prepareDestroy(record, claimed));
  if (plan.status !== "ready") throw refusalError(record, plan, kind);
  const stages = stagesOf(plan);
  if (stages.length > 1) {
    const { name } = record.constructor;
    throw new RecordNotSaved(
      `${name} can't be saved in a batch with the new records it autosaves: one of them needs a key D1 only generates when a record is written (the ${name}'s, or a new record it points at). Generate keys in code, or save it on its own`,
    );
  }
  return { writes: () => stages.flatMap((stage) => stage.writes()), result: () => record };
}
