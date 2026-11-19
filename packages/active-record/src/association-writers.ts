// The belongsTo and hasOne accessors: `post.author()` and `user.profile()`, and their `set`, `build`, and `create`.
import { throughHasOne } from "./through-writes.ts";
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
import { runInitializeCallbacks } from "./load-callbacks.ts";
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
  const make = (attributes: Record<string, unknown>) => {
    const record = buildRecord(association.target, attributes, targetDatabase(owner, association));
    runInitializeCallbacks(record);
    return record;
  };
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
 * A polymorphic belongsTo's accessor for `owner` (#60): `await remark.commentable()`, the record
 * of the Model its type names, read through that Model's branch. No `build` or `create`, as in
 * Rails: which Model to make isn't known.
 */
export function polymorphicBelongsToAccessor(
  owner: Model,
  association: ResolvedAssociation,
): unknown {
  const read = () =>
    cachedRead(owner, association, (key) => {
      const branch = association.branchForOwner(owner);
      if (branch === undefined) return Promise.resolve(null);
      return branch.all(owner[state].executor).findBy({ [branch.targetAttribute]: key });
    });
  return Object.assign(read, {
    set: (record: Model | null) => pointPolymorphicAt(owner, association, record),
  });
}

/**
 * Points `owner` at `record`, of any Model its polymorphic belongsTo lists, or at nothing: its
 * type takes the Model's name and its foreign key the record's key (#60). A record of another
 * Model throws `TypeError`.
 */
function pointPolymorphicAt(
  owner: Model,
  association: ResolvedAssociation,
  record: Model | null,
): void {
  requireSettable(association, record);
  const branch = record === null ? undefined : association.branchForRecord(record);
  owner[state].write(association.definition.foreignType!, branch?.type!.value ?? null);
  pointOwnerAt(owner, branch ?? association, record);
}

/**
 * Points `owner` at `record` (or at nothing): its foreign key takes the record's key, and the
 * record becomes the loaded association. A new record is saved first when the owner is
 * (autosave), and the key filled in then if D1 generates it.
 */
export function pointOwnerAt(
  owner: Model,
  association: ResolvedAssociation,
  record: Model | null,
): void {
  const { name } = association;
  requireSettable(association, record);
  // Read only for a record: a polymorphic belongsTo set to null has no one target (#60).
  const key = record === null ? null : record[state].read(association.targetAttribute);
  owner[state].pointAt(association, key, record);
  owner[state].autosaves.setBelongsTo(
    name,
    record !== null && record[state].isNew ? record : undefined,
  );
}

/**
 * What undoes `pointOwnerAt(owner, association, …)`, taken before it: the foreign key, loaded
 * record and pending save it changes, put back as they were.
 */
export function undoPointing(owner: Model, association: ResolvedAssociation): () => void {
  const { name, ownerAttribute } = association;
  const key = owner[state].read(ownerAttribute);
  const loaded = owner[state].associations.get(name);
  const pending = owner[state].autosaves.allBelongsTo().find(([each]) => each === name)?.[1];
  return () => {
    owner[state].writeKey(ownerAttribute, key, name);
    if (loaded === undefined) owner[state].associations.clear(name);
    else owner[state].associations.set(name, ownerAttribute, loaded.value);
    owner[state].autosaves.setBelongsTo(name, pending);
  };
}

/**
 * A hasOne's accessor for `owner`: `await user.profile()`, plus `set`, `build`, `create` and
 * `createOrThrow`, as Rails' `user.profile =`, `build_profile` and `create_profile`. A new record
 * replaces the owner's old one, removed by `dependent:` when the new one is written (#40).
 */
export function hasOneAccessor(owner: Model, association: ResolvedAssociation): unknown {
  const read = () =>
    cachedRead(owner, association, (key) => association.firstLinkedTo(owner[state].executor, key));
  if (association.hops !== undefined) return throughHasOne(read, owner, association);
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
  const { name } = association;
  requireSettable(association, record);
  if (record !== null) {
    const undo = undoAdopting(owner, association, record);
    adopt(owner, association, record);
    if (owner[state].isNew) return;
    // As in Rails, a save that fails or throws leaves the association as it was.
    let saved = false;
    try {
      saved = await record.save();
    } finally {
      if (!saved) undo();
    }
    if (!saved) throw new RecordNotSaved(`Failed to save the new associated ${name}`);
    return;
  }
  // Removed before anything changes here, so a removal that throws leaves the association as it was.
  if (!owner[state].isNew) {
    await removeReplaced({ owner, association, replaced: replacedBy(owner, association) });
  }
  takeReplaced(owner, association);
  owner[state].associations.set(name, association.keyAttributes, null);
  owner[state].autosaves.clear(name);
}

