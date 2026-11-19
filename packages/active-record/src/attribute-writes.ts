// Changing one attribute (#351): `increment`, `decrement` and `toggle` in memory, and `updateColumns`, `incrementColumn` and `toggleColumn`, straight to the row, and `touch` (#50); the record methods every Model's records inherit from Model.
import { compileUpdate } from "./compiler.ts";
import {
  amount,
  counterSets,
  requireAttributeType,
  touchAssignments,
  type CounterOptions,
} from "./counters.ts";
import { RecordNotSaved } from "./errors.ts";
import type { AttributesOf, Model, ModelClass, SpecsOf } from "./model.ts";
import { ModelStatics } from "./model-statics.ts";
import { state } from "./record-state.ts";
import { touchRecord, type TouchArguments } from "./touch.ts";

/**
 * The built-in type a spec names: `"integer"` for `"integer"` or `{ type: "integer" }`, and
 * `"custom"` for a custom type, given bare or as `{ type }`.
 */
type SpecType<S> = S extends string
  ? S
  : S extends { readonly type: infer T extends string }
    ? T
    : "custom";

/**
 * The names of record type `R`'s attributes of built-in type `T`, as the runtime checks them:
 * not an enum, nor a custom type, even one whose values are numbers.
 */
type AttributeKeyOf<R, T> = {
  [K in keyof SpecsOf<R>]: SpecsOf<R>[K] extends { readonly enum: unknown }
    ? never
    : SpecType<SpecsOf<R>[K]> extends T
      ? K
      : never;
}[keyof SpecsOf<R>] &
  string;

/** An attribute's name on record type `R`. */
type AttributeKey<R> = keyof AttributesOf<R> & string;

/** A record's number attributes, which `increment` and `decrement` take. */
export type NumberAttributeKey<R> = AttributeKeyOf<R, "integer" | "real">;

/** A record's datetime attributes, which `touch` (#50) and a counter's `touch` (#61) name. */
export type DatetimeAttributeKey<R> = AttributeKeyOf<R, "datetime">;

/** A record's boolean attributes, which `toggle` takes. */
export type BooleanAttributeKey<R> = AttributeKeyOf<R, "boolean">;

/**
 * The record methods that change one attribute, between Model and its statics: Model's records
 * have them, and model.ts stays the record class's own.
 */
export abstract class AttributeWrites extends ModelStatics {
  /** Adds `by` (one by default) to a number attribute, null counting as zero; doesn't save. */
  increment<R extends Model>(this: R, name: NumberAttributeKey<R>, by = 1): R {
    const current = numberValue(this, name, "increment");
    this[state].write(name, (current ?? 0) + amount(by, "increment"));
    return this;
  }

  /** Takes `by` (one by default) from a number attribute, null counting as zero; doesn't save. */
  decrement<R extends Model>(this: R, name: NumberAttributeKey<R>, by = 1): R {
    const current = numberValue(this, name, "decrement");
    this[state].write(name, (current ?? 0) - amount(by, "decrement"));
    return this;
  }

  /** Flips a boolean attribute, null becoming `true`; doesn't save. */
  toggle<R extends Model>(this: R, name: BooleanAttributeKey<R>): R {
    this[state].write(name, isTrueOnceToggled(this, name, "toggle"));
    return this;
  }

  /**
   * Writes these attributes straight to the row, with no validation, callback or `updatedAt`,
   * and leaves the record clean for them, as Rails' `update_columns`. Resolves to whether there
   * was a row to write. A new record is `RecordNotSaved`.
   */
  async updateColumns<R extends Model>(
    this: R,
    attributes: Partial<AttributesOf<R>>,
  ): Promise<boolean> {
    return writeColumns(this, attributes, "updateColumns");
  }

  /** `updateColumns` for one attribute. */
  async updateColumn<R extends Model, K extends AttributeKey<R>>(
    this: R,
    name: K,
    value: AttributesOf<R>[K],
  ): Promise<boolean> {
    return writeColumns(this, { [name]: value }, "updateColumn");
  }

