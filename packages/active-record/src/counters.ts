// Counters (#351): adding to number attributes in the row, `SET x = COALESCE(x, 0) + n`, for `updateCounters` and a record's `incrementColumn`; the amounts they add; and refusing an attribute of the wrong type, for them and for `toggle`.
import type { DatetimeAttributeKey, NumberAttributeKey } from "./attribute-writes.ts";
import { attributeOf } from "./metadata.ts";
import type { ModelClass } from "./model.ts";
import { column, SafeSql } from "./sql.ts";

/** What `updateCounters` adds to each number attribute: `{ viewCount: 1 }`. */
export type Counters<R> = { [K in NumberAttributeKey<R>]?: number };

/**
 * What a counter's write also sets to now (#61), as Rails' `touch:`: `true` for `updatedAt`, or
 * a datetime attribute's name, or several, set with `updatedAt`.
 */
export type Touch<R> = true | DatetimeAttributeKey<R> | readonly DatetimeAttributeKey<R>[];

/** What the counter writes take besides their counters: `touch`. */
export interface CounterOptions<R> {
  touch?: Touch<R>;
}

/**
 * The attributes `touch` sets: `updatedAt` when the Model has it, and those named, each a
 * datetime attribute (a `TypeError` otherwise).
 */
export function touchedNames(model: ModelClass, touch: unknown): string[] {
  if (touch === undefined || touch === false) return [];
  const named = touch === true ? [] : Array.isArray(touch) ? touch : [touch];
  const updatedAt = model.attributeDefinitions.get("updatedAt")?.type === "datetime";
  const names = [...new Set([...(updatedAt ? ["updatedAt"] : []), ...named.map(String)])];
  for (const name of names) requireAttributeType(model, name, "touch", "datetime");
  return names;
}

/**
 * `x = COALESCE(x, 0) + ?, …` for each counter, so a NULL counts as zero and concurrent writes
 * all count. `{}`, an attribute that isn't a number, or an amount that isn't one, is a `TypeError`.
 */
export function counterSets(
  model: ModelClass,
  counters: Readonly<Record<string, unknown>>,
  method: string,
  touch?: unknown,
): SafeSql {
  const entries = Object.entries(counters);
  if (entries.length === 0) throw new TypeError(`${method} needs at least one counter`);
  const strings = [""];
  const values: unknown[] = [];
  for (const [index, [name, by]] of entries.entries()) {
    requireAttributeType(model, name, method, "integer", "real");
    if (index > 0) strings[strings.length - 1] = ", ";
    values.push(column(name), column(name), column(name).value(amount(by, method)));
    strings.push(" = COALESCE(", ", 0) + ", "");
  }
  const now = new Date();
  for (const name of touchedNames(model, touch)) {
    strings[strings.length - 1] = ", ";
    values.push(column(name), column(name).value(now));
    strings.push(" = ", "");
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
