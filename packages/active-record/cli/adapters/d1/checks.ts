// The names a `CHECK (… IN …)` restricts a column to, from a table's definition (#64).
import { namesInList } from "@forestfuture/active-record/cli";

/**
 * A column name as SQLite takes it: bare, or quoted with "", ``, or [], on one line and at most
 * 128 characters, so an unclosed quote can't make a search scan the rest of the text each time.
 */
const columnName = String.raw`(?:"[^"\n]{1,128}"|\x60[^\x60\n]{1,128}\x60|\[[^\]\n]{1,128}\]|\w+)`;

/** A list of SQL string literals: `'draft', 'it''s'`. */
const stringList = String.raw`'(?:[^']|'')*'(?:\s*,\s*'(?:[^']|'')*')*`;

/**
 * `CHECK (status IN ('draft', 'published'))`, or with `status IS NULL OR` before it or
 * `OR status IS NULL` after it: the columns named, and the list.
 */
const inCheck = new RegExp(
  String.raw`CHECK\s*\(\s*(?:(${columnName})\s+IS\s+NULL\s+OR\s+)?(${columnName})\s+IN\s*\(\s*(${stringList})\s*\)(?:\s+OR\s+(${columnName})\s+IS\s+NULL)?\s*\)`,
  "gi",
);

/**
 * A string literal or a name quoted any of SQLite's ways, kept, or a comment, dropped: whichever
 * starts first, so a `'` or `--` inside a name doesn't start or hide anything. An unclosed `[`,
 * like an unclosed block comment, runs to the end, so a run of them isn't rescanned from each.
 */
const literalOrComment =
  /'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]?|--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g;

/** A definition without its comments, which SQLite keeps in it: `a TEXT -- CHECK (…)` → `a TEXT `. */
function withoutComments(definition: string): string {
  return definition.replace(literalOrComment, (token) =>
    token.startsWith("--") || token.startsWith("/*") ? " " : token,
  );
}

/** A column name as a key, as SQLite compares them: unquoted, any case. `"Status"` → `status`. */
function columnKey(name: string): string {
  return (/^["`[]/.test(name) ? name.slice(1, -1) : name).toLowerCase();
}

/** The column a match restricts, unless its `IS NULL` names another one. */
function restricted(match: RegExpMatchArray): string | undefined {
  const column = columnKey(match[2]!);
  const nullable = [match[1], match[4]].filter((name) => name !== undefined).map(columnKey);
  return nullable.every((name) => name === column) ? column : undefined;
}

/**
 * Each column a table's definition restricts to a list of strings, with the list, by its name in
 * lower case. A column two lists restrict isn't one: which list holds isn't the schema's to say.
 */
export function checkedNames(definition: string): Map<string, string[]> {
  const lists = new Map<string, string[] | undefined>();
  for (const match of withoutComments(definition).matchAll(inCheck)) {
    const column = restricted(match);
    if (column === undefined) continue;
    lists.set(column, lists.has(column) ? undefined : namesInList(match[3]!));
  }
  return new Map([...lists].filter((entry): entry is [string, string[]] => entry[1] !== undefined));
}
