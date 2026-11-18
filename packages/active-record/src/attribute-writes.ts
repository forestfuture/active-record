// Changing one attribute (#351): `increment`, `decrement` and `toggle` in memory, the record methods every Model's records inherit from Model.
import { attributeOf } from "./metadata.ts";
import type { AttributesOf, Model, ModelClass } from "./model.ts";
import { ModelStatics } from "./model-statics.ts";
import { state } from "./record-state.ts";

/** The names of record type `R`'s attributes whose values are `V`: its numbers, or booleans. */
type AttributeKeyOf<R, V> = {
  [K in keyof AttributesOf<R>]: [NonNullable<AttributesOf<R>[K]>] extends [V] ? K : never;
}[keyof AttributesOf<R>] &
  string;

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
}

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
  const model = record.constructor as ModelClass;
  const definition = attributeOf(model, name);
  const isPlain = definition.enum === undefined && definition.customType === undefined;
  if (!isPlain || !types.includes(definition.type)) {
    throw new TypeError(
      `${model.name}.${method}("${name}") needs ${types.join(" or ")} attribute; ` +
        `${name} isn't one`,
    );
  }
}
