// Secure tokens (#355): `authToken: { secureToken: true }`, a random base58 token generated for a
// new record when it's built or created, and `regenerateAuthToken()`, which saves a new one.
import type { AttributeDefinition } from "./metadata.ts";
import { capitalized } from "./naming.ts";

/** `secureToken`'s options: how long the token is, a prefix, and when it's generated. */
export interface SecureTokenOptions {
  /** Its characters, after any prefix: 24 unless given, and at least 24. */
  readonly length?: number;
  /** Text before the token: `true` for the column's name and `_` (`auth_token_…`), or its own. */
  readonly prefix?: true | string;
  /** When a new record without one gets it: as it's built (the default), or as it's created. */
  readonly on?: "initialize" | "create";
}

/** The fewest characters a secure token has. */
const MINIMUM_TOKEN_LENGTH = 24;

/** Base58: digits and letters, without `0`, `O`, `I` and `l`, which read alike. */
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** The bytes below it map onto the alphabet evenly; the rest are drawn again. */
const EVEN_BYTES = 256 - (256 % ALPHABET.length);

/**
 * A random base58 token of `length` characters (24 unless given), from `crypto.getRandomValues`,
 * each character equally likely. Nothing checks it's unique: a unique index does that.
 */
export function generateSecureToken(length: number = MINIMUM_TOKEN_LENGTH): string {
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new RangeError(`generateSecureToken needs a whole number of characters, not ${length}`);
  }
  let token = "";
  while (token.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      if (byte < EVEN_BYTES && token.length < length) token += ALPHABET[byte % ALPHABET.length];
    }
  }
  return token;
}

/** Whether an attribute's `secureToken` is well formed: `true`, `false`, or its options. */
export function isSecureTokenOption(value: unknown): boolean {
  if (typeof value === "boolean") return true;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, each]) => isTokenOption(key, each));
}

function isTokenOption(key: string, value: unknown): boolean {
  if (value === undefined) return true;
  if (key === "length") return Number.isSafeInteger(value);
  if (key === "prefix") return value === true || (typeof value === "string" && value !== "");
  return key === "on" && (value === "initialize" || value === "create");
}

/** What's wrong with a well-formed `secureToken`, after the attribute's name: too short a length. */
export function secureTokenProblem(value: unknown): string | undefined {
  const length = (value as SecureTokenOptions | undefined)?.length;
  return length !== undefined && length < MINIMUM_TOKEN_LENGTH
    ? ` has a secureToken of length ${length}; a secure token is at least ${MINIMUM_TOKEN_LENGTH} characters`
    : undefined;
}

/** An attribute's secure token options, if it has one. */
function tokenOptionsOf(definition: AttributeDefinition): SecureTokenOptions | undefined {
  const { secureToken } = definition;
  if (secureToken === undefined) return undefined;
  return secureToken === true ? {} : secureToken;
}

/** Whether an attribute's token is generated as a record is built: its `on` isn't `"create"`. */
export function isTokenOnInitialize(definition: AttributeDefinition): boolean {
  const options = tokenOptionsOf(definition);
  return options !== undefined && options.on !== "create";
}

/** A new token for an attribute declared with `secureToken`: its prefix, then its characters. */
export function tokenFor(definition: AttributeDefinition): string {
  const { length = MINIMUM_TOKEN_LENGTH, prefix } = tokenOptionsOf(definition) ?? {};
  const before = prefix === true ? `${definition.column}_` : (prefix ?? "");
  return `${before}${generateSecureToken(length)}`;
}

/** What a new record gives its tokens' generation as it's created: its values, and a write. */
export interface TokenHolder {
  read(name: string): unknown;
  write(name: string, value: unknown): void;
}

/**
 * Generates each token a new record doesn't have (null or `""`) as it's built (`"initialize"`,
 * after its given values) or created (`"create"`), whichever its `on` says.
 */
export function generateTokens(
  definitions: ReadonlyMap<string, AttributeDefinition>,
  holder: TokenHolder,
  moment: "initialize" | "create",
): void {
  for (const [name, definition] of definitions) {
    const options = tokenOptionsOf(definition);
    if (options === undefined || (options.on ?? "initialize") !== moment) continue;
    const value = holder.read(name);
    if (value === null || value === "") holder.write(name, tokenFor(definition));
  }
}

/** A record, as its tokens' methods save it. */
interface UpdatableRecord {
  update(attributes: Record<string, unknown>): Promise<boolean>;
  updateOrThrow(attributes: Record<string, unknown>): Promise<true>;
}

/**
 * Defines each secure token's methods on a Model's prototype: `regenerateAuthToken()`, which
 * saves a new token as `update` would, and its `OrThrow`.
 */
export function defineSecureTokenMethods(
  prototype: object,
  definitions: ReadonlyMap<string, AttributeDefinition>,
): void {
  for (const [name, definition] of definitions) {
    if (definition.secureToken === undefined) continue;
    const methods = {
      [`regenerate${capitalized(name)}`]: function (this: UpdatableRecord) {
        return this.update({ [name]: tokenFor(definition) });
      },
      [`regenerate${capitalized(name)}OrThrow`]: function (this: UpdatableRecord) {
        return this.updateOrThrow({ [name]: tokenFor(definition) });
      },
    };
    for (const [method, value] of Object.entries(methods)) {
      Object.defineProperty(prototype, method, { value, configurable: true, writable: true });
    }
  }
}

/** The names among the attribute specs `A` that are secure tokens. */
type TokenNames<A> = {
  [K in keyof A]: A[K] extends { secureToken: true | object } ? K & string : never;
}[keyof A];

/**
 * What the secure tokens among the specs `A` add to a record: `regenerateAuthToken()`, resolving
 * to `false` when the record is invalid or a callback aborts, and its `OrThrow`.
 */
export type SecureTokenMethods<A> = {
  [K in TokenNames<A> as `regenerate${Capitalize<K>}`]: () => Promise<boolean>;
} & {
  [K in TokenNames<A> as `regenerate${Capitalize<K>}OrThrow`]: () => Promise<true>;
};
