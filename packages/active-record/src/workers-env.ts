// The Worker's bindings, for an adapter to find a Model's database: read from the `cloudflare:workers` module the adapter imports itself, and none outside a Worker.
/** A Worker's `env`: its bindings and variables, by name. */
export type WorkersEnv = Record<string, unknown>;

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
 * The Worker's `env`, from `load`, or undefined outside a Worker (Node, scripts). An adapter
 * passes `() => import("cloudflare:workers")` from its own module, with that literal specifier:
 * Wrangler only bundles those, and a test that mocks the module with the adapter inlined reaches it.
 */
export async function workersEnv(
  load: () => Promise<{ env: unknown }>,
): Promise<WorkersEnv | undefined> {
  try {
    return (await load()).env as WorkersEnv;
  } catch (error) {
    if (notAWorker(error)) return undefined;
    throw error;
  }
}
