// Reads tables and their columns from Postgres's catalog, in the current schema: the same queries on PGlite and on a server.

/** Sends one statement and returns its rows: PGlite's or a `pg` client's, wrapped alike. */
export type Query = (sql: string) => Promise<Record<string, unknown>[]>;

/** One column as the catalog describes it. */
export interface Column {
  table: string;
  name: string;
  /** Its type as Postgres writes it: `character varying(40)`, `text[]`, `mood`. */
  declared: string;
  /** Its base type's name (a domain's underlying type): `varchar`, `_text`, `mood`. */
  base: string;
  /** Its base type's kind: `b` for a base type, `e` for an enum. */
  kind: string;
  /** Its base type's category: `A` for an array. */
  category: string;
  notNull: boolean;
  /** Its default as Postgres writes it back: `'it''s'::text`, `now()`. */
  defaultValue: string | null;
  primaryKey: boolean;
}

/** The current schema's own tables: ordinary and partitioned ones, not a partition or a view. */
const ownTables = `c.relnamespace = current_schema()::regnamespace
  AND c.relkind IN ('r', 'p') AND NOT c.relispartition`;

const columnsQuery = `
SELECT c.relname AS "table", a.attname AS "name",
  format_type(a.atttypid, a.atttypmod) AS "declared",
  b.typname AS "base", b.typtype AS "kind", b.typcategory AS "category",
  a.attnotnull AS "notNull", pg_get_expr(d.adbin, d.adrelid) AS "defaultValue",
  COALESCE(a.attnum = ANY (k.conkey), false) AS "primaryKey"
FROM pg_class c
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
JOIN pg_type t ON t.oid = a.atttypid
JOIN pg_type b ON b.oid = CASE WHEN t.typtype = 'd' THEN t.typbasetype ELSE t.oid END
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
LEFT JOIN pg_constraint k ON k.conrelid = c.oid AND k.contype = 'p'
WHERE ${ownTables}
ORDER BY c.relname, a.attnum`;

/** Each table's columns and constraints as one line of text, to tell when a migration changed it. */
const definitionsQuery = `
SELECT c.relname AS "table",
  (SELECT string_agg(concat_ws(' ', a.attname, format_type(a.atttypid, a.atttypmod),
      a.attnotnull, pg_get_expr(d.adbin, d.adrelid)), ', ' ORDER BY a.attnum)
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) || ' | ' ||
  COALESCE((SELECT string_agg(pg_get_constraintdef(k.oid), ', ' ORDER BY k.conname)
    FROM pg_constraint k WHERE k.conrelid = c.oid), '') AS "definition"
FROM pg_class c
WHERE ${ownTables}`;

/** Each table's definition, by name. */
export async function definitions(query: Query): Promise<Map<string, string>> {
  const rows = await query(definitionsQuery);
  return new Map(rows.map((row) => [String(row.table), String(row.definition)]));
}

/** Every column of the current schema's tables, by table, in column order. */
export async function columnsByTable(query: Query): Promise<Map<string, Column[]>> {
  const byTable = new Map<string, Column[]>();
  for (const row of await query(columnsQuery)) {
    const column = row as unknown as Column;
    const columns = byTable.get(column.table) ?? [];
    columns.push(column);
    byTable.set(column.table, columns);
  }
  return byTable;
}
