// The secrets a Model's tokens are signed with (#517): what its `signingSecret` returns from the
// Worker's env (`SECRET_KEY_BASE` unless it says otherwise), newest first, read when a token is
// made or checked.
import { InvalidModel } from "./errors.ts";
import { signerFor, type Signer, type SigningFeature } from "./message-signing.ts";
import { workersEnv, type WorkersEnv } from "./workers-env.ts";

/** What a Model's `signingSecret` reads secrets from: the Worker's env, by name. */
export type SigningEnv = Readonly<Record<string, string | undefined>>;

/** What `signingSecret` returns: a secret, or a list of them, newest first; unset ones skipped. */
export type SigningSecrets = string | readonly (string | undefined)[] | undefined;

/** A Model, as its tokens find their secrets. */
export interface SigningModel {
  readonly name: string;
  signingSecret(env: SigningEnv): SigningSecrets;
}

/** The fewest bytes a secret has: HMAC-SHA256's own key length. */
const MINIMUM_BYTES = 32;

/**
 * The Worker's env, read once. Module-level, but not request state (ADR-0003): it's the
 * Worker's, the same for every request.
 */
let workerEnv: Promise<WorkersEnv | undefined> | undefined;

/** The env secrets are read from: the Worker's, or else the process's (tests, scripts). */
async function envForSecrets(): Promise<SigningEnv> {
  workerEnv ??= workersEnv(() => import("cloudflare:workers"));
  const env = (await workerEnv) ?? processEnv();
  return (env ?? {}) as SigningEnv;
}

/** `process.env`, where there's one: Node, and Workers with Node.js compatibility. */
function processEnv(): Record<string, unknown> | undefined {
  return (globalThis as { process?: { env?: Record<string, unknown> } }).process?.env;
}

/** A signer for `model`'s `feature` tokens; `InvalidModel` when its secrets are unset or short. */
export async function signerOf(model: SigningModel, feature: SigningFeature): Promise<Signer> {
  return signerFor(secretsOf(model, await envForSecrets()), feature);
}

function secretsOf(model: SigningModel, env: SigningEnv): string[] {
  const given = model.signingSecret(env);
  const listed: readonly unknown[] = Array.isArray(given) ? given : [given];
  const secrets = listed.filter((secret) => secret !== undefined && secret !== null);
  if (secrets.length === 0) {
    throw new InvalidModel(
      `${model.name} has no signing secret: set SECRET_KEY_BASE in the Worker's secrets ` +
        "(wrangler secret put SECRET_KEY_BASE), or override signingSecret",
    );
  }
  for (const secret of secrets) {
    if (typeof secret !== "string" || new TextEncoder().encode(secret).length < MINIMUM_BYTES) {
      throw new InvalidModel(
        `${model.name}'s signing secret must be a string of at least ${MINIMUM_BYTES} bytes, ` +
          "such as openssl rand -hex 32 makes",
      );
    }
  }
  return secrets as string[];
}
