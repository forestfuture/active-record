// The names a `CHECK (… IN …)` restricts a column to, from the definitions `pg_get_constraintdef` writes back (#64).

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

/** A list's literals as their text, each once: `'a', 'it''s', 'a'` → `["a", "it's"]`. */
function literals(list: string): string[] {
  const texts = [...list.matchAll(/'((?:[^']|'')*)'/g)].map((match) => match[1]!);
  return [...new Set(texts.map((text) => text.replaceAll("''", "'")))];
}

/** The column a constraint restricts to a list of strings, with the list, if it's one. */
function restriction(definition: string): [string, string[]] | undefined {
  const match = inList.exec(bare(definition));
  if (match === null) return undefined;
  const column = unquoted(match[2]!);
  const nullable = [match[1], match[4]].filter((name) => name !== undefined).map(unquoted);
  return nullable.every((name) => name === column) ? [column, literals(match[3]!)] : undefined;
}

/**
 * Each column of a table that one CHECK restricts to a list of strings, with the list. A column
 * another CHECK also names isn't one: which of them holds isn't the schema's to say.
 */
export function checkedNames(constraints: readonly CheckConstraint[]): Map<string, string[]> {
  const named = new Map<string, number>();
  for (const { columns } of constraints) {
    for (const column of columns) named.set(column, (named.get(column) ?? 0) + 1);
  }
  const lists = new Map<string, string[]>();
  for (const { definition } of constraints) {
    const found = restriction(definition);
    if (found !== undefined && named.get(found[0]) === 1) lists.set(...found);
  }
  return lists;
}
