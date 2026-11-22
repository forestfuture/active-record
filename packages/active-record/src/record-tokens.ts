// The record methods that make a signed token (#517), and the secret they're signed with:
// `signedId()`, `generateTokenFor()` and the statics `signingSecret` and `generatesTokenFor`, between Model and its statics, so model.ts stays
// the record class's own.
import type { AnyDatabase } from "./database.ts";
import { ModelStatics } from "./model-statics.ts";
import type { AbstractModelClass, Model } from "./model.ts";
import { signedIdOf, type SignedIdOptions } from "./signed-ids.ts";
import type { SigningEnv, SigningSecrets } from "./signing-secret.ts";
import { declareTokenFor, tokenFor, type TokenForOptions } from "./tokens-for.ts";

/** The token methods Model's records have, and the secret their tokens are signed with. */
export abstract class RecordTokens extends ModelStatics {
  /**
   * The secret this Model's tokens are signed with, from the Worker's env (or `process.env`
   * outside a Worker): `SECRET_KEY_BASE` unless overridden, on the app's base class. A list
   * rotates secrets: the first signs, and every one verifies. Each is at least 32 bytes. It's
   * given the database the token is made or checked on, so an app with a database per tenant
   * can sign each tenant's tokens with a secret of its own.
   */
  static signingSecret(env: SigningEnv, _database: AnyDatabase): SigningSecrets {
    return env.SECRET_KEY_BASE;
  }

  /**
   * Declares tokens for a purpose, in `static {}`: `this.generatesTokenFor("emailConfirmation", {
   * expiresIn: { days: 1 }, dependsOn: (user) => user.email })`. A record makes one with
   * `generateTokenFor(purpose)`, and `findByTokenFor(purpose, token)` finds it again until it
   * expires or the value it depends on changes. Declaring a purpose again replaces it.
   */
  static generatesTokenFor<C extends AbstractModelClass>(
    this: C,
    purpose: string,
    options?: TokenForOptions<InstanceType<C>>,
  ): void {
    declareTokenFor(this, purpose, options as TokenForOptions<Model>);
  }

  /**
   * A token for `purpose`, which its Model declares with `generatesTokenFor`, for
   * `findByTokenFor` to find this saved record by. `RecordNotSaved` for a new record.
   */
  async generateTokenFor(purpose: string): Promise<string> {
    return tokenFor(this as unknown as Model, purpose);
  }

  /**
   * This saved record's primary key, signed with its Model's secret, for `findSigned` to find it
   * by: for a purpose, if given, and until it expires, if given. `RecordNotSaved` for a new record.
   */
  async signedId(options?: SignedIdOptions): Promise<string> {
    return signedIdOf(this as unknown as Model, options);
  }
}
