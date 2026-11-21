// Secure passwords (#355): `password: { securePassword: true }`, a virtual password with its
// confirmation and challenge, kept in its digest's column as the digest its algorithm makes once
// the record is saved.
import { InvalidModel } from "./errors.ts";
import type { AttributeDefinition } from "./metadata.ts";
import { pbkdf2Sha256, type PasswordAlgorithm } from "./password-algorithm.ts";
import { isSecurePasswordOption } from "./spec-keys.ts";
import { state } from "./record-state.ts";
import type { Validation } from "./validations.ts";

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

/** The names among the attribute specs `A` that are secure passwords. */
type PasswordNames<A> = {
  [K in keyof A]: A[K] extends { securePassword: true | object } ? K & string : never;
}[keyof A];

/** Checks a password against its digest: the record, or `false` when it isn't the one. */
type Authenticate = <R>(this: R, password: string) => Promise<R | false>;

/**
 * What the secure passwords among the specs `A` add to a record: `authenticatePassword` for
 * `password`, `authenticateRecoveryPassword` for `recoveryPassword`, and `authenticate`, for
 * `password` alone.
 */
export type SecurePasswordMethods<A> = {
  [K in PasswordNames<A> as `authenticate${Capitalize<K>}`]: Authenticate;
} & ("password" extends PasswordNames<A> ? { authenticate: Authenticate } : {});

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

/** Each secure password's attributes, which `toJSON()` leaves out: itself, its confirmation and its challenge. */
export function passwordAttributeNames(
  definitions: ReadonlyMap<string, AttributeDefinition>,
): string[] {
  return securePasswordsOf(definitions).flatMap(({ name }) => [name, ...companionsOf(name)]);
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
        digest: digestOf(definitions, name)!,
        algorithm: options.algorithm ?? pbkdf2Sha256,
        isValidated: options.validations !== false,
      },
    ];
  });
}

/** A record as a secure password's methods read it. */
interface Holder {
  readonly [state]: { read(name: string): unknown };
}

/**
 * Defines each secure password's methods on a Model's prototype: `authenticatePassword`, and
 * `authenticate` for `password`, resolving to the record when the password is the one its
 * digest was made from, and `false` when it isn't, or there's no digest.
 */
export function defineSecurePasswordMethods(
  prototype: object,
  definitions: ReadonlyMap<string, AttributeDefinition>,
): void {
  for (const { name, digest, algorithm } of securePasswordsOf(definitions)) {
    async function authenticate(this: Holder, password: string): Promise<Holder | false> {
      const stored = this[state].read(digest);
      if (typeof stored !== "string" || stored === "") return false;
      return (await algorithm.verify(password, stored)) ? this : false;
    }
    const names = [
      `authenticate${capitalized(name)}`,
      ...(name === "password" ? ["authenticate"] : []),
    ];
    for (const method of names) {
      Object.defineProperty(prototype, method, {
        value: authenticate,
        configurable: true,
        writable: true,
      });
    }
  }
}

function capitalized(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The digest's attribute, when `name` is a secure password: `passwordDigest` for `password`. */
export function digestOf(
  definitions: ReadonlyMap<string, AttributeDefinition>,
  name: string,
): string | undefined {
  return definitions.get(name)?.securePassword === undefined ? undefined : `${name}Digest`;
}

/** What a record gives a secure password's save: its values, and a write to its digest. */
export interface PasswordHolder {
  isAttributeChanged(name: string): boolean;
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
    if (typeof password !== "string" || password === "" || !holder.isAttributeChanged(name))
      continue;
    holder.write(digest, await algorithm.hash(password));
  }
}

/** A secure password's failure: the attribute it's on, and its type. */
export interface PasswordFailure {
  readonly attribute: string;
  readonly type: "blank" | "invalid" | "passwordTooLong";
}

/** What a secure password's validation reads of its record: its values, and as they were saved. */
export interface PasswordValues extends Pick<PasswordHolder, "isAttributeChanged" | "read"> {
  valueInDatabase(name: string): unknown;
}

/**
 * The failures of each validated secure password, in order: blank while it has no digest and no
 * password waiting to be hashed; its challenge, when given, invalid unless it's the password the
 * digest as last saved was made from; and too long past its algorithm's `maxBytes`, in UTF-8.
 */
export async function passwordFailures(
  definitions: ReadonlyMap<string, AttributeDefinition>,
  values: PasswordValues,
): Promise<PasswordFailure[]> {
  const failures: PasswordFailure[] = [];
  for (const password of securePasswordsOf(definitions)) {
    if (!password.isValidated) continue;
    const waiting = waitingPassword(password, values);
    if (waiting === undefined && !isPresent(values.read(password.digest))) {
      failures.push({ attribute: password.name, type: "blank" });
    }
    if (!(await isChallengeMet(password, values))) {
      failures.push({ attribute: `${password.name}Challenge`, type: "invalid" });
    }
    const { maxBytes } = password.algorithm;
    if (maxBytes !== undefined && new TextEncoder().encode(waiting).length > maxBytes) {
      failures.push({ attribute: password.name, type: "passwordTooLong" });
    }
  }
  return failures;
}

/** The password assigned since the record was loaded or saved, which a save hashes, if any. */
function waitingPassword({ name }: SecurePassword, values: PasswordValues): string | undefined {
  const password = values.read(name);
  return typeof password === "string" && password !== "" && values.isAttributeChanged(name)
    ? password
    : undefined;
}

/** Whether a digest is there to check a password against: a string that isn't blank. */
function isPresent(digest: unknown): digest is string {
  return typeof digest === "string" && digest.trim() !== "";
}

/** Whether a challenge, if given, is the password the digest as last saved was made from. */
async function isChallengeMet(
  { name, digest, algorithm }: SecurePassword,
  values: PasswordValues,
): Promise<boolean> {
  const challenge = values.read(`${name}Challenge`);
  if (typeof challenge !== "string") return true;
  const saved = values.valueInDatabase(digest);
  return isPresent(saved) && (await algorithm.verify(challenge, saved));
}

/**
 * The `confirmation` rule of each validated secure password: its confirmation, when given, must
 * match it.
 */
export function passwordConfirmations(
  definitions: ReadonlyMap<string, AttributeDefinition>,
): Validation[] {
  return securePasswordsOf(definitions)
    .filter(({ isValidated }) => isValidated)
    .map(({ name }) => ({ attribute: name, options: { confirmation: true, allowNull: true } }));
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
