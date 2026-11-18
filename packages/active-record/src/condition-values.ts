// An attribute's condition as SQL (ADR-0018): equality with a value, NULL or a list, and comparisons, their values converted as the attribute's and bound.
import { type Attribute, noMatch } from "./attribute.ts";
import { type Comparison, comparisonParts, type Operator } from "./comparisons.ts";
import { type Dialect, valueMark } from "./dialect.ts";

/** `attr >= ?`, `attr BETWEEN ? AND ?`, …, with the values converted like the attribute's. */
export function compileComparison(
  { column, attribute }: { column: string; attribute: Attribute },
  comparison: Comparison,
  params: unknown[],
): string {
  const { operator, values } = comparison[comparisonParts];
  const stored = values.map((value) => attribute.conditionCell(value));
  if (stored.includes(noMatch)) return NOTHING;
  attribute.bindCells(params, ...stored);
  return COMPARISON_SQL[operator](column);
}

/**
 * A condition that matches no row: an empty list, or a value that can't be cast (#81), as in
 * Rails 6.1+, so a value from a URL is never an error or a NULL match.
 */
const NOTHING = "1 = 0";

/** Each comparison's SQL for a quoted column; values are bound in order. */
const COMPARISON_SQL: Record<Operator, (column: string) => string> = {
  ">": (column) => `${column} > ${valueMark}`,
  ">=": (column) => `${column} >= ${valueMark}`,
  "<": (column) => `${column} < ${valueMark}`,
  "<=": (column) => `${column} <= ${valueMark}`,
  between: (column) => `${column} BETWEEN ${valueMark} AND ${valueMark}`,
  betweenExcludingEnd: (column) => `(${column} >= ${valueMark} AND ${column} < ${valueMark})`,
};

/** `attr = value`, with NULL and arrays (IN) handled the way the contract specifies. */
export function compileEquality(
  dialect: Dialect,
  { column, attribute }: { column: string; attribute: Attribute },
  value: unknown,
  params: unknown[],
): string {
  if (value === null) return `${column} IS NULL`;
  if (!Array.isArray(value)) {
    const stored = attribute.conditionCell(value);
    if (stored === noMatch) return NOTHING;
    attribute.bindCells(params, stored);
    return `${column} = ${valueMark}`;
  }
  const present = value
    .filter((item) => item !== null)
    .map((item) => attribute.conditionCell(item))
    .filter((item) => item !== noMatch);
  const parts: string[] = [];
  if (present.length > 0) {
    const list = dialect.inList(column, present, attribute);
    attribute.bindCells(params, list.value);
    parts.push(list.sql);
  }
  if (value.includes(null)) parts.push(`${column} IS NULL`);
  return parts.length > 0 ? `(${parts.join(" OR ")})` : NOTHING;
}
