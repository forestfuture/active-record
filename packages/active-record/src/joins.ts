// `joins()` and `leftJoins()` (#24): the associations a query joins, worked out when it's written.
import { IncompatibleRelation } from "./errors.ts";
import type { Executor } from "./executor.ts";
import type { Model, ModelClass } from "./model.ts";
import type { Condition, Join, JoinKind } from "./query.ts";
import { queryOf } from "./relation.ts";
import { resolveAssociation, type ResolvedAssociation } from "./resolved-association.ts";
import { sql } from "./sql.ts";

/** How a join is written: of which kind, and for a query on which database. */
interface Joining {
  readonly kind: JoinKind;
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
