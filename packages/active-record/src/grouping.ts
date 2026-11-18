// `group` (#345): a Relation grouped by attributes or `sql` fragments, whose calculations resolve to a Map from each group's key to its result.
import { attributeFor } from "./attribute.ts";
import { IncompatibleRelation } from "./errors.ts";
import { attributeOf } from "./metadata.ts";
import {
  compileGrouped,
  keyAlias,
  valuesAlias,
  type GroupedCalculation,
  type Grouping,
} from "./compiler.ts";
import type { AttributesOf, Model, ModelClass, SpecsOf } from "./model.ts";
import type { Relation } from "./relation.ts";
import {
  calculationReader,
  requireOperation,
  type CalculatedValue,
  type NumberAttribute,
  type Operation,
  type OrderedAttribute,
  type StoredTypeOf,
  type ValueSource,
} from "./calculations.ts";
import {
  JoinedOrder,
  type AttributeOrder,
  type OrderTerm,
  type QueryDescription,
} from "./query.ts";
import { checkFragment, type Conditions, type OrderSpec } from "./relation-checks.ts";
import { SafeSql } from "./sql.ts";

/** What `group` takes for records `M`: one term or more. */
export type GroupTerms<M> = readonly [GroupTerm<M>, ...GroupTerm<M>[]];

/** What `group` takes for records `M`: an attribute but a json one, or an `sql` fragment. */
export type GroupTerm<M> = GroupableAttribute<M> | SafeSql;

