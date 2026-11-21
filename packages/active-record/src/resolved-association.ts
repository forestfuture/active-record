// An association resolved for one owner: which attributes link the records (a polymorphic one's type too, #60), in what order, which database its records are on, and what nullifying them clears.
// associations.ts imports this module too; both uses are at call time, never at load.
import { readyModel, type AssociationDefinition } from "./associations.ts";
import { LinkedTo, type QueryDescription } from "./query.ts";
import { currentExecutorOf } from "./current-database.ts";
import { UnknownModelName } from "./errors.ts";
import type { Executor } from "./executor.ts";
import type { KeyAttributes } from "./loaded-associations.ts";
import { associationOf } from "./association-fields.ts";
import { schemaAdapter } from "./generated-model.ts";
import type { Model, ModelClass } from "./model.ts";
import { state } from "./record-state.ts";
import { applyScope, linkedToOwner, queryOf, type Scope, type Scoped } from "./relation.ts";
import { relationFor } from "./scoped-relation.ts";
import { sourceNameOf } from "./through-associations.ts";
import { tableOwnerModelName } from "./table-names.ts";

/**
 * How an association links records: the owner's `ownerAttribute` equals the target's
 * `targetAttribute`. For belongsTo that's owner.foreignKey = target.primaryKey; for
 * hasMany/hasOne it's owner.primaryKey = target.foreignKey. The one place this is decided.
 */
export function linkOf(
  definition: AssociationDefinition,
  owner: ModelClass,
  target: ModelClass,
): { ownerAttribute: string; targetAttribute: string } {
  return definition.kind === "belongsTo"
    ? {
        ownerAttribute: definition.foreignKey,
        targetAttribute: definition.primaryKey ?? target.primaryKey,
      }
    : {
        ownerAttribute: definition.primaryKey ?? owner.primaryKey,
        targetAttribute: definition.foreignKey,
      };
}

/**
 * The two associations a through association (#59) reaches its records by: `via`, one of its
 * owner's, and `source`, one of `via`'s target's, whose target is its own.
 */
export interface Hops {
  via: ResolvedAssociation;
  source: ResolvedAssociation;
}

/**
 * One declared association of one Model, worked out once: its target Model (made ready for
 * use), the attributes that link the two, and the queries for its records, with its scope and
 * order. Everything that reads, preloads, writes or destroys through an association asks this,
 * so they agree on how records are linked and ordered.
 */
export class ResolvedAssociation {
  readonly owner: ModelClass;
  readonly name: string;
  readonly definition: AssociationDefinition;
  /** The owner's attribute holding the link (a foreign key for belongsTo, a key otherwise). */
  readonly ownerAttribute: string;
  /**
   * A polymorphic belongsTo's (#60): one association to each Model it lists, each linking the
   * records whose type names it. Any other association is its own one branch.
   */
  readonly branches: readonly ResolvedAssociation[];
  /**
   * A polymorphic link's type (#60): the attribute naming a Model, on the owner for a
   * belongsTo, and the name it holds for this association's records.
   */
  readonly type: { attribute: string; value: string } | undefined;
  /** For a through association (#59), the associations it reaches its records by. */
  readonly hops: Hops | undefined;
  readonly #link: Link | undefined;

