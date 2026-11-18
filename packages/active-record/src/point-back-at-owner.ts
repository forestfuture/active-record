// A record built, created or loaded through its owner's hasMany or hasOne points back at the owner (#339, #62).
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
  if (inverse === undefined || association.otherTypeOf(record) !== undefined) return;
  if (!isOwnersKey(record[state].read(inverse.ownerAttribute), owner, association)) return;
  record[state].associations.set(inverse.name, inverse.keyAttributes, owner);
}

/**
 * Points what `owner` loaded through `association` back at it (#62): a hasMany's or hasOne's
 * records at the owner, through their inverse belongsTo, and a belongsTo's record at the owner,
 * through its inverse hasOne. A hasMany isn't filled from a belongsTo: one record isn't the whole
 * collection, as in Rails.
 */
export function pointLoadedBack(owner: Model, association: ResolvedAssociation, value: unknown) {
  if (value === null) return;
  if (association.definition.kind !== "belongsTo") {
    for (const record of [value].flat() as Model[]) pointBackAtOwner(owner, association, record);
    return;
  }
  const record = value as Model;
  const inverse = inverseHasOne(record, association.branchForRecord(record) ?? association);
  if (inverse !== undefined)
    record[state].associations.set(inverse.name, inverse.keyAttributes, owner);
}

/**
 * The hasOne of a belongsTo's target, `record`, whose inverse is the belongsTo: the one that
 * would point a record it loads back at `record` through `belongsTo`.
 */
function inverseHasOne(record: Model, belongsTo: ResolvedAssociation) {
  for (const [name, definition] of associationsOf(belongsTo.target)) {
    if (definition.kind !== "hasOne") continue;
    const hasOne = resolveAssociation(belongsTo.target, name);
    if (inverseOf(record, hasOne)?.name === belongsTo.name) return hasOne;
  }
  return undefined;
}

/**
 * Whether the record's foreign key is its owner's: the same key (an integer matching a text
 * key's digits, #94), or null while the owner has none yet, which saving the owner fills in. A
 * key that isn't the owner's, null included, points elsewhere. Only a pushed record can hold
 * one: a record built or created through the owner always gets the owner's key (#346).
 */
export function isOwnersKey(key: unknown, owner: Model, association: ResolvedAssociation): boolean {
  if (key === null) return association.keyOf(owner) === null;
  const ownerKey = owner[state].read(association.ownerAttribute) as Key | null;
  return ownerKey !== null && String(key as Key) === String(ownerKey);
}

/** A key's value: what an integer or string key attribute holds. */
type Key = string | number;

/**
 * The first of the target's belongsTo associations through the same foreign key, and type (#60),
 * to the owner's Model: for a hasMany or hasOne with `as`, a polymorphic belongsTo that lists it
 * (Rails finds no inverse there), its branch for the owner's Model.
 */
function inverseOf(
  owner: Model,
  association: ResolvedAssociation,
): ResolvedAssociation | undefined {
  const { target, targetAttribute, ownerAttribute } = association;
  // A scope on either side may leave the owner out, so neither has an inverse; a through
  // association's records hold no key of the owner's.
  if (association.definition.scope !== undefined || association.hops !== undefined)
    return undefined;
  for (const [name, definition] of associationsOf(target)) {
    if (definition.kind !== "belongsTo" || definition.foreignKey !== targetAttribute) continue;
    if (definition.scope !== undefined) continue;
    if (definition.foreignType !== association.definition.foreignType) continue;
    const candidate = resolveAssociation(target, name).branchForRecord(owner);
    if (candidate?.targetAttribute === ownerAttribute) return candidate;
  }
  return undefined;
}
