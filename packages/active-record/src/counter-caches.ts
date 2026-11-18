// Counter caches (#61): a belongsTo's `counterCache`, kept up to date by statements written in the same atomic batch as its record's insert, update or delete.
import { associationsOf } from "./association-fields.ts";
import type { AssociationDefinition } from "./associations.ts";
import { attributeFor } from "./attribute.ts";
import type { CompiledSql } from "./compiler.ts";
import { valueMark } from "./dialect.ts";
import { pluralize } from "./inflections.ts";
import { modelOf, type Model, type ModelClass } from "./model.ts";
import { quoteIdentifier } from "./query-tables.ts";
import { state } from "./record-state.ts";
import { resolveAssociation } from "./resolved-association.ts";
import { tableOwnerModelName } from "./table-names.ts";

/**
 * The counter a belongsTo's `counterCache` keeps on its target: the attribute it names, or by
 * Rails' convention the owner's plural name + `Count` (`Reply` → `repliesCount`).
 */
function counterAttribute(owner: ModelClass, { counterCache }: AssociationDefinition): string {
  if (typeof counterCache === "string") return counterCache;
  const plural = pluralize(tableOwnerModelName(owner));
  return `${plural.charAt(0).toLowerCase()}${plural.slice(1)}Count`;
}

/** One belongsTo's counter cache: the target's attribute it keeps, and how records link to it. */
interface Counter {
  /** The owner's foreign key. */
  foreignKey: string;
  target: ModelClass;
  /** The target's attribute holding the count. */
  attribute: string;
  /** The target's attribute the foreign key points at. */
  targetKey: string;
}

/** The counter caches a Model's records keep, one per belongsTo declaring one. */
function countersOf(owner: ModelClass): Counter[] {
  return [...associationsOf(owner)].flatMap(([name, definition]) => {
    if (definition.kind !== "belongsTo" || definition.counterCache === undefined) return [];
    const { target, targetAttribute } = resolveAssociation(owner, name);
    const attribute = counterAttribute(owner, definition);
    return [{ foreignKey: definition.foreignKey, target, attribute, targetKey: targetAttribute }];
  });
}

/** The statements that count a new record in: one per counter cache whose key is set. */
export function counterIncrements(record: Model): CompiledSql[] {
  return countersOf(modelOf(record)).flatMap((counter) => {
    const key = record[state].read(counter.foreignKey);
    return key === null || key === undefined ? [] : [compileCounterChange(counter, key, 1)];
  });
}

/** `UPDATE … SET counter = COALESCE(counter, 0) + ? WHERE key = ?`, as Rails' `update_counters`. */
function compileCounterChange(
  { target, attribute, targetKey }: Counter,
  key: unknown,
  by: number,
): CompiledSql {
  const params: unknown[] = [by];
  const column = quoteIdentifier(attributeFor(target, attribute).column);
  const keyColumn = quoteIdentifier(attributeFor(target, targetKey).column);
  attributeFor(target, targetKey).bind(params, key);
  return {
    sql: `UPDATE ${quoteIdentifier(target.table)} SET ${column} = COALESCE(${column}, 0) + ${valueMark} WHERE ${keyColumn} = ${valueMark}`,
    params,
    model: target,
  };
}
