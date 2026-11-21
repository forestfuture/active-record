// Secure passwords (#355): `password: { securePassword: true }`, a virtual password with its
// confirmation and challenge, kept in its digest's column as the digest its algorithm makes once
// the record is saved.
import { InvalidModel } from "./errors.ts";
import type { AttributeDefinition } from "./metadata.ts";
import { pbkdf2Sha256, type PasswordAlgorithm } from "./password-algorithm.ts";
import { isSecurePasswordOption } from "./spec-keys.ts";

/** `securePassword`'s options: the algorithm that hashes the password, and its validations. */
export interface SecurePasswordOptions {
  /** What hashes the password and verifies it: PBKDF2-SHA256 unless given. */
  readonly algorithm?: PasswordAlgorithm;
  /** `false` leaves out the validations a secure password adds. */
  readonly validations?: boolean;
}

/** A secure password in `static attributes` or `define`: `password: { securePassword: true }`. */
export interface SecurePasswordDeclaration {
  readonly securePassword: true | SecurePasswordOptions;
}

/** The spec a secure password's own attribute gets: a virtual string that says it's one. */
type PasswordSpec = { type: "string"; virtual: true; securePassword: true };

/** The spec of its confirmation and its challenge: virtual strings. */
type CompanionSpec = { type: "string"; virtual: true };

/** The names among `O` that declare a secure password. */
type DeclaredNames<O> = {
  [K in keyof O]: O[K] extends SecurePasswordDeclaration ? K & string : never;
}[keyof O];

/**
 * The attributes the secure passwords among the declared attributes `O` add: each one, its
 * confirmation and its challenge, virtual strings.
 */
export type SecurePasswordSpecs<O> = {
  -readonly [K in DeclaredNames<O>]: PasswordSpec;
} & {
  -readonly [K in DeclaredNames<O> as `${K}Confirmation` | `${K}Challenge`]: CompanionSpec;
};

/** The declared attributes `O`, each secure password in it replaced by the attributes it adds. */
export type WithSecurePasswords<O> = [DeclaredNames<O>] extends [never]
  ? O
  : { [K in keyof O as K extends DeclaredNames<O> ? never : K]: O[K] } & SecurePasswordSpecs<O>;

/** Whether a declared attribute is a secure password: an object with `securePassword` and no type. */
export function isSecurePasswordDeclaration(
  declared: unknown,
): declared is SecurePasswordDeclaration {
  return (
    typeof declared === "object" &&
    declared !== null &&
    "securePassword" in declared &&
    !("type" in declared)
  );
}

/** The names of the attributes a secure password adds besides itself. */
function companionsOf(name: string): string[] {
  return [`${name}Confirmation`, `${name}Challenge`];
}

/**
 * The declared attributes with each secure password replaced by the virtual attributes it adds;
 * `where` names the Model in an error. One declared with another key, or alongside an attribute
 * it adds, is an `InvalidModel`.
 */
export function withSecurePasswords(
  where: string,
  declared: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const expanded: Record<string, unknown> = {};
  for (const [name, each] of Object.entries(declared)) {
    if (!isSecurePasswordDeclaration(each)) {
      expanded[name] = each;
      continue;
    }
    if (Object.keys(each).length !== 1 || !isSecurePasswordOption(each.securePassword)) {
      throw new InvalidModel(
        `${where}${name}: a secure password is { securePassword: true }, or { securePassword: { algorithm?, validations? } }`,
      );
    }
    expanded[name] = { type: "string", virtual: true, securePassword: each.securePassword };
    for (const companion of companionsOf(name)) {
      if (Object.hasOwn(declared, companion)) {
        throw new InvalidModel(
          `${where}${companion} is declared by the secure password ${name}, so leave it out`,
        );
      }
      expanded[companion] = { type: "string", virtual: true };
    }
  }
  return expanded;
}

/** One secure password, resolved: its attribute, its digest's, its algorithm, and its validations. */
export interface SecurePassword {
  readonly name: string;
  readonly digest: string;
  readonly algorithm: PasswordAlgorithm;
  readonly isValidated: boolean;
}

/** A Model's secure passwords, from its attributes' definitions. */
export function securePasswordsOf(
  definitions: ReadonlyMap<string, AttributeDefinition>,
): SecurePassword[] {
  return [...definitions].flatMap(([name, { securePassword }]) => {
    if (securePassword === undefined) return [];
    const options = securePassword === true ? {} : securePassword;
    return [
      {
        name,
        digest: `${name}Digest`,
        algorithm: options.algorithm ?? pbkdf2Sha256,
        isValidated: options.validations !== false,
      },
    ];
  });
}

/** What a record gives a secure password's save: its values, and a write to its digest. */
export interface PasswordHolder {
  isChanged(name: string): boolean;
  read(name: string): unknown;
  write(name: string, value: unknown): void;
}

/**
 * Hashes each secure password changed since the record was loaded or saved into its digest,
 * as the record is saved; `""` and null leave the digest to their assignment.
 */
export async function hashPasswords(
  definitions: ReadonlyMap<string, AttributeDefinition>,
  holder: PasswordHolder,
): Promise<void> {
  for (const { name, digest, algorithm } of securePasswordsOf(definitions)) {
    const password = holder.read(name);
    if (typeof password !== "string" || password === "" || !holder.isChanged(name)) continue;
    holder.write(digest, await algorithm.hash(password));
  }
}

/**
 * A secure password's digest must be a string attribute with a column: `passwordDigest` for
 * `password`; `InvalidModel` names the column it needs.
 */
export function rejectMissingDigests(model: {
  readonly name: string;
  readonly attributeDefinitions: ReadonlyMap<string, AttributeDefinition>;
}): void {
  for (const { name, digest } of securePasswordsOf(model.attributeDefinitions)) {
    const definition = model.attributeDefinitions.get(digest);
    if (definition === undefined || definition.virtual === true || definition.type !== "string") {
      throw new InvalidModel(
        `${model.name}.${name} is a secure password, so it needs a string attribute ${digest} with a column to keep its digest in`,
      );
    }
  }
}
