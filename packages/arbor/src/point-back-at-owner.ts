// A record built, created or loaded through its owner's hasMany or hasOne points back at the owner (#339, #62).
import { inverseHasOne, inverseOf } from "./inverse-associations.ts";
import { Model } from "./model.ts";
import { state } from "./record-state.ts";
import type { ResolvedAssociation } from "./resolved-association.ts";

/**
 * Makes `owner` the loaded record of the belongsTo on `record` that is `association`'s inverse
 * (`inverseOf`). So `await post.author()` on a post built or loaded through `user.posts()` is
 * the user, with no query, even before either is saved, and a required belongsTo passes.
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
 * collection.
 */
export function pointLoadedBack(
  owner: Model,
  association: ResolvedAssociation,
  value: Model | readonly Model[] | null,
): void {
  if (value === null) return;
  if (!(value instanceof Model)) {
    for (const record of value) pointBackAtOwner(owner, association, record);
    return;
  }
  if (association.definition.kind !== "belongsTo") {
    pointBackAtOwner(owner, association, value);
    return;
  }
  const inverse = inverseHasOne(value, association.branchForRecord(value) ?? association);
  if (inverse !== undefined)
    value[state].associations.set(inverse.name, inverse.keyAttributes, owner);
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
