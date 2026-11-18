// Changing one attribute (#351): `increment`, `decrement` and `toggle` in memory, and `updateColumns`, straight to the row; the record methods every Model's records inherit from Model.
import { compileUpdate } from "./compiler.ts";
import { RecordNotSaved } from "./errors.ts";
import { attributeOf } from "./metadata.ts";
import type { AttributesOf, Model, ModelClass } from "./model.ts";
import { ModelStatics } from "./model-statics.ts";
import { state } from "./record-state.ts";

/** The names of record type `R`'s attributes whose values are `V`: its numbers, or booleans. */
type AttributeKeyOf<R, V> = {
  [K in keyof AttributesOf<R>]: [NonNullable<AttributesOf<R>[K]>] extends [V] ? K : never;
}[keyof AttributesOf<R>] &
  string;

/** An attribute's name on record type `R`. */
type AttributeKey<R> = keyof AttributesOf<R> & string;

/** A record's number attributes, which `increment` and `decrement` take. */
export type NumberAttributeKey<R> = AttributeKeyOf<R, number>;

/** A record's boolean attributes, which `toggle` takes. */
export type BooleanAttributeKey<R> = AttributeKeyOf<R, boolean>;

/**
 * The record methods that change one attribute, between Model and its statics: Model's records
 * have them, and model.ts stays the record class's own.
 */
export abstract class AttributeWrites extends ModelStatics {
  /** Adds `by` (one by default) to a number attribute, null counting as zero; doesn't save. */
  increment<R extends Model>(this: R, name: NumberAttributeKey<R>, by = 1): R {
    const current = numberValue(this, name, "increment");
    this[state].write(name, (current ?? 0) + by);
    return this;
  }

  /** Takes `by` (one by default) from a number attribute, null counting as zero; doesn't save. */
  decrement<R extends Model>(this: R, name: NumberAttributeKey<R>, by = 1): R {
    const current = numberValue(this, name, "decrement");
    this[state].write(name, (current ?? 0) - by);
    return this;
  }

  /** Flips a boolean attribute, null becoming `true`; doesn't save. */
  toggle<R extends Model>(this: R, name: BooleanAttributeKey<R>): R {
    requireType(this, name, "toggle", "boolean");
    this[state].write(name, this[state].read(name) !== true);
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
  requireType(record, name, method, "integer", "real");
  return record[state].read(name) as number | null;
}

/**
 * Refuses an attribute whose type isn't one of `types` (an enum or a custom type isn't), with a
 * `TypeError` naming the Model and attribute, since the compiler can't catch every caller.
 */
function requireType(record: Model, name: string, method: string, ...types: string[]): void {
  const model = modelOf(record);
  const definition = attributeOf(model, name);
  const isPlain = definition.enum === undefined && definition.customType === undefined;
  if (!isPlain || !types.includes(definition.type)) {
    throw new TypeError(
      `${model.name}.${method}("${name}") takes ${types.join(" or ")} attributes; ` +
        `${name} isn't one`,
    );
  }
}
