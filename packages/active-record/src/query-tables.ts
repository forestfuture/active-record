// The tables one query reads (#24): its Model's, and each it joins, by the name each goes by in its SQL.
import { attributeFor } from "./attribute.ts";
import { pluralize } from "./inflections.ts";
import type { Model, ModelClass } from "./model.ts";
import { underscore } from "./naming.ts";
import { isJoining, type Join, type QueryDescription } from "./query.ts";

/** Quotes an identifier; embedded double quotes are doubled. */
export function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * One table a query reads, as its SQL names it: `name` is its table's name or an alias, quoted,
 * and its columns are qualified with it when the query reads more than one table.
 */
export interface Source {
  readonly model: ModelClass<Model>;
  readonly name: string;
  readonly qualified: boolean;
}

/** The column of `source`'s attribute, quoted, and qualified when its query joins. */
export function columnIn(source: Source, attribute: string): string {
  const column = quoteIdentifier(attributeFor(source.model, attribute).column);
  return source.qualified ? `${source.name}.${column}` : column;
}

/** `model`'s table alone, its columns unqualified: what a write to it names. */
export function unqualifiedSource(model: ModelClass<Model>): Source {
  return { model, name: quoteIdentifier(model.table), qualified: false };
}

/** A query's own table: its Model's, by the table's name, whatever it joins. */
export function ownSource(query: QueryDescription): Source {
  const name = quoteIdentifier(query.model.table);
  return { model: query.model, name, qualified: isJoining(query) };
}

/** One joined table: its join, the table it's joined to, and its own name, with an alias if any. */
interface JoinedTable {
  readonly join: Join;
  readonly parent: Source;
  readonly source: Source;
  /** Its alias, unquoted, when its table's name was already taken in the query. */
  readonly alias?: string;
  /** The association names leading to it from the query's Model, `"."`-joined. */
  readonly path: string;
}

/** Every table `query` reads: its own, then each joined, in the order the SQL joins them. */
export interface Tables {
  readonly own: Source;
  readonly joined: readonly JoinedTable[];
}

/**
 * Names each of `query`'s joined tables as Rails does: by its table's name, or when that's
 * taken (in any case), `<plural association>_<table joined to>`, cut to the 63 bytes Postgres
 * keeps, then with `_2`, `_3`, … if that's taken too.
 */
export function tablesOf(query: QueryDescription): Tables {
  const own = ownSource(query);
  const taken = new Set([query.model.table.toLowerCase()]);
  const joined: JoinedTable[] = [];
  const visit = (joins: readonly Join[], parent: Source, prefix: string) => {
    for (const join of joins) {
      const alias = aliasFor(join, parent.model, taken);
      const name = quoteIdentifier(alias ?? join.model.table);
      const source = { model: join.model, name, qualified: true };
      const path = prefix + join.association;
      joined.push({ join, parent, source, path, ...(alias !== undefined && { alias }) });
      visit(join.joins, source, `${path}.`);
    }
  };
  visit(query.joins ?? [], own, "");
  return { own, joined };
}

/**
 * The alias `join`'s table needs, taking the name it goes by; none if its table's name is free.
 * Names are compared without case, as SQLite reads them, and an alias is cut to the bytes
 * Postgres keeps of a name, so two aliases never read as one.
 */
function aliasFor(join: Join, parent: ModelClass, taken: Set<string>): string | undefined {
  const { table } = join.model;
  if (!taken.has(table.toLowerCase())) {
    taken.add(table.toLowerCase());
    return undefined;
  }
  const candidate = `${underscore(pluralize(join.association))}_${parent.table}`;
  let alias = fitted(candidate, "");
  for (let count = 2; taken.has(alias.toLowerCase()); count++) {
    alias = fitted(candidate, `_${count}`);
  }
  taken.add(alias.toLowerCase());
  return alias;
}

/** The bytes of a name Postgres keeps; it reads a longer one as its first 63. */
const MAX_NAME_BYTES = 63;

/** `name`, cut so that it and `suffix` fit in a name's bytes, then `suffix`. */
function fitted(name: string, suffix: string): string {
  const encoder = new TextEncoder();
  // Cut by characters, so a character beyond the ASCII ones is never split.
  const characters = Array.from(name);
  while (encoder.encode(characters.join("") + suffix).length > MAX_NAME_BYTES) characters.pop();
  return characters.join("") + suffix;
}

/** The table of the join `path` names in `tables`. */
export function sourceAt(tables: Tables, path: string): Source {
  const joined = tables.joined.find((table) => table.path === path);
  if (joined === undefined) throw new Error(`active-record: no join at "${path}"`);
  return joined.source;
}
