// Preloading a polymorphic belongsTo (#60): each listed Model's branch, for the owners whose type names it, with the includes under it that its Model has.
import { associationsOf } from "./association-fields.ts";
import type { Model } from "./model.ts";
import { LinkedTo, type IncludeTree } from "./query.ts";
import { state } from "./record-state.ts";
import type { ResolvedAssociation } from "./resolved-association.ts";
import type { Owners } from "./through-preload.ts";

/**
 * The owner's type a polymorphic belongsTo branch links (the attribute, and the name of its
 * Model); none for any other association.
 */
function ownersTypeOf(branch: ResolvedAssociation): ResolvedAssociation["type"] {
  return branch.definition.kind === "belongsTo" ? branch.type : undefined;
}

/** Whether `record`'s type is the one the branch links, or the association has no type. */
export function isOwnedThrough(branch: ResolvedAssociation, record: Model): boolean {
  const type = ownersTypeOf(branch);
  return type === undefined || record[state].read(type.attribute) === type.value;
}

/**
 * A branch's owners: those whose type names its Model. A query's are narrowed by its type, or
 * when it has a limit or offset, which a condition would change, as the records whose key is
 * among the query's.
 */
export function ownersOfBranch(branch: ResolvedAssociation, owners: Owners): Owners {
  const type = ownersTypeOf(branch);
  if (type === undefined) return owners;
  if ("records" in owners) {
    return { records: owners.records.filter((record) => isOwnedThrough(branch, record)) };
  }
  const { query } = owners;
  const ofType = { [type.attribute]: type.value };
  if (query.limit === undefined && query.offset === undefined) {
    return { query: { ...query, conditions: [...query.conditions, ofType] } };
  }
  const { primaryKey } = query.model;
  const among = new LinkedTo(primaryKey, query, primaryKey);
  return { query: { model: query.model, conditions: [ofType, among], order: [] } };
}

/** The part of `tree` a branch's Model has: a polymorphic belongsTo's skips the others' names. */
export function treeForBranch(branch: ResolvedAssociation, tree: IncludeTree): IncludeTree {
  if (ownersTypeOf(branch) === undefined) return tree;
  const names = associationsOf(branch.target);
  return Object.fromEntries(Object.entries(tree).filter(([name]) => names.has(name)));
}
