// The names a `CHECK (… IN …)` restricts a column to, from the definitions `pg_get_constraintdef` writes back (#64).
import { listedNames } from "@forestfuture/active-record/cli";

/** A table's CHECK constraint: the columns it names, and its definition as Postgres writes it. */
export interface CheckConstraint {
  columns: readonly string[];
  /** `CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text])))`. */
  definition: string;
}

/** A column as Postgres writes it back: bare in lower case, or double-quoted. */
const columnName = String.raw`"(?:[^"]|"")+"|[a-z_][a-z0-9_$]*`;

/** A list of string literals, once their casts are gone: `'draft', 'it''s'`. */
const stringList = String.raw`'(?:[^']|'')*'(?:, '(?:[^']|'')*')*`;

/**
 * `status = ANY ARRAY['draft', 'published']`, alone or with `status IS NULL OR` before it or
 * `OR status IS NULL` after it, as a definition reads with its parentheses and casts taken out.
 */
const inList = new RegExp(
  String.raw`^CHECK (?:(${columnName}) IS NULL OR )?(${columnName}) = ANY ARRAY\[(${stringList})\](?: OR (${columnName}) IS NULL)?$`,
);

/**
 * A definition without its parentheses and casts, outside its string literals, with its spaces
 * collapsed: `CHECK (((b)::text = ANY ((ARRAY['a'::character varying])::text[])))` →
 * `CHECK b = ANY ARRAY['a']`.
 */
function bare(definition: string): string {
  return definition
    .split(/('(?:[^']|'')*')/)
    .map((part, index) => (index % 2 === 1 ? part : bareCode(part)))
    .join("")
    .trim();
}

/** A part of a definition outside its literals, without parentheses or casts, its spaces collapsed. */
function bareCode(part: string): string {
  return part.replace(/::(?:character varying|[a-z_]+)(?:\[\])?|[()]/g, "").replace(/\s+/g, " ");
}

/** A column name without its quotes: `"Dee"` → `Dee`. */
function unquoted(name: string): string {
  return name.startsWith('"') ? name.slice(1, -1).replaceAll('""', '"') : name;
}

/**
 * `status = 'draft'`, as Postgres writes back a one-name `IN ('draft')`: a restriction that
 * counts against a list on the same column, though it isn't read as one.
 */
const oneName = new RegExp(String.raw`^CHECK (${columnName}) = '(?:[^']|'')*'$`);

/** What a constraint restricts: its one column, and the names it lists, if it lists any. */
interface Restriction {
  column: string;
  names?: string[];
}

/** The column a constraint restricts to a list of strings, or to one, if it's that and on that column. */
function restriction({ columns, definition }: CheckConstraint): Restriction | undefined {
  const text = bare(definition);
  const match = inList.exec(text);
  if (match === null) {
    const single = oneName.exec(text);
    return single === null ? undefined : onItsColumn(unquoted(single[1]!), columns);
  }
  const column = unquoted(match[2]!);
  const nullable = [match[1], match[4]].filter((name) => name !== undefined).map(unquoted);
  if (!nullable.every((name) => name === column)) return undefined;
  const found = onItsColumn(column, columns);
  return found === undefined ? undefined : { ...found, names: listedNames(match[3]!) };
}

/** A restriction of `column`, if that's the only column the constraint names. */
function onItsColumn(column: string, columns: readonly string[]): Restriction | undefined {
  return columns.length === 1 && columns[0] === column ? { column } : undefined;
}

/**
 * Each column of a table that one CHECK restricts to a list of strings, with the list. A column
 * a second list (or a single name) also restricts isn't one, as on D1: which of them holds isn't
 * the schema's to say. Other CHECKs on it, such as `length(status) > 0`, don't count.
 */
export function checkedNames(constraints: readonly CheckConstraint[]): Map<string, string[]> {
  const byColumn = new Map<string, Restriction[]>();
  for (const constraint of constraints) {
    const found = restriction(constraint);
    if (found !== undefined)
      byColumn.set(found.column, [...(byColumn.get(found.column) ?? []), found]);
  }
  const lists = new Map<string, string[]>();
  for (const [column, [only, ...others]] of byColumn) {
    if (others.length === 0 && only!.names !== undefined) lists.set(column, only!.names);
  }
  return lists;
}