  /** One association; for a polymorphic belongsTo, `target` is one of its Models (a branch). */
  constructor(owner: ModelClass, name: string, target?: ModelClass) {
    this.owner = owner;
    this.name = name;
    this.definition = associationOf(owner, name);
    this.ownerAttribute = this.definition.foreignKey;
    const listed = this.definition.targets?.();
    if (listed !== undefined && target === undefined) {
      this.branches = listed.map((each) => new ResolvedAssociation(owner, name, each));
      this.type = undefined;
      this.hops = undefined;
      this.#link = undefined;
      return;
    }
    const linked = target ?? this.definition.target();
    // A Model reached only through an association is still verified and gets its accessors.
    readyModel(linked);
    this.hops = hopsOf(owner, name, this.definition);
    this.#link = linkFor(this.definition, owner, linked, this.hops);
    this.ownerAttribute = this.#link.ownerAttribute;
    this.type = typeOf(this.definition, owner, this.#link.target);
    this.branches = [this];
  }

  /** The target Model: a polymorphic belongsTo has one per branch. */
  get target(): ModelClass {
    return this.#linked.target;
  }

  /** The target's attribute the owner's links to. */
  get targetAttribute(): string {
    return this.#linked.targetAttribute;
  }

  /**
   * Whether its target is on another database than its owner (#228): both Models' schemas name
   * a database, and not the same one. Then its records are read and written there.
   */
  get isCrossDatabase(): boolean {
    return this.#linked.isCrossDatabase;
  }

  get #linked(): Link {
    if (this.#link === undefined) {
      throw new Error(`${this.label} has no single target; use the branch for a record`);
    }
    return this.#link;
  }

  /**
   * The owner's attributes its loaded records are kept for: its key, and a polymorphic
   * belongsTo's type too (#60), so changing either reads again.
   */
  get keyAttributes(): KeyAttributes {
    const { kind, foreignType } = this.definition;
    return kind === "belongsTo" && foreignType !== undefined
      ? belongsToKeys(this.definition)
      : this.ownerAttribute;
  }

  /**
   * Whether it's a polymorphic belongsTo itself, resolved into a branch per listed Model, rather
   * than one of its branches or any other association (#60).
   */
  get isBranched(): boolean {
    return this.#link === undefined;
  }

  /**
   * Whether it's a polymorphic belongsTo (#60), whose record may be of several Models: itself, or
   * one of its branches.
   */
  get isPolymorphic(): boolean {
    return this.definition.targets !== undefined;
  }

  /**
   * The branch for the record `owner` points at: the one its type names, or none when its type
   * is null; `UnknownModelName` when it names none of them. Any other association is its own.
   */
  branchForOwner(owner: Model): ResolvedAssociation | undefined {
    if (!this.isPolymorphic) return this;
    const value = owner[state].read(this.definition.foreignType!);
    if (value === null) return undefined;
    const branch = this.branches.find((each) => each.type!.value === value);
    if (branch !== undefined) return branch;
    const listed = this.branches.map(({ type }) => type!.value).join(", ");
    throw new UnknownModelName(
      `${this.label} has the type ${JSON.stringify(value)}, which is none of its Models: ${listed}`,
    );
  }

  /** The branch whose Model `record` is of, if any. */
  branchForRecord(record: Model): ResolvedAssociation | undefined {
    return this.branches.find((branch) => record instanceof branch.target);
  }

  /** `User.posts`: how the association is named in messages. */
  get label(): string {
    return `${this.owner.name}.${this.name}`;
  }

  /**
   * Where its records are for an owner on `executor`: the owner's database, or for an
   * association to another database, the target's current one, as its statics find it.
   */
  targetExecutor(executor: Executor): Executor {
    return this.isCrossDatabase ? currentExecutorOf(this.target) : executor;
  }

  /** The target's records for an owner on `executor`, with the association's scope applied. */
  all(executor: Executor): Scoped<Model> {
    // A through association's records are its source's, with the source's scope too.
    const relation =
      this.hops?.source.all(executor) ??
      this.#ofOwnersType(relationFor(this.targetExecutor(executor), this.target) as Scoped<Model>);
    const { scope } = this.definition;
    if (scope === undefined) return relation;
    return relation[applyScope](this.label, scope as Scope<Model>, []) as Scoped<Model>;
  }

