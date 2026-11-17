// An association resolved for one owner: which attributes link the records, in what order, and which database its records are on.
// associations.ts imports this module too; both uses are at call time, never at load.
import { readyModel, type AssociationDefinition } from "./associations.ts";
import { currentExecutorOf } from "./current-database.ts";
import type { Executor } from "./executor.ts";
import { associationOf } from "./association-fields.ts";
import { schemaAdapter } from "./generated-model.ts";
import type { Model, ModelClass } from "./model.ts";
import { state } from "./record-state.ts";
import { applyScope, linkedToRecordsOf, queryOf, type Scope, type Scoped } from "./relation.ts";
import { relationFor } from "./scoped-relation.ts";
import { sourceNameOf } from "./through-associations.ts";

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
  readonly target: ModelClass;
  /** The owner's attribute holding the link (a foreign key for belongsTo, a key otherwise). */
  readonly ownerAttribute: string;
  /** The target's attribute the owner's links to. */
  readonly targetAttribute: string;
  /**
   * Whether its target is on another database than its owner (#228): both Models' schemas name
   * a database, and not the same one. Then its records are read and written there.
   */
  readonly isCrossDatabase: boolean;
  /** For a through association (#59), the associations it reaches its records by. */
  readonly hops: Hops | undefined;

  constructor(owner: ModelClass, name: string) {
    this.owner = owner;
    this.name = name;
    this.definition = associationOf(owner, name);
    this.target = this.definition.target();
    // A Model reached only through an association is still verified and gets its accessors.
    readyModel(this.target);
    this.hops = hopsOf(owner, name, this.definition);
    // A through association is linked to its owner as its first hop is, and to its records as
    // its last hop is.
    ({ ownerAttribute: this.ownerAttribute, targetAttribute: this.targetAttribute } =
      this.hops === undefined
        ? linkOf(this.definition, owner, this.target)
        : {
            ownerAttribute: this.hops.via.ownerAttribute,
            targetAttribute: this.hops.source.targetAttribute,
          });
    this.isCrossDatabase = isOnDifferentDatabases(owner, this.target);
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
      (relationFor(this.targetExecutor(executor), this.target) as Scoped<Model>);
    const { scope } = this.definition;
    if (scope === undefined) return relation;
    return relation[applyScope](this.label, scope as Scope<Model>, []) as Scoped<Model>;
  }

  /** The target's records linked to `key` (one value, or a list), for an owner on `executor`. */
  linkedTo(executor: Executor, key: unknown): Scoped<Model> {
    if (this.hops === undefined) return this.all(executor).where({ [this.targetAttribute]: key });
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
      return relation[linkedToRecordsOf](targetAttribute, owners[queryOf], ownerAttribute);
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
   * "destroy"` or `"deleteAll"`) rather than nullifying their foreign key, as in Rails.
   */
  get isDeletingOnDeleteAll(): boolean {
    const { dependent } = this.definition;
    return dependent === "destroy" || dependent === "deleteAll";
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
    if (this.definition.kind !== "belongsTo" && owner[state].isNew) return null;
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
