// Counters (#351): adding to number attributes in the row, `SET x = COALESCE(x, 0) + n`, for `updateCounters` and a record's `incrementColumn`; the amounts they add; the timestamps their `touch` option sets (#61), which a record's `touch()` and a Relation's `touchAll` set too (#50); and refusing an attribute of the wrong type, for them and for `toggle`.
import type { DatetimeAttributeKey, NumberAttributeKey } from "./attribute-writes.ts";
import type { Assignment } from "./compiler.ts";
import { attributeOf, columnOf } from "./metadata.ts";
import type { ModelClass } from "./model.ts";
import { column, SafeSql } from "./sql.ts";

/** What `updateCounters` adds to each number attribute: `{ viewCount: 1 }`. */
export type Counters<R> = { [K in NumberAttributeKey<R>]?: number };

/**
 * What a counter's write also sets to now (#61), as Rails' `touch:`: `true` for `updatedAt`, or
 * a datetime attribute's name, or several, set with `updatedAt`.
 */
type Touch<R> = true | DatetimeAttributeKey<R> | readonly DatetimeAttributeKey<R>[];

/** What the counter writes take besides their counters: `touch`. */
export interface CounterOptions<R> {
  touch?: Touch<R>;
}

/** A counter write's timestamps: its `touch` option, or the assignments it already made. */
interface CounterTouch {
  touch?: unknown;
  touched?: readonly Assignment[];
}

/**
 * What `touch` sets, each to `now`: `updatedAt` when the Model has it, and those named, each a
 * datetime attribute (a `TypeError` naming `method` otherwise).
 */
export function touchAssignments(
  model: ModelClass,
  touch: unknown,
  method: string,
  now = new Date(),
): Assignment[] {
  if (touch === undefined || touch === false) return [];
  const named = touch === true ? [] : Array.isArray(touch) ? touch : [touch];
  const updatedAt = model.attributeDefinitions.get("updatedAt")?.type === "datetime";
  const names = [...new Set([...(updatedAt ? ["updatedAt"] : []), ...named.map(String)])];
  return names.map((name): Assignment => {
    if (columnOf(model, name).type !== "datetime") {
      throw new TypeError(
        `${model.name}.${method}: touch takes datetime attributes; ${name} isn't one`,
      );
    }
    return [name, now];
  });
}

/**
 * `x = COALESCE(x, 0) + ?, …` for each counter, so a NULL counts as zero and concurrent writes
 * all count, then the timestamps `touch` sets (or those already `touched`). `{}`, an attribute
 * that isn't a number, or an amount that isn't one, is a `TypeError`.
 */
export function counterSets(
  model: ModelClass,
  counters: Readonly<Record<string, unknown>>,
  method: string,
  { touch, touched }: CounterTouch = {},
): SafeSql {
  const entries = Object.entries(counters);
  if (entries.length === 0) throw new TypeError(`${method} needs at least one counter`);
  const strings = [""];
  const values: unknown[] = [];
  for (const [index, [name, by]] of entries.entries()) {
    columnOf(model, name); // a counter is written in SQL, so it needs a column (#356)
    requireAttributeType(model, name, method, "integer", "real");
    if (index > 0) strings[strings.length - 1] = ", ";
    values.push(column(name), column(name), column(name).value(amount(by, method)));
    strings.push(" = COALESCE(", ", 0) + ", "");
  }
  for (const [name, now] of touched ?? touchAssignments(model, touch, method)) {
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