  /**
   * `relation`, for a hasMany or hasOne with `as` (#60), narrowed to the records whose type is
   * the owner's Model, so records built through it take that type too.
   */
  #ofOwnersType(relation: Scoped<Model>): Scoped<Model> {
    if (this.definition.as === undefined) return relation;
    const { attribute, value } = this.type!;
    return relation[linkedToOwner]({ [attribute]: value });
  }

  /** The target's records linked to `key` (one value, or a list), for an owner on `executor`. */
  linkedTo(executor: Executor, key: unknown): Scoped<Model> {
    if (this.hops === undefined) {
      return this.all(executor)[linkedToOwner]({ [this.targetAttribute]: key });
    }
    const { via, source } = this.hops;
    return source.narrowToLinked(executor, this.all(executor), via.linkedTo(executor, key));
  }

  /**
   * `relation`, of the target's records, narrowed with subqueries to those linked to a record
   * `owners` finds, through each hop of a through association.
   */
  narrowToLinked(
    executor: Executor,
    relation: Scoped<Model>,
    owners: Scoped<Model>,
  ): Scoped<Model> {
    if (this.hops === undefined) {
      const { targetAttribute, ownerAttribute } = this;
      return linkedToRecords(relation, targetAttribute, owners[queryOf], ownerAttribute);
    }
    const { via, source } = this.hops;
    const joined = via.narrowToLinked(executor, via.all(executor), owners);
    return source.narrowToLinked(executor, relation, joined);
  }

  /** Why records can't be created through the association for `owner`, which has no key. */
  refusalFor(owner: Model): string {
    const { name } = this.owner;
    return owner[state].isNew
      ? `the ${name} hasn't been saved; save the ${name} first`
      : `the ${name} has no ${this.ownerAttribute}`;
  }

  /**
   * Whether `deleteAll()` on the association itself deletes the records (`dependent:
   * "destroy"` or `"deleteAll"`) rather than nullifying their foreign key.
   */
  get isDeletingOnDeleteAll(): boolean {
    const { dependent } = this.definition;
    return dependent === "destroy" || dependent === "deleteAll";
  }

  /**
   * Gives `record` its owner's type, for a hasMany or hasOne with `as` (#60): the name of the
   * owner's Model, which the other side's polymorphic belongsTo reads.
   */
  writeOwnersType(record: Model): void {
    if (this.definition.as === undefined) return;
    const { attribute, value } = this.type!;
    // The link's type, as its key, isn't normalized (#354).
    record[state].writeKey(attribute, value, this.name);
  }

  /**
   * The Model's name `record` holds as its type when it isn't its owner's, for a hasMany or
   * hasOne with `as` (#60); undefined when it's the owner's, or there's no type.
   */
  otherTypeOf(record: Model): string | null | undefined {
    if (this.definition.as === undefined) return undefined;
    const { attribute, value } = this.type!;
    const held = record[state].read(attribute) as string | null;
    return held === value ? undefined : held;
  }

  /**
   * The target's attributes a hasMany or hasOne sets to null to stop its records pointing at
   * the owner: the foreign key, and with `as` the type too (#60).
   */
  get nullifiedAttributes(): readonly string[] {
    const { foreignKey, foreignType, as } = this.definition;
    return as === undefined ? [foreignKey] : [foreignKey, foreignType!];
  }

  /** `nullifiedAttributes`, each set to null: what a nullifying `updateAll` writes. */
  get nullified(): Record<string, null> {
    return Object.fromEntries(this.nullifiedAttributes.map((each) => [each, null]));
  }

  /**
   * `relation` in the association's order: its scope's, then the target's primary key, so
   * lazy reads, preloads and dependents agree, and a hasOne on its one record.
   */
  inOrder(relation: Scoped<Model>): Scoped<Model> {
    return relation.order({ [this.target.primaryKey]: "asc" });
  }

  /** A hasOne's record for `key`: the first linked to it, in the association's order. */
  firstLinkedTo(executor: Executor, key: unknown): Promise<Model | null> {
    return this.inOrder(this.linkedTo(executor, key)).first();
  }

  /**
   * The owner's value its targets are linked by: a belongsTo's foreign key, or for a
   * hasMany/hasOne the owner's key, null while the owner is new (it has no stored records).
   */
  keyOf(owner: Model): unknown {
    if (this.hops !== undefined) return this.hops.via.keyOf(owner);
    if (this.definition.kind !== "belongsTo") {
      return owner[state].isNew ? null : owner[state].read(this.ownerAttribute);
    }
    // A polymorphic belongsTo with no type points at nothing (#60).
    const { foreignType } = this.definition;
    if (foreignType !== undefined && owner[state].read(foreignType) === null) return null;
    return owner[state].read(this.ownerAttribute);
  }
}

