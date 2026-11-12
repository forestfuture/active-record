// A record built through its owner's hasMany or hasOne points back at the owner, as Rails' automatic inverse_of does (#339).
import { associationsOf } from "./association-fields.ts";
import type { Model } from "./model.ts";
import { state } from "./record-state.ts";
import { resolveAssociation, type ResolvedAssociation } from "./resolved-association.ts";

/**
 * Makes `owner` the loaded record of the belongsTo on `record` that is `association`'s inverse:
 * the first of the target's belongsTo associations that links the same foreign key to the
 * owner's Model, through the same key. So `await post.author()` on a post built through
 * `user.posts()` is the user, with no query, even before either is saved, and a required
 * belongsTo passes. The rest of Rails' inverse associations (preloads, `inverseOf:`) is #62.
 */
export function pointBackAtOwner(
  owner: Model,
  association: ResolvedAssociation,
  record: Model,
): void {
  const inverse = inverseOf(owner, association);
  if (inverse === undefined) return;
  record[state].associations.set(inverse.name, inverse.ownerAttribute, owner);
}

function inverseOf(
  owner: Model,
  association: ResolvedAssociation,
): ResolvedAssociation | undefined {
  const { target, targetAttribute, ownerAttribute } = association;
  for (const [name, definition] of associationsOf(target)) {
    if (definition.kind !== "belongsTo" || definition.foreignKey !== targetAttribute) continue;
    if (!(owner instanceof definition.target())) continue;
    const candidate = resolveAssociation(target, name);
    if (candidate.targetAttribute === ownerAttribute) return candidate;
  }
  return undefined;
}
