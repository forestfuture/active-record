// Tokens for a purpose (#517): `this.generatesTokenFor("emailConfirmation", { expiresIn,
// dependsOn })` declares one, `record.generateTokenFor(purpose)` makes it, and `findByTokenFor`
// finds its record again while it hasn't expired and what it depends on is unchanged.
import { declare, declared } from "./declarations.ts";
import { expiryAfter, secondsOf, type Duration } from "./durations.ts";
import { InvalidModel } from "./errors.ts";
import type { Model, ModelClass } from "./model.ts";
import { resetTokenDefinitions } from "./secure-passwords.ts";
import {
  lookUpToken,
  signableIdOf,
  signedPurposeOf,
  type TokenFinder,
  type TokenLookup,
} from "./token-records.ts";
import type { Signer } from "./message-signing.ts";
import { signerOf } from "./signing-secret.ts";

/** What `generatesTokenFor` takes: how long its tokens last, and a value they depend on. */
export interface TokenForOptions<R> {
  /** How long a token lasts: `{ days: 1 }`. Forever unless given. */
  readonly expiresIn?: Duration;
  /**
   * A value of the record's that its tokens depend on (`(user) => user.email`): a token finds
   * its record only while the value is the same as when it was made. Compared as JSON; a
   * token holds a fingerprint of it, never the value.
   */
  readonly dependsOn?: (record: R) => unknown;
}

/** A purpose's declaration, as a Model keeps it. */
export interface TokenDefinition {
  readonly purpose: string;
  readonly expiresIn?: Duration;
  readonly dependsOn?: (record: Model) => unknown;
}

const OPTION_NAMES = new Set(["expiresIn", "dependsOn"]);

/** Declares a purpose's tokens on `model`; `InvalidModel` for a declaration that isn't one. */
export function declareTokenFor(
  model: { readonly name: string },
  purpose: unknown,
  options: TokenForOptions<Model> = {},
): void {
  const where = `${model.name}.generatesTokenFor`;
  if (typeof purpose !== "string" || purpose === "") {
    throw new InvalidModel(`${where} takes a purpose, such as "emailConfirmation"`);
  }
  const unknown = Object.keys(options).filter((name) => !OPTION_NAMES.has(name));
  if (unknown.length > 0) {
    throw new InvalidModel(
      `${where}("${purpose}") takes expiresIn and dependsOn, not ${unknown.join(", ")}`,
    );
  }
  if (options.dependsOn !== undefined && typeof options.dependsOn !== "function") {
    throw new InvalidModel(`${where}("${purpose}")'s dependsOn is a function of the record`);
  }
  if (options.expiresIn !== undefined)
    secondsOf(options.expiresIn, `${where}("${purpose}")'s expiresIn`);
  declare(model, "tokenDefinitions", { purpose, ...options });
}

/**
 * The declaration of `purpose` on `model`, the last when it's declared again, after its secure
 * passwords' reset tokens; `TypeError` when there's none.
 */
function definitionOf(model: ModelClass, purpose: string): TokenDefinition {
  const definitions = [
    ...resetTokenDefinitions(model.attributeDefinitions),
    ...declared(model, "tokenDefinitions"),
  ];
  const found = definitions.findLast((definition) => definition.purpose === purpose);
  if (found === undefined) {
    throw new TypeError(
      `${model.name} has no tokens for "${purpose}"; declare them with this.generatesTokenFor("${purpose}") in its static {} block`,
    );
  }
  return found;
}

/** What a purpose's tokens are signed for: the Model's table, the purpose, and how long they last. */
function signedPurpose(model: ModelClass, { purpose, expiresIn }: TokenDefinition): string {
  const seconds = expiresIn === undefined ? null : secondsOf(expiresIn, "expiresIn");
  return signedPurposeOf(model, purpose, seconds);
}

/** A token for `purpose`, for a saved record; `RecordNotSaved` for a new one. */
export async function tokenFor(record: Model, purpose: string): Promise<string> {
  const model = record.constructor as ModelClass;
  const definition = definitionOf(model, purpose);
  const id = signableIdOf(record, "generateTokenFor");
  const { expiresIn, dependsOn } = definition;
  const signer = await signerOf(model, "token for");
  return signer.sign(signedPurpose(model, definition), {
    id,
    ...(expiresIn !== undefined && { expiresAt: expiryAfter(expiresIn, "expiresIn") }),
    ...(dependsOn !== undefined && { dependsOn: await dependsOn(record) }),
  });
}

/**
 * Looks up the record a token for `purpose` finds through `finder`, while it hasn't expired and
 * what it depends on is unchanged.
 */
export async function findByTokenFor<M extends Model>(
  finder: TokenFinder<M>,
  purpose: string,
  token: unknown,
): Promise<TokenLookup<M>> {
  const definition = definitionOf(finder.model, purpose);
  const signer = await signerOf(finder.model, "token for");
  const signed: [Signer, string] = [signer, signedPurpose(finder.model, definition)];
  const { dependsOn } = definition;
  if (dependsOn === undefined) return lookUpToken(finder, signed, token);
  return lookUpToken(finder, signed, token, async (record, verified) =>
    verified.isUnchanged(await dependsOn(record)),
  );
}
