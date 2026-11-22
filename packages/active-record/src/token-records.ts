// What signed ids and tokens for a purpose share (#517): the id a saved record's token holds, the
// purpose it's signed for, and looking up a token's record through a Relation, its conditions
// and default scopes kept, to resolve to null or throw.
import { InvalidToken, RecordNotSaved } from "./errors.ts";
import type { Executor } from "./executor.ts";
import { foundOrThrow } from "./finder-order.ts";
import type { Signer, VerifiedMessage } from "./message-signing.ts";
import { asStored } from "./normalized-values.ts";
import type { Model, ModelClass } from "./model.ts";
import { state } from "./record-state.ts";

/** A saved record's primary key, which a token holds; `RecordNotSaved` for a new record. */
export function signableIdOf(record: Model, method: string): string | number {
  const model = record.constructor as ModelClass;
  if (record[state].isNew) {
    throw new RecordNotSaved(
      `${model.name} record hasn't been saved, so ${method} has no id to sign`,
    );
  }
  return record[state].read(model.primaryKey) as string | number;
}

/** What a Model's token is signed for: its table, then what else the token is for. */
export function signedPurposeOf(model: ModelClass, ...purpose: unknown[]): string {
  return JSON.stringify([model.table, ...purpose]);
}

/** What finds a token's record: a Relation, its conditions and default scopes kept. */
export interface TokenFinder<M extends Model> {
  readonly model: ModelClass<M>;
  /** Where it sends its query, whose database the token's secret is for. */
  readonly executor: Executor;
  findBy(conditions: never): Promise<M | null>;
}

/** A token's lookup: whether the token is valid, and the record it found, if any. */
export interface TokenLookup<M> {
  readonly isValid: boolean;
  readonly record: M | null;
}

/** Whether a verified token's record is still the one it was made for. */
type StillFor<M> = (record: M, verified: VerifiedMessage) => Promise<boolean>;

/**
 * Looks up the record a token finds through `finder`, if `signer` signed it for `purpose` and it
 * hasn't expired, and `isStillFor` (when given) says the record is still the one it was for. A
 * value that isn't a string isn't a valid token.
 */
export async function lookUpToken<M extends Model>(
  finder: TokenFinder<M>,
  [signer, purpose]: [Signer, string],
  token: unknown,
  isStillFor?: StillFor<M>,
): Promise<TokenLookup<M>> {
  const verified = typeof token === "string" ? await signer.verify(purpose, token) : undefined;
  if (verified === undefined) return { isValid: false, record: null };
  const record = await finder.findBy(asStored({ [finder.model.primaryKey]: verified.id }) as never);
  const isFor =
    record !== null && (isStillFor === undefined || (await isStillFor(record, verified)));
  return { isValid: true, record: isFor ? record : null };
}

/**
 * The record a lookup found; `InvalidToken` (naming `what`) for a token that isn't valid, and
 * `RecordNotFound` when a valid one found none.
 */
export function foundByTokenOrThrow<M extends Model>(
  model: ModelClass,
  { isValid, record }: TokenLookup<M>,
  what: string,
): M {
  if (!isValid) {
    throw new InvalidToken(
      `The ${what} isn't valid: it's changed, expired, or for another purpose`,
    );
  }
  return foundOrThrow(model, record);
}
