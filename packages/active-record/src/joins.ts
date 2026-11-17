// `joins()` and `leftJoins()` (#24): the associations a query joins, worked out when it's written.
import { IncompatibleRelation } from "./errors.ts";
import type { Executor } from "./executor.ts";
import type { Model, ModelClass } from "./model.ts";
import {
  JoinedOrder,
  mergeJoins,
  OnJoined,
  type Condition,
  type Join,
  type JoinKind,
  type OrderTerm,
  type QueryDescription,
} from "./query.ts";
import { queryOf } from "./relation.ts";
import {
  isOnDifferentDatabases,
  resolveAssociation,
  type ResolvedAssociation,
} from "./resolved-association.ts";
import { sql } from "./sql.ts";

/** How a join is written: of which kind, and for a query of which Model, on which database. */
interface Joining {
  readonly kind: JoinKind;
  readonly root: ModelClass<Model>;
  readonly executor: Executor;
}

/**
 * The joins `specs` name on `model`'s associations, each of `kind`: names, or `{ name: nested }`
 * where `nested` is a spec or a list of them for that association's Model.
 */
export function joinsFor(
  model: ModelClass<Model>,
  specs: readonly unknown[],
  joining: Joining,
): readonly Join[] {
  let joins: readonly Join[] = [];
  for (const spec of specs) {
    const entries: [string, readonly unknown[]][] =
      typeof spec === "string"
        ? [[spec, []]]
        : Object.entries(spec as Record<string, unknown>).map(([name, nested]) => [
            name,
            Array.isArray(nested) ? nested : [nested],
          ]);
    for (const [name, nested] of entries) {
      joins = mergeJoins(joins, [joinOf(model, name, joining, nested)]);
    }
  }
  return joins;
}

/** The join of `model`'s association `name`, with the joins `nested` names on its Model. */
function joinOf(
  model: ModelClass<Model>,
  name: string,
  joining: Joining,
  nested: readonly unknown[],
): Join {
  const association = resolveAssociation(model, name);
  refuseOtherDatabase(association, joining.root);
  return {
    association: name,
    kind: joining.kind,
    model: association.target,
    ownerAttribute: association.ownerAttribute,
    targetAttribute: association.targetAttribute,
    on: scopeConditions(association, joining.executor),
    joins: joinsFor(association.target, nested, joining),
  };
}

/**
 * Throws `IncompatibleRelation` if `association`'s Model is on another database than `root`'s
 * (#228): both their schemas say which database they're on, so it's said before the query runs.
 */
function refuseOtherDatabase(association: ResolvedAssociation, root: ModelClass<Model>): void {
  if (isOnDifferentDatabases(root, association.target)) {
    throw new IncompatibleRelation(
      `${root.name} can't join ${association.label}: ${association.target.name} is on another database, and a join reads one`,
    );
  }
}

/**
 * The conditions `association`'s scope and its Model's default scopes add to a join, as Rails
 * puts them in its `ON`. Their order can't change which rows join, so it's left out, as are
 * their includes; a limit, offset, distinct or joins of their own can't be written there.
 */
function scopeConditions(association: ResolvedAssociation, executor: Executor): Condition[] {
  const query = association.all(executor)[queryOf];
  const { limit, offset, distinct, joins } = query;
  if (limit !== undefined || offset !== undefined || distinct || (joins?.length ?? 0) > 0) {
    throw new IncompatibleRelation(
      `${association.label} can't be joined: its scope uses limit, offset, distinct or joins, which a join can't apply`,
    );
  }
  return query.none ? [...query.conditions, sql`1 = 0`] : [...query.conditions];
}

/**
 * `b`, a Relation of a Model `a` joins, merged into `a` (#24): its conditions on that join's
 * table, its order in place of `a`'s (as a same-Model merge replaces it), and its `none()`.
 * Throws `IncompatibleRelation` unless `a` joins its Model exactly once, or if `b` has what a
 * joined Model's Relation can't change about `a`.
 */
export function mergedOnJoin(a: QueryDescription, b: QueryDescription): QueryDescription {
  refuseUnmergeable(b, a.model);
  const path = joinedPath(a, b.model);
  const conditions = b.conditions.length === 0 ? [] : [new OnJoined(path, b.conditions)];
  const ordered = b.order.length > 0 || b.reordered === true;
  return {
    ...a,
    conditions: [...a.conditions, ...conditions],
    ...(ordered && { order: b.order.map((term) => onJoin(path, term)) }),
    ...(b.reordered === true && { reordered: true }),
    ...(b.none === true && { none: true }),
  };
}

/** `term`, of the Model joined at `path`, as the joining query's. */
function onJoin(path: string, term: OrderTerm): OrderTerm {
  return term instanceof JoinedOrder ? term : new JoinedOrder(path, term);
}

/** The clauses of a joined Model's Relation that would change the whole query, not its join. */
const UNMERGEABLE = ["limit", "offset", "select", "distinct", "includes", "joins"] as const;

/** Throws `IncompatibleRelation` if `query`, merged into a query of `into`, sets one of them. */
function refuseUnmergeable(query: QueryDescription, into: ModelClass<Model>): void {
  const set = UNMERGEABLE.filter((clause) => {
    const value = query[clause];
    if (Array.isArray(value)) return value.length > 0;
    if (clause === "includes") return Object.keys(value ?? {}).length > 0;
    return value !== undefined && value !== false;
  });
  if (set.length > 0) {
    throw new IncompatibleRelation(
      `merge() of a ${query.model.name} Relation into a ${into.name} Relation takes only its conditions and order, but it has ${set.join(", ")}`,
    );
  }
}

/**
 * Throws `IncompatibleRelation` for a distinct query ordered by a joined Model's attribute:
 * Postgres can't sort distinct rows by a column it doesn't select, so no database does.
 */
export function refuseDistinctJoinedOrder(query: QueryDescription): void {
  if (query.distinct && query.order.some((term) => term instanceof JoinedOrder)) {
    throw new IncompatibleRelation(
      `distinct() can't be combined with an order on a joined Model: ${query.model.name}'s distinct rows don't hold its columns to sort by`,
    );
  }
}

/** The path of the one join of `query` to `model`'s table. */
function joinedPath(query: QueryDescription, model: ModelClass<Model>): string {
  const paths: string[] = [];
  const visit = (joins: readonly Join[], prefix: string) => {
    for (const join of joins) {
      if (join.model === model) paths.push(prefix + join.association);
      visit(join.joins, `${prefix}${join.association}.`);
    }
  };
  visit(query.joins ?? [], "");
  const [path] = paths;
  if (path === undefined || paths.length > 1) {
    const how = path === undefined ? "doesn't join it" : `joins it ${paths.length} times`;
    throw new IncompatibleRelation(
      `merge() of a ${model.name} Relation needs a ${query.model.name} Relation that joins ${model.name} once, but this one ${how}`,
    );
  }
  return path;
}
