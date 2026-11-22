// The record methods that make a signed token (#517), and the secret they're signed with:
// `signedId()` and the static `signingSecret`, between Model and its statics, so model.ts stays
// the record class's own.
import { ModelStatics } from "./model-statics.ts";
import type { Model } from "./model.ts";
import { signedIdOf, type SignedIdOptions } from "./signed-ids.ts";
import type { SigningEnv, SigningSecrets } from "./signing-secret.ts";

/** The token methods Model's records have, and the secret their tokens are signed with. */
export abstract class RecordTokens extends ModelStatics {
  /**
   * The secret this Model's tokens are signed with, from the Worker's env (or `process.env`
   * outside a Worker): `SECRET_KEY_BASE` unless overridden, on the app's base class. A list
   * rotates secrets: the first signs, and every one verifies. Each is at least 32 bytes.
   */
  static signingSecret(env: SigningEnv): SigningSecrets {
    return env.SECRET_KEY_BASE;
  }

  /**
   * This saved record's primary key, signed with its Model's secret, for `findSigned` to find it
   * by: for a purpose, if given, and until it expires, if given. `RecordNotSaved` for a new record.
   */
  async signedId(options?: SignedIdOptions): Promise<string> {
    return signedIdOf(this as unknown as Model, options);
  }
}
