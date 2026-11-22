// The Relation methods that find a record by a token (#517): `findSigned`, `findByTokenFor` and
// their `OrThrow`s, with this Relation's conditions and default scopes, between Relation and its
// finders' modules so relation.ts stays the chainable query's own.
import type { Model, ModelClass } from "./model.ts";
import { queryOf, type QueryDescription } from "./query.ts";
import { findSigned, type FindSignedOptions } from "./signed-ids.ts";
import { foundByTokenOrThrow, type TokenFinder } from "./token-records.ts";
import { findByTokenFor } from "./tokens-for.ts";

/** The finders by token every Relation has. */
export abstract class TokenFinders<M extends Model> {
  /** @internal */
  abstract get [queryOf](): QueryDescription;
  abstract findBy(conditions: never): Promise<M | null>;

  /**
   * The record a signed id finds (`await user.signedId()`), if this Model's secret signed it for
   * the same `purpose` and it hasn't expired, and this Relation matches it; or null.
   */
  async findSigned(signedId: unknown, options?: FindSignedOptions): Promise<M | null> {
    return (await findSigned(this.#finder, signedId, options)).record;
  }

  /** Like `findSigned`, but throws `InvalidToken` for a signed id that isn't valid, and `RecordNotFound` when its record is gone. */
  async findSignedOrThrow(signedId: unknown, options?: FindSignedOptions): Promise<M> {
    const lookup = await findSigned(this.#finder, signedId, options);
    return foundByTokenOrThrow(this.#finder.model, lookup, "signed id");
  }

  /**
   * The record a token for `purpose` finds (`await user.generateTokenFor(purpose)`), if this
   * Model's secret signed it, it hasn't expired, the value it depends on is unchanged, and this
   * Relation matches it; or null. `TypeError` for a purpose the Model doesn't declare.
   */
  async findByTokenFor(purpose: string, token: unknown): Promise<M | null> {
    return (await findByTokenFor(this.#finder, purpose, token)).record;
  }

  /**
   * Like `findByTokenFor`, but throws `InvalidToken` for a token that isn't valid, and
   * `RecordNotFound` when its record is gone or the value it depends on changed.
   */
  async findByTokenForOrThrow(purpose: string, token: unknown): Promise<M> {
    const lookup = await findByTokenFor(this.#finder, purpose, token);
    return foundByTokenOrThrow(this.#finder.model, lookup, "token");
  }

  /** This Relation, as a token's record is found through it. */
  get #finder(): TokenFinder<M> {
    return {
      model: this[queryOf].model as ModelClass<M>,
      findBy: (conditions) => this.findBy(conditions),
    };
  }
}