  /**
   * Adds `by` to a number attribute in the row, as `SET x = COALESCE(x, 0) + by`, so concurrent
   * writes all count, with no validation, callback or `updatedAt`; the record then holds the
   * row's new value. An unsaved change to it is added too, as Rails' `increment!`. With
   * `{ touch }`, the same UPDATE sets `updatedAt` (and any datetime attributes named) to now, and
   * the record holds them (#50). Resolves to whether there was a row to write.
   */
  async incrementColumn<R extends Model>(
    this: R,
    name: NumberAttributeKey<R>,
    by = 1,
    { touch }: CounterOptions<R> = {},
  ): Promise<boolean> {
    const method = "incrementColumn";
    return addToColumn(this, name, amount(by, method), { method, touch });
  }

  /** `incrementColumn`, taking `by` away. */
  async decrementColumn<R extends Model>(
    this: R,
    name: NumberAttributeKey<R>,
    by = 1,
    { touch }: CounterOptions<R> = {},
  ): Promise<boolean> {
    const method = "decrementColumn";
    return addToColumn(this, name, -amount(by, method), { method, touch });
  }

  /**
   * Sets `updatedAt`, and the datetime attributes named, to now (or `{ time }`), straight to
   * the row, with no validation or save callback, as Rails' `touch`. Resolves to whether there
   * was a row to write.
   */
  async touch<R extends Model>(this: R, ...args: TouchArguments<R>): Promise<boolean> {
    requireSaved(this, "touch");
    return touchRecord(this, args);
  }

  /**
   * Writes a boolean attribute's flipped value straight to the row, as `updateColumn` does: no
   * validation or callback, unlike Rails' `toggle!`, which runs the save callbacks.
   */
  async toggleColumn<R extends Model>(this: R, name: BooleanAttributeKey<R>): Promise<boolean> {
    requireSaved(this, "toggleColumn");
    return writeColumns(
      this,
      { [name]: isTrueOnceToggled(this, name, "toggleColumn") },
      "toggleColumn",
    );
  }
}

/** Whether a boolean attribute is `true` once flipped (null becomes `true`); `TypeError` for another type. */
function isTrueOnceToggled(record: Model, name: string, method: string): boolean {
  requireAttributeType(modelOf(record), name, method, "boolean");
  return record[state].read(name) !== true;
}

/**
 * Adds to a number attribute in memory, then sends the difference from the row's value as it
 * was loaded, with any timestamps `touch` sets, and holds the values the row returns.
 */
async function addToColumn(
  record: Model,
  name: string,
  by: number,
  { method, touch }: { method: string; touch: unknown },
): Promise<boolean> {
  const recordState = record[state];
  requireSaved(record, method);
  const model = modelOf(record);
  const touched = touchAssignments(model, touch, method);
  const touchedNames = touched.map(([each]) => each);
  const after = (numberValue(record, name, method) ?? 0) + by;
  const delta = after - ((recordState.valueInDatabase(name) as number | null) ?? 0);
  recordState.write(name, after);
  const update = compileUpdate(
    model,
    counterSets(model, { [name]: delta }, method, { touched }),
    recordState.storedKey,
    [name, ...touchedNames],
  );
  const [result] = await recordState.executor.write([update]);
  recordState.commitColumns([name, ...touchedNames], result?.rows[0]);
  return result?.rowsAffected === 1;
}

/** Assigns `attributes`, then UPDATEs only them by the stored key, and marks them saved. */
async function writeColumns(
  record: Model,
  attributes: Record<string, unknown>,
  method: string,
): Promise<boolean> {
  const recordState = record[state];
  requireSaved(record, method);
  const names = Object.keys(attributes);
  if (names.length === 0) throw new TypeError(`${method} needs at least one attribute to write`);
  recordState.assign(attributes);
  const assignments = names.map((name): [string, unknown] => [name, recordState.read(name)]);
  const update = compileUpdate(modelOf(record), assignments, recordState.storedKey);
  const [result] = await recordState.executor.write([update]);
  recordState.commitColumns(names);
  return result?.rowsAffected === 1;
}

/** A write straight to the row needs one: a new record has none, and a destroyed one is read-only. */
function requireSaved(record: Model, method: string): void {
  const recordState = record[state];
  recordState.requireLive("be written");
  if (recordState.isNew) {
    throw new RecordNotSaved(
      `${modelOf(record).name} record hasn't been saved, so ${method} has no row to write`,
    );
  }
}

const modelOf = (record: Model): ModelClass => record.constructor as ModelClass;

/** A number attribute's value; `TypeError` for another type's. */
function numberValue(record: Model, name: string, method: string): number | null {
  requireAttributeType(modelOf(record), name, method, "integer", "real");
  return record[state].read(name) as number | null;
}
