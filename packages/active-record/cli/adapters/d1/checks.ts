// The names a `CHECK (… IN …)` restricts a column to, from a table's definition (#64).

/** A column name as SQLite takes it: bare, or quoted with "", ``, or []. */
const columnName = String.raw`(?:"([^"]+)"|\x60([^\x60]+)\x60|\[([^\]]+)\]|(\w+))`;

/** A list of SQL string literals: `'draft', 'it''s'`. */
const stringList = String.raw`'(?:[^']|'')*'(?:\s*,\s*'(?:[^']|'')*')*`;

/** `CHECK (status IN ('draft', 'published'))`, with the column and the list captured. */
const inCheck = new RegExp(
  String.raw`CHECK\s*\(\s*${columnName}\s+IN\s*\(\s*(${stringList})\s*\)\s*\)`,
  "gi",
);

/** A list's literals as their text: `'a', 'it''s'` → `["a", "it's"]`. */
function literals(list: string): string[] {
  return [...list.matchAll(/'((?:[^']|'')*)'/g)].map((match) => match[1]!.replaceAll("''", "'"));
}

/** Each column a table's definition restricts to a list of strings, with the list. */
export function checkedNames(definition: string): Map<string, string[]> {
  const lists = new Map<string, string[]>();
  for (const match of definition.matchAll(inCheck)) {
    const column = match.slice(1, 5).find(Boolean)!;
    lists.set(column, literals(match[5]!));
  }
  return lists;
}
