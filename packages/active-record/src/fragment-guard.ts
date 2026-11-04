// Refuses a bare date compared directly with an integer-stored attribute's column in a fragment (#149).
import { castValue, uncastable, zonelessDateTime } from "./conversion.ts";
import { attributeOf } from "./metadata.ts";
import type { ModelClass } from "./model.ts";
import { ColumnReference, type SafeSql } from "./sql.ts";

/** A comparison operator, alone between two interpolations. */
const comparison = /^\s*(?:=|==|<>|!=|<=|>=|<|>)\s*$/;
/** `BETWEEN` or `NOT BETWEEN`, alone before the first bound. */
const betweenLower = /^\s*(?:NOT\s+)?BETWEEN\s*$/i;
/** `AND`, alone between the two bounds. */
const betweenUpper = /^\s*AND\s*$/i;

/** What a bare value is, when it's date text a datetime column wouldn't hold as it is. */
function bareDatetimeKind(value: unknown): "Date" | "string" | undefined {
  if (value instanceof Date) return "Date";
  if (typeof value !== "string") return undefined;
  // Zone-less text is SQLite's own form, the likeliest to be passed by accident.
  const dateText =
    castValue({ type: "datetime" }, value) !== uncastable || zonelessDateTime.test(value);
  return dateText ? "string" : undefined;
}

/** The column a value at `index` follows, with only a comparison or `BETWEEN` between them. */
function columnBefore(fragment: SafeSql, index: number): ColumnReference | undefined {
  const { strings, values } = fragment;
  const between = strings[index] ?? "";
  const before = values[index - 1];
  if (
    before instanceof ColumnReference &&
    (comparison.test(between) || betweenLower.test(between))
  ) {
    return before;
  }
  // The upper bound: `column BETWEEN lower AND value`.
  const column = values[index - 2];
  const isUpper = betweenUpper.test(between) && betweenLower.test(strings[index - 1] ?? "");
  return isUpper && column instanceof ColumnReference ? column : undefined;
}

/** The column a value at `index` precedes: after a comparison, or the bounds of `BETWEEN`. */
function columnAfter(fragment: SafeSql, index: number): ColumnReference | undefined {
  const { strings, values } = fragment;
  const between = strings[index + 1] ?? "";
  const after = values[index + 1];
  if (
    after instanceof ColumnReference &&
    (comparison.test(between) || betweenLower.test(between))
  ) {
    return after;
  }
  // The upper bound: `value BETWEEN lower AND column`.
  const upper = values[index + 2];
  const isUpper = betweenLower.test(between) && betweenUpper.test(strings[index + 2] ?? "");
  return isUpper && upper instanceof ColumnReference ? upper : undefined;
}

/**
 * Throws `TypeError` when a fragment puts a bare date directly beside the column of an attribute
 * stored as a Unix time: it's bound as ISO text, which never compares with an integer (#149).
 * Only the text between interpolations is read, never a value.
 */
export function refuseBareDates(model: ModelClass, fragment: SafeSql): void {
  fragment.values.forEach((value, index) => {
    const kind = bareDatetimeKind(value);
    if (kind === undefined) return;
    const reference = columnBefore(fragment, index) ?? columnAfter(fragment, index);
    if (reference === undefined) return;
    const { storage } = attributeOf(model, reference.attribute);
    if (storage === undefined) return;
    throw new TypeError(
      `${model.name}: a ${kind} beside "${reference.attribute}", which is stored as ${storage}, ` +
        `is bound as ISO text. Use column("${reference.attribute}").value(…) for it.`,
    );
  });
}
