// Counters (#351): adding to number attributes in the row, `SET x = COALESCE(x, 0) + n`, for `updateCounters` and a record's `incrementColumn`, and the attribute types they take.
import type { NumberAttributeKey } from "./attribute-writes.ts";
import { attributeOf } from "./metadata.ts";
import type { ModelClass } from "./model.ts";
import { column, SafeSql } from "./sql.ts";

/** What `updateCounters` adds to each number attribute: `{ viewCount: 1 }`. */
export type Counters<R> = { [K in NumberAttributeKey<R>]?: number };

/**
 * `x = COALESCE(x, 0) + ?, …` for each counter, so a NULL counts as zero and concurrent writes
 * all count. `{}`, or an attribute that isn't a number, is a `TypeError`.
 */
export function counterSets(
  model: ModelClass,
  counters: Readonly<Record<string, unknown>>,
  method: string,
): SafeSql {
  const entries = Object.entries(counters);
  if (entries.length === 0) throw new TypeError(`${method} needs at least one counter`);
  const strings = [""];
  const values: unknown[] = [];
  for (const [index, [name, by]] of entries.entries()) {
    requireAttributeType(model, name, method, "integer", "real");
    if (index > 0) strings[strings.length - 1] = ", ";
    values.push(column(name), column(name), column(name).value(by));
    strings.push(" = COALESCE(", ", 0) + ", "");
  }
  return new SafeSql(strings, values);
}

/**
 * An amount to add, refused with a `TypeError` unless it's a finite number, as untyped code
 * could pass a string from a form (`"5"`, which `+` would join) or `null`.
 */
export function amount(by: unknown, method: string): number {
  if (typeof by !== "number" || !Number.isFinite(by)) {
    throw new TypeError(`${method} adds a finite number; got ${String(by)}`);
  }
  return by;
}

/**
 * Refuses an attribute whose type isn't one of `types` (an enum or a custom type isn't), with a
 * `TypeError` naming the Model and attribute, since the compiler can't catch every caller.
 */
export function requireAttributeType(
  model: ModelClass,
  name: string,
  method: string,
  ...types: string[]
): void {
  const definition = attributeOf(model, name);
  const isPlain = definition.enum === undefined && definition.customType === undefined;
  if (!isPlain || !types.includes(definition.type)) {
    throw new TypeError(
      `${model.name}.${method}("${name}") takes ${types.join(" or ")} attributes; ` +
        `${name} isn't one`,
    );
  }
}
