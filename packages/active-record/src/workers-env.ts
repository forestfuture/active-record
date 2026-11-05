// The Worker's bindings, from `cloudflare:workers`, for an adapter to find a Model's database: loaded when a query first needs them, and none outside a Worker.
/** A Worker's `env`: its bindings and variables, by name. */
export type WorkersEnv = Record<string, unknown>;

let env: Promise<WorkersEnv | undefined> | undefined;

/** Whether importing `cloudflare:workers` failed because this isn't a Worker (Node, scripts). */
function notAWorker(error: unknown): boolean {
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    code === "ERR_UNSUPPORTED_ESM_URL_SCHEME" ||
    code === "ERR_MODULE_NOT_FOUND" ||
    /cloudflare:workers/.test(String(message))
  );
}

/**
 * The Worker's `env`, read once and kept, or undefined outside a Worker (Node, scripts). A test
 * that mocks `cloudflare:workers` assigns its bindings onto the mocked `env`, not a new one.
 */
export function workersEnv(): Promise<WorkersEnv | undefined> {
  // A literal specifier: Wrangler and Miniflare (wrangler dev) only allow those. Outside a Worker
  // the module doesn't exist, which is the one failure that means "not in a Worker".
  env ??= import("cloudflare:workers").then(
    (workers) => workers.env as unknown as WorkersEnv,
    (error: unknown) => {
      if (notAWorker(error)) return undefined;
      throw error;
    },
  );
  return env;
}
