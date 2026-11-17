// `joins()` and `leftJoins()` (#24): the associations a query joins, worked out when it's written.
import type { Model, ModelClass } from "./model.ts";
import type { Join, JoinKind } from "./query.ts";
import { resolveAssociation } from "./resolved-association.ts";

/**
 * The joins `specs` name on `model`'s associations, each of `kind`: names, or `{ name: nested }`
 * where `nested` is a spec or a list of them for that association's Model.
 */
export function joinsFor(
  model: ModelClass<Model>,
  specs: readonly unknown[],
  kind: JoinKind,
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
      joins = mergeJoins(joins, [joinOf(model, name, kind, nested)]);
    }
  }
  return joins;
}

/** The join of `model`'s association `name`, with the joins `nested` names on its Model. */
function joinOf(
  model: ModelClass<Model>,
  name: string,
  kind: JoinKind,
  nested: readonly unknown[],
): Join {
  const association = resolveAssociation(model, name);
  return {
    association: name,
    kind,
    model: association.target,
    ownerAttribute: association.ownerAttribute,
    targetAttribute: association.targetAttribute,
    on: [],
    joins: joinsFor(association.target, nested, kind),
  };
}

/** `b`'s joins added to `a`'s: an association joined on both is joined once, with both's joins. */
export function mergeJoins(a: readonly Join[], b: readonly Join[]): readonly Join[] {
  const merged = [...a];
  for (const join of b) {
    const index = merged.findIndex((each) => each.association === join.association);
    const same = merged[index];
    if (same === undefined) {
      merged.push(join);
    } else {
      merged[index] = { ...same, joins: mergeJoins(same.joins, join.joins) };
    }
  }
  return merged;
}
