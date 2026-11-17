// `joins()` and `leftJoins()` (#24): the associations a query joins, worked out when it's written.
import type { Model, ModelClass } from "./model.ts";
import type { Join, JoinKind } from "./query.ts";
import { resolveAssociation } from "./resolved-association.ts";

/** The joins `specs` name on `model`'s associations, each of `kind`. */
export function joinsFor(
  model: ModelClass<Model>,
  specs: readonly unknown[],
  kind: JoinKind,
): Join[] {
  return specs.map((spec) => joinOf(model, spec as string, kind));
}

/** The join of `model`'s association `name`. */
function joinOf(model: ModelClass<Model>, name: string, kind: JoinKind): Join {
  const association = resolveAssociation(model, name);
  return {
    association: name,
    kind,
    model: association.target,
    ownerAttribute: association.ownerAttribute,
    targetAttribute: association.targetAttribute,
    on: [],
    joins: [],
  };
}

/** `b`'s joins added to `a`'s: an association joined on both is joined once. */
export function mergeJoins(a: readonly Join[], b: readonly Join[]): readonly Join[] {
  const merged = [...a];
  for (const join of b) {
    if (!merged.some((each) => each.association === join.association)) merged.push(join);
  }
  return merged;
}
