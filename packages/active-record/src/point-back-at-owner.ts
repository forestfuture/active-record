// A record built or created through its owner's hasMany or hasOne points back at the owner (#339).
import { associationsOf } from "./association-fields.ts";
import type { Model } from "./model.ts";
import { state } from "./record-state.ts";
import { resolveAssociation, type ResolvedAssociation } from "./resolved-association.ts";

/**
 * Makes `owner` the loaded record of the belongsTo on `record` that is `association`'s inverse:
 * the first of the target's belongsTo associations that links the same foreign key to the
 * owner's Model, through the same key. Neither may have a scope, which could leave the owner
 * out. So `await post.author()` on a post built through `user.posts()` is the user, with no
 * query, even before either is saved, and a required belongsTo passes, as Rails' automatic
 * `inverse_of` does. The rest of inverse associations (preloads, `inverseOf:`) is #62.
 */
export function pointBackAtOwner(
  owner: Model,
  association: ResolvedAssociation,
  record: Model,
): void {
  const inverse = inverseOf(owner, association);
  if (inverse === undefined) return;
  // A key given to `build` that isn't the owner's points elsewhere, so the owner isn't its
  // record. A null one is filled in with the owner's when the owner is saved.
  const key = record[state].read(inverse.ownerAttribute) as Key | null;
  const ownerKey = owner[state].read(association.ownerAttribute) as Key | null;
  if (key !== null && !isSameKey(key, ownerKey)) return;
  record[state].associations.set(inverse.name, inverse.ownerAttribute, owner);
}

/** A key's value: what an integer or string key attribute holds. */
type Key = string | number;

/** Whether a key is the owner's, an integer matching a text key's digits (#94). */
function isSameKey(key: Key, ownerKey: Key | null): boolean {
  return ownerKey !== null && String(key) === String(ownerKey);
}

function inverseOf(
  owner: Model,
  association: ResolvedAssociation,
): ResolvedAssociation | undefined {
  const { target, targetAttribute, ownerAttribute } = association;
  // A scope on either side may leave the owner out, so neither has an inverse.
  if (association.definition.scope !== undefined) return undefined;
  for (const [name, definition] of associationsOf(target)) {
    if (definition.kind !== "belongsTo" || definition.foreignKey !== targetAttribute) continue;
    if (definition.scope !== undefined) continue;
    if (!(owner instanceof definition.target())) continue;
    const candidate = resolveAssociation(target, name);
    if (candidate.targetAttribute === ownerAttribute) return candidate;
  }
  return undefined;
}
