// What a migration's name says it does, as Rails' generator reads it, and the indexes the generators name.
import { pluralize } from "../../src/inflections.ts";
import { underscore } from "../../src/naming.ts";

/** What a migration's name says it does (`CreateProducts`, `AddSkuToProducts`, …), with its table plural. */
export type MigrationPlan =
  | { kind: "create" | "add" | "remove"; table: string }
  | { kind: "empty"; table?: undefined };

/** What to do, read from a migration's name: `create_products`, `add_sku_to_products`, …; else empty. */
export function migrationPlan(name: string): MigrationPlan {
  const words = underscore(name);
  const create = /^create_(\w+)$/.exec(words);
  if (create) return { kind: "create", table: pluralize(create[1]!) };
  const add = /^add_\w+?_to_(\w+)$/.exec(words);
  if (add) return { kind: "add", table: pluralize(add[1]!) };
  const remove = /^remove_\w+?_from_(\w+)$/.exec(words);
  return remove ? { kind: "remove", table: pluralize(remove[1]!) } : { kind: "empty" };
}

/** The index the generators name a column's index by: `index_products_on_sku`. */
export function indexName(table: string, column: string): string {
  return `index_${table}_on_${column}`;
}