/**
 * A through association's hops: `via`, the owner's association it names, and `source`, the
 * association of `via`'s target that reaches its records (checked when the owner was readied).
 */
function hopsOf(
  owner: ModelClass,
  name: string,
  definition: AssociationDefinition,
): Hops | undefined {
  if (definition.through === undefined) return undefined;
  const via = resolveAssociation(owner, definition.through);
  const source = sourceNameOf(name, definition, via.target)!;
  return { via, source: resolveAssociation(via.target, source) };
}

/**
 * The owner's attributes a belongsTo links by, read from its declaration alone: its foreign key,
 * and a polymorphic one's type (#60).
 */
export function belongsToKeys({ foreignKey, foreignType }: AssociationDefinition): string[] {
  return foreignType === undefined ? [foreignKey] : [foreignKey, foreignType];
}

/** How a resolved association links its owner to one target Model. */
interface Link {
  target: ModelClass;
  ownerAttribute: string;
  targetAttribute: string;
  isCrossDatabase: boolean;
}

/**
 * How `definition` links `owner` to `target`. A through association is linked to its owner as
 * its first hop is, and to its records as its last hop is (#59).
 */
function linkFor(
  definition: AssociationDefinition,
  owner: ModelClass,
  target: ModelClass,
  hops: Hops | undefined,
): Link {
  const attributes =
    hops === undefined
      ? linkOf(definition, owner, target)
      : { ownerAttribute: hops.via.ownerAttribute, targetAttribute: hops.source.targetAttribute };
  return { target, ...attributes, isCrossDatabase: isOnDifferentDatabases(owner, target) };
}

/**
 * A polymorphic link's type (#60), the name of the Model whose table it is (a subclass's base
 * class): a polymorphic belongsTo branch's owner holds its target's, and the records of a
 * hasMany or hasOne with `as` hold their owner's.
 */
function typeOf(
  { targets, as, foreignType }: AssociationDefinition,
  owner: ModelClass,
  target: ModelClass,
): ResolvedAssociation["type"] {
  if (targets !== undefined) return { attribute: foreignType!, value: tableOwnerModelName(target) };
  if (as !== undefined) return { attribute: foreignType!, value: tableOwnerModelName(owner) };
  return undefined;
}

/** Whether the schemas `owner` and `target` are built on name two different databases. */
export function isOnDifferentDatabases(owner: ModelClass, target: ModelClass): boolean {
  const [mine, theirs] = [schemaAdapter(owner), schemaAdapter(target)];
  if (mine === undefined || theirs === undefined) return false;
  return mine.adapter !== theirs.adapter || mine.binding !== theirs.binding;
}

/** Each Model's resolved associations, worked out on first use. Derived from the class only. */
const resolved = new WeakMap<ModelClass, Map<string, ResolvedAssociation>>();

/** The association `name` of `owner`, resolved once. */
export function resolveAssociation(owner: ModelClass, name: string): ResolvedAssociation {
  readyModel(owner);
  const perModel = resolved.get(owner) ?? new Map<string, ResolvedAssociation>();
  resolved.set(owner, perModel);
  let association = perModel.get(name);
  if (association === undefined) {
    association = new ResolvedAssociation(owner, name);
    perModel.set(name, association);
  }
  return association;
}

/**
 * `relation` narrowed to the records whose `attribute` is the `ownerKey` of a record `owners`
 * finds, with a subquery, `attribute IN (SELECT ownerKey …)`: a link no rewrite drops (#350).
 */
export function linkedToRecords<M extends Model>(
  relation: Scoped<M>,
  attribute: string,
  owners: QueryDescription,
  ownerKey: string,
): Scoped<M> {
  if (owners.none) return relation.none();
  return relation[linkedToOwner](new LinkedTo(attribute, owners, ownerKey));
}
