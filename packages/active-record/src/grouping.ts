// `group` (#345): a Relation grouped by attributes or `sql` fragments, whose calculations resolve to a Map from each group's key to its result.
import { attributeFor } from "./attribute.ts";
import { compileGrouped, valuesAlias, type Grouping } from "./compiler.ts";
import type { AttributesOf, Model, ModelClass } from "./model.ts";
import type { Relation } from "./relation.ts";
import type { ValueSource } from "./calculations.ts";
import { SafeSql } from "./sql.ts";

/** What `group` takes for records `M`: an attribute, or an `sql` fragment. */
export type GroupTerm<M> = (keyof AttributesOf<M> & string) | SafeSql;

/** A group's key for one term: an attribute's value (null included), or a fragment's cell. */
type TermKey<M, T> = T extends SafeSql ? unknown : AttributesOf<M>[T & keyof AttributesOf<M>];

/** A group's key: one term's value, or a tuple of several terms' values. */
export type GroupKey<M, G extends readonly unknown[]> = G extends readonly [infer Only]
  ? TermKey<M, Only>
  : { -readonly [I in keyof G]: TermKey<M, G[I]> };

/** How a grouped Relation reads values: its Relation's value source. */
type SourceOf<M extends Model> = (relation: Relation<M>) => ValueSource;

interface GroupedParts<M extends Model> {
  relation: Relation<M>;
  grouping: Grouping;
  sourceOf: SourceOf<M>;
}

/**
 * A Relation grouped by `group(...)`: its calculations resolve to a Map from each group's key to
 * the group's result, in the order the database returns the groups. It holds no records.
 */
export class GroupedRelation<M extends Model, G extends readonly GroupTerm<M>[]> {
  /** Type-only: the terms it's grouped by, which type its keys. */
  declare readonly groupTerms?: G;

  readonly #relation: Relation<M>;
  readonly #grouping: Grouping;
  readonly #sourceOf: SourceOf<M>;

  /** Grouped Relations come from `group()`, never `new GroupedRelation()`. */
  protected constructor(parts: unknown) {
    const { relation, grouping, sourceOf } = parts as GroupedParts<M>;
    this.#relation = relation;
    this.#grouping = grouping;
    this.#sourceOf = sourceOf;
  }

  /** The number of rows in each group. */
  async count(): Promise<Map<GroupKey<M, G>, number>> {
    return (await this.#calculate()) as Map<GroupKey<M, G>, number>;
  }

  /** Each group's result, keyed by its values. */
  async #calculate(): Promise<Map<unknown, unknown>> {
    const { query, dialect, runner } = this.#sourceOf(this.#relation);
    const keyOf = groupKeyReader(query.model, this.#grouping);
    const alias = valuesAlias(query.model);
    const rows = await runner.rows(() => compileGrouped(dialect(), query, this.#grouping));
    return new Map(rows.map((row) => [keyOf(row), Number(row[alias])]));
  }
}

/** Reads a row's group key: the one term's value, or a tuple of every term's. */
function groupKeyReader(
  model: ModelClass<Model>,
  { terms }: Grouping,
): (row: Record<string, unknown>) => unknown {
  const readers = terms.map((term) => {
    const attribute = attributeFor(model, term);
    return (row: Record<string, unknown>) => attribute.read(row[attribute.column]);
  });
  if (readers.length === 1) return readers[0]!;
  return (row) => readers.map((read) => read(row));
}

/** `relation` grouped by `terms`. */
export function grouped<M extends Model, G extends readonly GroupTerm<M>[]>(
  relation: Relation<M>,
  terms: G,
  sourceOf: SourceOf<M>,
): GroupedRelation<M, G> {
  const grouping: Grouping = { terms: terms as readonly string[] };
  return new (GroupedRelation as unknown as new (parts: GroupedParts<M>) => GroupedRelation<M, G>)({
    relation,
    grouping,
    sourceOf,
  });
}