/** The attributes of `M` that can be grouped: not json, which Postgres can't compare. */
type GroupableAttribute<M> = {
  [K in keyof SpecsOf<M>]: StoredTypeOf<SpecsOf<M>[K]> extends "json" ? never : K;
}[keyof SpecsOf<M>] &
  keyof AttributesOf<M> &
  string;

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
    const { query } = sourceOf(relation);
    checkTerms(query.model, grouping);
    requireGroupedOrder(query, grouping);
    this.#relation = relation;
    this.#grouping = grouping;
    this.#sourceOf = sourceOf;
  }

  /** Only the rows matching `conditions`, as `where` on a Relation. */
  where(conditions: Conditions<M> | SafeSql): GroupedRelation<M, G> {
    return this.#with(this.#relation.where(conditions));
  }

  /** Leaves out the rows matching `conditions`, as `whereNot` on a Relation. */
  whereNot(conditions: Conditions<M> | SafeSql): GroupedRelation<M, G> {
    return this.#with(this.#relation.whereNot(conditions));
  }

  /** Sorts the groups by grouped attributes, or a fragment such as ``sql`COUNT(*) DESC` ``. */
  order(spec: OrderSpec<M> | SafeSql): GroupedRelation<M, G> {
    return this.#with(this.#relation.order(spec));
  }

  /** Replaces the order, as `reorder` on a Relation. */
  reorder(spec?: OrderSpec<M> | SafeSql): GroupedRelation<M, G> {
    return this.#with(this.#relation.reorder(spec));
  }

  /** At most `count` groups. */
  limit(count: number): GroupedRelation<M, G> {
    return this.#with(this.#relation.limit(count));
  }

  /** Skips the first `count` groups. */
  offset(count: number): GroupedRelation<M, G> {
    return this.#with(this.#relation.offset(count));
  }

  /** Calculates each group's distinct values: a count, sum or average takes each once. */
  distinct(): GroupedRelation<M, G> {
    return this.#with(this.#relation.distinct());
  }

  /** Matches nothing: each calculation is an empty Map, without a query. */
  none(): GroupedRelation<M, G> {
    return this.#with(this.#relation.none());
  }

  /** Groups by more terms too, which join the key. */
  group<const H extends GroupTerms<M>>(...terms: H): GroupedRelation<M, [...G, ...H]> {
    const regrouped = { ...this.#grouping, terms: [...this.#grouping.terms, ...terms] };
    return this.#with(this.#relation, regrouped);
  }

  /** This grouped Relation, with `relation`'s rows, grouped by `grouping`. */
  #with<K extends readonly GroupTerm<M>[] = G>(
    relation: Relation<M>,
    grouping: Grouping = this.#grouping,
  ): GroupedRelation<M, K> {
    return new GroupedRelation<M, K>({ relation, grouping, sourceOf: this.#sourceOf });
  }

  /**
   * Keeps the groups an `sql` fragment matches, written with their aggregates:
   * ``having(sql`COUNT(*) > ${1}`)``. Several are ANDed.
   */
  having(condition: SafeSql): GroupedRelation<M, G> {
    if (!(condition instanceof SafeSql)) {
      throw new TypeError("having() takes an sql`…` fragment; plain strings are not accepted");
    }
    checkFragment(this.#sourceOf(this.#relation).query.model, condition);
    const having = [...this.#grouping.having, condition];
    return this.#with(this.#relation, { ...this.#grouping, having });
  }

  /** The number of rows in each group, or of their non-null values of `attribute`. */
  async count(attribute?: keyof AttributesOf<M> & string): Promise<Map<GroupKey<M, G>, number>> {
    return this.#calculate({ operation: "count", operand: attribute }) as never;
  }

  /** Each group's sum of `attribute`'s values or a fragment's, as `sum` on a Relation. */
  async sum<K extends NumberAttribute<M> | SafeSql>(
    attribute: K,
  ): Promise<Map<GroupKey<M, G>, CalculatedValue<M, K>>> {
    return this.#calculate({ operation: "sum", operand: attribute }) as never;
  }

  /** Each group's mean of `attribute`'s values or a fragment's, or `null` with none. */
  async average(
    attribute: NumberAttribute<M> | SafeSql,
  ): Promise<Map<GroupKey<M, G>, number | null>> {
    return this.#calculate({ operation: "average", operand: attribute }) as never;
  }

  /** Each group's least value of `attribute` or a fragment, or `null` with none. */
  async minimum<K extends OrderedAttribute<M> | SafeSql>(
    attribute: K,
  ): Promise<Map<GroupKey<M, G>, CalculatedValue<M, K, unknown> | null>> {
    return this.#calculate({ operation: "minimum", operand: attribute }) as never;
  }

  /** Each group's greatest value of `attribute` or a fragment, or `null` with none. */
  async maximum<K extends OrderedAttribute<M> | SafeSql>(
    attribute: K,
  ): Promise<Map<GroupKey<M, G>, CalculatedValue<M, K, unknown> | null>> {
    return this.#calculate({ operation: "maximum", operand: attribute }) as never;
  }

  /** The calculation `operation` names, of each group, typed as that method is. */
  async calculate(
    operation: "count",
    attribute?: keyof AttributesOf<M> & string,
  ): Promise<Map<GroupKey<M, G>, number>>;
  async calculate<K extends NumberAttribute<M> | SafeSql>(
    operation: "sum",
    attribute: K,
  ): Promise<Map<GroupKey<M, G>, CalculatedValue<M, K>>>;
  async calculate(
    operation: "average",
    attribute: NumberAttribute<M> | SafeSql,
  ): Promise<Map<GroupKey<M, G>, number | null>>;
  async calculate<K extends OrderedAttribute<M> | SafeSql>(
    operation: "minimum" | "maximum",
    attribute: K,
  ): Promise<Map<GroupKey<M, G>, CalculatedValue<M, K, unknown> | null>>;
  async calculate(operation: Operation, attribute?: string | SafeSql): Promise<unknown> {
    return this.#calculate({ operation: requireOperation(operation), operand: attribute });
  }

  /**
   * Each group's result, keyed by its values; an attribute the calculation can't take throws
   * first.
   */
  async #calculate(requested: GroupedCalculation): Promise<Map<unknown, unknown>> {
    const { query, dialect, runner } = this.#sourceOf(this.#relation);
    const calculation = withSelected(query, requested);
    const keyOf = groupKeyReader(query.model, this.#grouping);
    const read = resultReader(query, calculation);
    const alias = valuesAlias(query.model);
    const rows = await runner.rows(() =>
      compileGrouped(dialect(), query, this.#grouping, calculation),
    );
    return new Map(rows.map((row) => [keyOf(row), read(row[alias] ?? null)]));
  }
}

/**
 * A count of rows as Rails counts it after `select()`: of the one selected attribute's values.
 * Several selected attributes have no one count.
 */
function withSelected(
  query: QueryDescription,
  calculation: GroupedCalculation,
): GroupedCalculation {
  const { select } = query;
  if (calculation.operation !== "count" || calculation.operand !== undefined || !select) {
    return calculation;
  }
  if (select.length === 1) return { ...calculation, operand: select[0] };
  throw new IncompatibleRelation(
    `count() of a grouped Relation counts one selected attribute, but select() names ${select.length}`,
  );
}

/** How a grouped calculation's results read: a count as a number, the rest as on a Relation. */
function resultReader(
  query: QueryDescription,
  { operation, operand }: GroupedCalculation,
): (cell: unknown) => unknown {
  if (operation !== "count") return calculationReader(query, operation, operand!);
  if (operand !== undefined) attributeFor(query.model, operand as string);
  return Number;
}

/**
 * Refuses an order by an attribute that isn't grouped, written after `group()`: Postgres refuses
 * it, and SQLite would sort by any one row's value.
 */
function requireGroupedOrder(query: QueryDescription, grouping: Grouping): void {
  const ungrouped = query.order.find((term) => isUngroupedOrder(term, grouping));
  if (ungrouped === undefined) return;
  throw new TypeError(`can't order groups by ${orderedBy(ungrouped)}, which isn't grouped`);
}

/** An order term that can't order groups. */
type UngroupedOrder = AttributeOrder | JoinedOrder;

/**
 * Whether `term` can't order the groups: an attribute's that isn't grouped, or a joined Model's
 * (#24), which no group is. A grouped attribute's can, and so can a fragment, which isn't checked.
 */
function isUngroupedOrder(term: OrderTerm, { terms }: Grouping): term is UngroupedOrder {
  if (term instanceof JoinedOrder) return true;
  return !(term instanceof SafeSql) && !terms.includes(term.attribute);
}

/** How a message names what `term` orders by: `"email"`, or a joined Model's `user.email`. */
function orderedBy(term: UngroupedOrder): string {
  if (!(term instanceof JoinedOrder)) return `"${term.attribute}"`;
  const inner = term.term instanceof SafeSql ? "an sql fragment" : `"${term.term.attribute}"`;
  return `${inner} of the joined ${term.path}`;
}

/**
 * Reads a row's group key: the one term's value, or a tuple of every term's. An attribute's reads
 * as its value, and a fragment's as the database returned it.
 */
function groupKeyReader(
  model: ModelClass<Model>,
  { terms }: Grouping,
): (row: Record<string, unknown>) => unknown {
  const readers = terms.map((term, index) => {
    const alias = keyAlias(model, index);
    if (term instanceof SafeSql) return (row: Record<string, unknown>) => row[alias];
    const attribute = attributeFor(model, term);
    return (row: Record<string, unknown>) => attribute.read(row[alias]);
  });
  if (readers.length === 1) return readers[0]!;
  return (row) => readers.map((read) => read(row));
}

/** Checks a group's terms when written: each attribute exists, as do a fragment's references. */
function checkTerms(model: ModelClass<Model>, { terms }: Grouping): void {
  if (terms.length === 0) {
    throw new TypeError("group() needs at least one attribute or sql fragment");
  }
  for (const term of terms) {
    if (term instanceof SafeSql) checkFragment(model, term);
    else if (attributeOf(model, term).type === "json") {
      throw new TypeError(`group() can't group by "${term}", a json attribute`);
    }
  }
}

/** `relation` grouped by `terms`. */
export function grouped<M extends Model, G extends readonly GroupTerm<M>[]>(
  relation: Relation<M>,
  terms: G,
  sourceOf: SourceOf<M>,
): GroupedRelation<M, G> {
  const grouping: Grouping = { terms, having: [] };
  const { query } = sourceOf(relation);
  checkTerms(query.model, grouping); // a refused term first, before an order it can't drop
  return new (GroupedRelation as unknown as new (parts: GroupedParts<M>) => GroupedRelation<M, G>)({
    relation: withGroupedOrder(relation, query, grouping),
    grouping,
    sourceOf,
  });
}

/**
 * `relation` without the order terms of attributes `grouping` doesn't group by: they sorted rows,
 * which a grouped Relation doesn't return, and a default scope's order would otherwise stop
 * every grouping. Grouped attributes' terms and fragments are kept.
 */
function withGroupedOrder<M extends Model>(
  relation: Relation<M>,
  query: QueryDescription,
  grouping: Grouping,
): Relation<M> {
  const dropped = query.order.find((term) => isUngroupedOrder(term, grouping));
  if (dropped === undefined) return relation;
  refuseDropWhilePicking(query, dropped);
  const kept = query.order.filter(
    (term): term is AttributeOrder | SafeSql => !isUngroupedOrder(term, grouping),
  );
  return kept.reduce<Relation<M>>((reordered, term) => {
    if (term instanceof SafeSql) return reordered.order(term);
    // A list's order (#350) is kept as written, its filter already among the conditions.
    if (term.inOrderOf !== undefined) {
      const { attribute, inOrderOf } = term;
      return reordered.inOrderOf(attribute as never, inOrderOf as never, { filter: false });
    }
    return reordered.order(orderSpec(term));
  }, relation.reorder());
}

/**
 * Refuses to drop `dropped` while a limit or offset picks groups: without its order, they'd pick
 * groups in no fixed order.
 */
function refuseDropWhilePicking(query: QueryDescription, dropped: UngroupedOrder): void {
  if (query.limit === undefined && query.offset === undefined) return;
  throw new IncompatibleRelation(
    `group() can't drop the order by ${orderedBy(dropped)}, which isn't grouped, while a limit or offset picks groups: reorder() first`,
  );
}

/** An attribute's order term as `order()` takes it. */
function orderSpec({ attribute, direction, nulls }: AttributeOrder): OrderSpec<Model> {
  return { [attribute]: nulls === undefined ? direction : { direction, nulls } };
}