/**
 * Undoes `adopt(owner, association, record)` when `set` fails: the association loaded and built as
 * it was, its built record and `record` replacing what they did, and `record`'s foreign key as
 * it was.
 */
function undoAdopting(owner: Model, association: ResolvedAssociation, record: Model): () => void {
  const { name, definition } = association;
  const loaded = owner[state].associations.get(name);
  const [built] = owner[state].autosaves.built(name);
  const replacement = built === undefined ? undefined : replacementOf(built);
  const key = record[state].read(definition.foreignKey);
  const own = replacementOf(record);
  return () => {
    forgetReplacing(record);
    if (own !== undefined) markReplacing(record, own);
    record[state].writeKey(definition.foreignKey, key, name);
    owner[state].autosaves.clear(name);
    if (built !== undefined) owner[state].autosaves.setBuilt(name, built);
    if (built !== undefined && replacement !== undefined) markReplacing(built, replacement);
    if (loaded === undefined) owner[state].associations.clear(name);
    else owner[state].associations.set(name, association.keyAttributes, loaded.value);
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

/**
 * A new record of a hasOne, made the owner's (`adopt`): its scope's single equality values,
 * then `attributes`, as a hasMany's build takes them.
 */
function buildOne(
  owner: Model,
  association: ResolvedAssociation,
  attributes: Record<string, unknown>,
): Model {
  // The foreign key is the owner's, written as a key (#94): one given with the attributes is
  // ignored, as it always was, rather than cast and refused as an assigned value.
  const { [association.definition.foreignKey]: _given, ...rest } = attributes;
  // Built from the association's records, so it starts with its scope's equality values (#453),
  // pointing at its owner as `build`'s init, so its afterInitialize sees the key (#49). The owner
  // adopts it only once built: a callback that throws leaves the owner as it was.
  const record = association
    .all(owner[state].executor)
    .build(rest as never, (built: Model) => pointAtOwner(owner, association, built));
  adopt(owner, association, record);
  return record;
}

/**
 * Makes `record` the owner's hasOne record: pointing at the owner, loaded as the association,
 * and saved with it. On a saved owner, it replaces the record the association held (#40).
 */
function adopt(owner: Model, association: ResolvedAssociation, record: Model): void {
  const { name } = association;
  const replaced = takeReplaced(owner, association);
  if (!owner[state].isNew) markReplacing(record, { owner, association, replaced });
  pointAtOwner(owner, association, record);
  owner[state].associations.set(name, association.keyAttributes, record);
  owner[state].autosaves.setBuilt(name, record);
  pointBackAtOwner(owner, association, record);
}

/** Points a hasOne's `record` at `owner`: its foreign key, and its owner's type if polymorphic. */
function pointAtOwner(owner: Model, association: ResolvedAssociation, record: Model): void {
  const { name, ownerAttribute, definition } = association;
  record[state].writeKey(definition.foreignKey, owner[state].read(ownerAttribute), name);
  association.writeOwnersType(record);
}

/** Where a record built through `association` for `owner` is saved: its target's database. */
function targetDatabase(owner: Model, association: ResolvedAssociation): Executor {
  return association.targetExecutor(owner[state].executor);
}

/**
 * Throws `TypeError` for a record `set` can't take: one of a Model the association doesn't
 * point at (any of a polymorphic belongsTo's, #60).
 */
export function requireSettable(association: ResolvedAssociation, record: Model | null): void {
  if (record === null || association.branchForRecord(record) !== undefined) return;
  const listed = association.branches.map(({ target }) => target.name).join(" or ");
  throw new TypeError(`${association.label}.set() takes a ${listed} record or null`);
}
