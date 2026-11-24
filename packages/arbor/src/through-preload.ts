// Preloading an association through another (#59): a query for each hop, planned with the rest of the tree, and the records each owner reaches through its own.
import type { Executor } from "./executor.ts";
import type { Model } from "./model.ts";
import type { IncludeTree, QueryDescription } from "./query.ts";
import type { Scoped } from "./relation.ts";
import type { ResolvedAssociation } from "./resolved-association.ts";

/** The records a plan found at each position: its starts', then each step's targets. */
export type Found = readonly (readonly Model[])[];

/**
 * Whose records a preload starts from: a query's, not yet sent, whose keys each association's
 * query selects with a subquery; or records already loaded, whose keys it binds.
 */
export type Owners = { query: QueryDescription } | { records: readonly Model[] };

/** One association's records, preloaded for its owners. */
export interface Hop {
  /** The query its records are selected by, for the levels under it to select its keys. */
  query: QueryDescription;
  /** Where its records are found, among the plan's. */
  position: number;
  /** What to preload for its records: the includes asked for under it, and its scope's. */
  includes: IncludeTree;
  /** The records `owner`, one of its owners, reaches: in its records' order, each once. */
  reached: (owner: Model, found: Found) => Model[];
}

/** A hop to plan: an association's records, for `owners`, at `ownersAt`. */
export interface HopRequest {
  association: ResolvedAssociation;
  owners: Owners;
  ownersAt: number;
  /** The records to select: the association's, or the outermost through association's. */
  base: Scoped<Model>;
  /** Attributes its records must load besides their key, for the hop after them. */
  columns: readonly string[];
  /** What to preload under its records. */
  nested: IncludeTree;
}

/** What planning a hop needs from the plan: where queries go, and a step for one association. */
export interface HopPlanner {
  executor: Executor;
  /** Adds a step for an association that isn't through another; none when nothing can match. */
  step(request: HopRequest): Hop | undefined;
}

/**
 * Plans `request`'s association: one step, or for a through association, its hops in turn, its
 * through association's records for the owners, then its source's for those. Each record an
 * owner reaches is one its join records reach. None when a hop can't match anything.
 */
export function planHop(planner: HopPlanner, request: HopRequest): Hop | undefined {
  const { hops } = request.association;
  if (hops === undefined) return planner.step(request);
  const { via, source } = hops;
  const joins = planHop(planner, {
    ...request,
    association: via,
    base: via.all(planner.executor),
    columns: [source.ownerAttribute],
    nested: {},
  });
  if (joins === undefined) return undefined;
  const { query, position: ownersAt } = joins;
  const targets = planHop(planner, {
    ...request,
    association: source,
    owners: { query },
    ownersAt,
  });
  if (targets === undefined) return undefined;
  return {
    ...targets,
    reached: (owner, found) => {
      const reached = new Set(
        joins.reached(owner, found).flatMap((join) => targets.reached(join, found)),
      );
      return (found[targets.position] ?? []).filter((record) => reached.has(record));
    },
  };
}
