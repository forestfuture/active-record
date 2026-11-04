// The belongsTo and hasOne accessors: `post.author()` and its `set`, `build`, and `create`.
import { cachedRead } from "./associations.ts";
import { RecordNotSaved } from "./errors.ts";
import { buildRecord, type Model } from "./model.ts";
import { state } from "./record-state.ts";
import type { ResolvedAssociation } from "./resolved-association.ts";

/**
 * A belongsTo's accessor for `owner`: `await post.author()`, plus `set`, `build`, `create` and
 * `createOrThrow`, as Rails' `post.author =`, `build_author` and `create_author`.
 */
export function belongsToAccessor(owner: Model, association: ResolvedAssociation): unknown {
  const read = () =>
    cachedRead(owner, association, (key) =>
      association.all(owner[state].executor).findBy({ [association.targetAttribute]: key }),
    );
  const set = (record: Model | null) => pointOwnerAt(owner, association, record);
  const make = (attributes: Record<string, unknown>) =>
    buildRecord(association.target, attributes, owner[state].executor);
  // Saved first, so the owner points at its new key (the owner itself isn't saved).
  const create =
    (save: (record: Model) => Promise<unknown>) =>
    async (attributes: Record<string, unknown> = {}) => {
      const record = make(attributes);
      await save(record);
      set(record);
      return record;
    };
  return Object.assign(read, {
    set,
    build(attributes: Record<string, unknown> = {}) {
      const record = make(attributes);
      set(record);
      return record;
    },
    create: create((record) => record.save()),
    createOrThrow: create((record) => record.saveOrThrow()),
  });
}

/**
 * Points `owner` at `record` (or at nothing): its foreign key takes the record's key, and the
 * record becomes the loaded association. A new record is saved first when the owner is
 * (autosave), and the key filled in then if D1 generates it.
 */
function pointOwnerAt(owner: Model, association: ResolvedAssociation, record: Model | null): void {
  const { name, target, ownerAttribute, targetAttribute } = association;
  if (record !== null && !(record instanceof target)) {
    throw new TypeError(`${association.label}.set() takes a ${target.name} record or null`);
  }
  const key = record === null ? null : record[state].read(targetAttribute);
  owner[state].pointAt(name, ownerAttribute, key, record);
  owner[state].autosaves.setBelongsTo(
    name,
    record !== null && record[state].isNew ? record : undefined,
  );
}

/**
 * A hasOne's accessor for `owner`: `await user.profile()`, plus `build`, `create` and
 * `createOrThrow`, as Rails' `build_profile` and `create_profile`. An existing record is left
 * as it is (Rails' replacement rules are #40).
 */
export function hasOneAccessor(owner: Model, association: ResolvedAssociation): unknown {
  const read = () =>
    cachedRead(owner, association, (key) =>
      association.inOrder(association.linkedTo(owner[state].executor, key)).first(),
    );
  return Object.assign(read, {
    build(attributes: Record<string, unknown> = {}) {
      const record = buildOne(owner, association, attributes);
      owner[state].autosaves.addBuilt(association.name, record);
      return record;
    },
    create: createOne(owner, association, (record) => record.save()),
    createOrThrow: createOne(owner, association, (record) => record.saveOrThrow()),
  });
}

/**
 * A hasOne's `create` or `createOrThrow` (by `save`): needs a saved owner, as in Rails. A
 * record that doesn't save is kept as built, so saving the owner tries again, as Rails does.
 */
function createOne(
  owner: Model,
  association: ResolvedAssociation,
  save: (record: Model) => Promise<unknown>,
) {
  return async (attributes: Record<string, unknown> = {}) => {
    requireSavedOwner(owner, association);
    const record = buildOne(owner, association, attributes);
    try {
      await save(record);
    } finally {
      if (record[state].isNew) owner[state].autosaves.addBuilt(association.name, record);
    }
    return record;
  };
}

/** As in Rails, records can't be created through an owner that hasn't been saved. */
function requireSavedOwner(owner: Model, association: ResolvedAssociation): void {
  if (!owner[state].isNew) return;
  throw new RecordNotSaved(
    `You cannot create a ${association.target.name} here: ${association.refusalFor(owner)}`,
  );
}

/** A new record of a hasOne, pointing at its owner and loaded as the association. */
function buildOne(
  owner: Model,
  association: ResolvedAssociation,
  attributes: Record<string, unknown>,
): Model {
  const { name, target, ownerAttribute, definition } = association;
  const key = owner[state].read(ownerAttribute);
  // The foreign key is the owner's, written as a key (#94): one given with the attributes is
  // ignored, as it always was, rather than cast and refused as an assigned value.
  const { [definition.foreignKey]: _given, ...rest } = attributes;
  const record = buildRecord(target, rest, owner[state].executor);
  record[state].writeKey(definition.foreignKey, key, name);
  owner[state].associations.set(name, ownerAttribute, record);
  return record;
}
