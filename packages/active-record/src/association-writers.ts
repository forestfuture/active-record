// The belongsTo and hasOne accessors: `post.author()` and `user.profile()`, and their `set`, `build`, and `create`.
import { cachedRead } from "./associations.ts";
import { RecordNotSaved } from "./errors.ts";
import type { Executor } from "./executor.ts";
import {
  forgetReplacing,
  markReplacing,
  removeReplaced,
  replacedBy,
  replacementOf,
  takeReplaced,
} from "./has-one-replacement.ts";
import { pointBackAtOwner } from "./point-back-at-owner.ts";
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
  // On the target's database, which is the owner's unless the association crosses to another.
  const make = (attributes: Record<string, unknown>) =>
    buildRecord(association.target, attributes, targetDatabase(owner, association));
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
 * A hasOne's accessor for `owner`: `await user.profile()`, plus `set`, `build`, `create` and
 * `createOrThrow`, as Rails' `user.profile =`, `build_profile` and `create_profile`. A new record
 * replaces the owner's old one, removed by `dependent:` when the new one is written (#40).
 */
export function hasOneAccessor(owner: Model, association: ResolvedAssociation): unknown {
  const read = () =>
    cachedRead(owner, association, (key) => association.firstLinkedTo(owner[state].executor, key));
  return Object.assign(read, {
    set: (record: Model | null) => setOne(owner, association, record),
    build: (attributes: Record<string, unknown> = {}) => buildOne(owner, association, attributes),
    create: createOne(owner, association, (record) => record.save()),
    createOrThrow: createOne(owner, association, (record) => record.saveOrThrow()),
  });
}

/**
 * A hasOne's `set`: on a saved owner, `record` is saved at once, pointing at it, and the old
 * record removed in the same batch, as Rails' `user.profile =` does; if `record` doesn't save,
 * it throws `RecordNotSaved` and the association stays as it was. On an unsaved owner, both
 * wait for its save.
 * `null` removes the old record.
 */
async function setOne(
  owner: Model,
  association: ResolvedAssociation,
  record: Model | null,
): Promise<void> {
  const { target, name, ownerAttribute } = association;
  if (record !== null && !(record instanceof target)) {
    throw new TypeError(`${association.label}.set() takes a ${target.name} record or null`);
  }
  if (record !== null) {
    const undo = undoAdopting(owner, association, record);
    adopt(owner, association, record);
    if (owner[state].isNew || (await record.save())) return;
    // As in Rails, the association stays as it was, and the record isn't the owner's.
    undo();
    throw new RecordNotSaved(`Failed to save the new associated ${name}`);
  }
  // Removed before anything changes here, so a removal that throws leaves the association as it was.
  if (!owner[state].isNew) {
    await removeReplaced({ owner, association, replaced: replacedBy(owner, association) });
  }
  takeReplaced(owner, association);
  owner[state].associations.set(name, ownerAttribute, null);
  owner[state].autosaves.clear(name);
}

/**
 * Undoes `adopt(owner, association, record)` when `set` fails: the association loaded and built as
 * it was, its built record replacing what it did, and `record`'s foreign key as it was.
 */
function undoAdopting(owner: Model, association: ResolvedAssociation, record: Model): () => void {
  const { name, ownerAttribute, definition } = association;
  const loaded = owner[state].associations.get(name);
  const [built] = owner[state].autosaves.built(name);
  const replacement = built === undefined ? undefined : replacementOf(built);
  const key = record[state].read(definition.foreignKey);
  return () => {
    forgetReplacing(record);
    record[state].writeKey(definition.foreignKey, key, name);
    owner[state].autosaves.clear(name);
    if (built !== undefined) owner[state].autosaves.setBuilt(name, built);
    if (built !== undefined && replacement !== undefined) markReplacing(built, replacement);
    if (loaded === undefined) owner[state].associations.clear(name);
    else owner[state].associations.set(name, ownerAttribute, loaded.value);
  };
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
    await save(record);
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

/** A new record of a hasOne, made the owner's (`adopt`). */
function buildOne(
  owner: Model,
  association: ResolvedAssociation,
  attributes: Record<string, unknown>,
): Model {
  // The foreign key is the owner's, written as a key (#94): one given with the attributes is
  // ignored, as it always was, rather than cast and refused as an assigned value.
  const { [association.definition.foreignKey]: _given, ...rest } = attributes;
  const record = buildRecord(association.target, rest, targetDatabase(owner, association));
  adopt(owner, association, record);
  return record;
}

/**
 * Makes `record` the owner's hasOne record: pointing at the owner, loaded as the association,
 * and saved with it. On a saved owner, it replaces the record the association held (#40).
 */
function adopt(owner: Model, association: ResolvedAssociation, record: Model): void {
  const { name, ownerAttribute, definition } = association;
  const replaced = takeReplaced(owner, association);
  if (!owner[state].isNew) markReplacing(record, { owner, association, replaced });
  record[state].writeKey(definition.foreignKey, owner[state].read(ownerAttribute), name);
  owner[state].associations.set(name, ownerAttribute, record);
  owner[state].autosaves.setBuilt(name, record);
  pointBackAtOwner(owner, association, record);
}

/** Where a record built through `association` for `owner` is saved: its target's database. */
function targetDatabase(owner: Model, association: ResolvedAssociation): Executor {
  return association.targetExecutor(owner[state].executor);
}
