// `joins()` and `leftJoins()` (#24): the associations a query joins, worked out when it's written.
import { IncompatibleRelation } from "./errors.ts";
import type { Executor } from "./executor.ts";
import type { Model, ModelClass } from "./model.ts";
import { tablesOf } from "./query-tables.ts";
import {
  hasPageOrDistinct,
  isJoining,
  JoinedOrder,
  merged,
  mergeJoins,
  JoinedConditions,
  type Condition,
  type Join,
  type JoinKind,
  type OrderTerm,
  type QueryDescription,
} from "./query.ts";
import { queryOf } from "./query.ts";
import {
  isOnDifferentDatabases,
  resolveAssociation,
  type ResolvedAssociation,
} from "./resolved-association.ts";
import { sql } from "./sql.ts";

/** How a join is written: of which kind, and for a query of which Model, on which database. */
interface JoinContext {
  readonly kind: JoinKind;
  readonly root: ModelClass<Model>;
  readonly executor: Executor;
}

/** `query` with the joins `specs` name added, each of `kind`: `joins()` and `leftJoins()`. */
export function withJoins(
  query: QueryDescription,
  specs: readonly unknown[],
  kind: JoinKind,
  executor: Executor,
): QueryDescription {
  const added = joinsFor(query.model, specs, { kind, root: query.model, executor });
  return { ...query, joins: mergeJoins(query.joins ?? [], added) };
}

/**
 * The joins `specs` name on `model`'s associations, each of `kind`: names, or `{ name: nested }`
 * where `nested` is a spec or a list of them for that association's Model.
 */
function joinsFor(
  model: ModelClass<Model>,
  specs: readonly unknown[],
  joining: JoinContext,
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
  joining: JoinContext,
  nested: readonly unknown[],
): Join {
  const association = resolveAssociation(model, name);
  refusePolymorphic(association);
  refuseThrough(association);
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
 * Throws `IncompatibleRelation` for a polymorphic belongsTo (#60): its records may be in several
 * tables, and a join reads one.
 */
function refusePolymorphic(association: ResolvedAssociation): void {
  if (association.isBranched) {
    const models = association.branches.map((branch) => branch.target.name).join(", ");
    throw new IncompatibleRelation(
      `${association.label} can't be joined: it's polymorphic, so its records may be in any of ${models}`,
    );
  }
}

/**
 * Throws `IncompatibleRelation` for an association through another (#59): joining it needs a
 * join for each of its hops, which isn't built yet, and one join would skip the records between.
 */
function refuseThrough(association: ResolvedAssociation): void {
  if (association.hops !== undefined) {
    throw new IncompatibleRelation(
      `${association.label} can't be joined: it's through ${association.definition.through ?? "another association"}, and joins through another aren't built yet; join ${association.definition.through ?? "its first association"} and its source instead`,
    );
  }
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
 * The conditions `association`'s scope and its Model's default scopes add to a join, in
 * its `ON`. Their order can't change which rows join, so it's left out, as are
 * their includes; a limit, offset, distinct or joins of their own can't be written there.
 */
function scopeConditions(association: ResolvedAssociation, executor: Executor): Condition[] {
  const query = association.all(executor)[queryOf];
  if (hasPageOrDistinct(query) || isJoining(query)) {
    throw new IncompatibleRelation(
      `${association.label} can't be joined: its scope uses limit, offset, distinct or joins, which a join can't apply`,
    );
  }
  return query.none ? [...query.conditions, sql`1 = 0`] : [...query.conditions];
}

/**
 * `b` merged into `a` (`merge()`): as a same-Model merge, or for a Relation of a Model `a` joins,
 * onto its join.
 */
export function mergedQuery(a: QueryDescription, b: QueryDescription): QueryDescription {
  return b.model === a.model ? merged(a, b) : mergedOnJoin(a, b);
}

/**
 * `b`, a Relation of a Model `a` joins, merged into `a` (#24): its conditions on that join's
 * table, its order in place of `a`'s (as a same-Model merge replaces it), and its `none()`.
 * Throws `IncompatibleRelation` unless `a` joins its Model exactly once, or if `b` has what a
 * joined Model's Relation can't change about `a`.
 */
function mergedOnJoin(a: QueryDescription, b: QueryDescription): QueryDescription {
  refuseUnmergeable(b, a.model);
  const path = joinedPath(a, b.model);
  const conditions = b.conditions.length === 0 ? [] : [new JoinedConditions(path, b.conditions)];
  const ordered = b.order.length > 0 || b.reordered === true;
  return {
    ...a,
    conditions: [...a.conditions, ...conditions],
    ...(ordered && { order: b.order.map((term) => joinedOrderTerm(path, term)) }),
    ...(b.reordered === true && { reordered: true }),
    ...(b.none === true && { none: true }),
  };
}

/** `term`, of the Model joined at `path`, as the joining query's. */
function joinedOrderTerm(path: string, term: OrderTerm): OrderTerm {
  return term instanceof JoinedOrder ? term : new JoinedOrder(path, term);
}

/** The clauses of a joined Model's Relation that would change the whole query, not its join. */
const UNMERGEABLE = ["limit", "offset", "select", "distinct", "includes", "joins"] as const;

/** Throws `IncompatibleRelation` if `query`, merged into a query of `into`, sets one of them. */
function refuseUnmergeable(query: QueryDescription, into: ModelClass<Model>): void {
  const clauses = UNMERGEABLE.filter((clause) => {
    const value = query[clause];
    if (Array.isArray(value)) return value.length > 0;
    if (clause === "includes") return Object.keys(value ?? {}).length > 0;
    return value !== undefined && value !== false;
  });
  if (clauses.length > 0) {
    throw new IncompatibleRelation(
      `merge() of a ${query.model.name} Relation into a ${into.name} Relation takes only its conditions and order, but it has ${clauses.join(", ")}`,
    );
  }
}

/** The path of the one join of `query` to `model`'s table. */
function joinedPath(query: QueryDescription, model: ModelClass<Model>): string {
  const paths = tablesOf(query)
    .joined.filter(({ join }) => join.model === model)
    .map(({ path }) => path);
  const [path] = paths;
  if (path === undefined || paths.length > 1) {
    const how = path === undefined ? "doesn't join it" : `joins it ${paths.length} times`;
    throw new IncompatibleRelation(
      `merge() of a ${model.name} Relation needs a ${query.model.name} Relation that joins ${model.name} once, but this one ${how}`,
    );
  }
  return path;
}
