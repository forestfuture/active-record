// Read-only records and attributes (#358): refusing a read-only record's writes, and a save that
// changes a read-only attribute, before anything runs or is sent.
import { attributeName } from "./attribute-aliases.ts";
import { autosavedAfter } from "./autosave.ts";
import { lockVersion } from "./lock-version.ts";
import { resolveAssociation } from "./resolved-association.ts";
import { ReadonlyAttribute, ReadonlyRecord, type ReadonlyAction } from "./errors.ts";
import { modelOf, type Model, type ModelClass } from "./model.ts";
import { state } from "./record-state.ts";

/**
 * Refuses `action` on a read-only record, before its validation, callbacks or statements; and a
 * save of a persisted record whose read-only attribute changed without being assigned, in place.
 */
export function requireWritable(record: Model, action: ReadonlyAction): void {
  if (record[state].isReadonly) throw new ReadonlyRecord(record, action);
  if (action === "save") requireReadonlyAttributesKept(record);
}

/** The attributes every save writes, which can't be read-only: its timestamp and lock version. */
const writtenBySaves: readonly string[] = ["updatedAt", lockVersion];

/** A read-only attribute every save writes anyway, as a message, or undefined. */
export function readonlyProblem(where: string, name: string, readonly?: true): string | undefined {
  if (readonly !== true || !writtenBySaves.includes(name)) return undefined;
  return `${where} is written by every save, so it can't be readonly`;
}

/** Refuses a write straight to a row that sets a read-only attribute, `names`, before it's sent. */
export function requireWritableColumns(model: ModelClass, names: Iterable<string>): void {
  for (const given of names) {
    const name = attributeName(model, given);
    if (model.attributeDefinitions.get(name)?.readonly === true) {
      throw new ReadonlyAttribute(model.name, name);
    }
  }
}

/** A persisted record's read-only attributes, as it was loaded or created, or `ReadonlyAttribute`. */
function requireReadonlyAttributesKept(record: Model): void {
  const recordState = record[state];
  if (!recordState.isPersisted) return;
  requireWritableColumns(record.constructor as ModelClass, recordState.changedNames());
}

/**
 * Refuses a save that would write a read-only record through its owner's associations: saving or
 * destroying one marked for destruction. Checked before the owner's validation and callbacks.
 */
export function requireSavesWritable(records: readonly Model[]): void {
  for (const record of records) {
    requireWritable(record, record[state].isMarkedForDestruction ? "destroy" : "save");
    requireLinksWritable(record);
  }
}

/**
 * The read-only foreign keys a save would fill once a new record is inserted, refused before:
 * a persisted record's, pointed at a new one, and a persisted record's its new owner would fill.
 */
function requireLinksWritable(record: Model): void {
  const model = record.constructor as ModelClass;
  if (record[state].isPersisted) {
    for (const [name, target] of record[state].autosaves.allBelongsTo()) {
      if (!target[state].isNew) continue;
      requireWritableColumns(model, [resolveAssociation(model, name).ownerAttribute]);
    }
  }
  if (!record[state].isNew) return;
  for (const { association, record: linked, keepsKey, destroys } of autosavedAfter(
    record,
    new Set(),
  )) {
    if (keepsKey || destroys || !linked[state].isPersisted) continue;
    requireWritableColumns(modelOf(linked), [association.definition.foreignKey]);
  }
}
