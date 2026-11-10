// Where the project's own Wrangler is: beside the database's Wrangler config first, where a monorepo's Worker has it, then from the folder the command runs in (#306).
import { dirname } from "node:path";
import { createJiti } from "jiti";

/**
 * `specifier` (`wrangler`, or a file of its package) as it resolves from the folder of the
 * database's Wrangler config, or else from `cwd`; undefined when it resolves from neither.
 */
export function resolveWrangler(
  cwd: string,
  configFile: string,
  specifier: string,
): string | undefined {
  for (const from of [dirname(configFile), cwd]) {
    try {
      return createJiti(`${from}/`).esmResolve(specifier);
    } catch {
      continue;
    }
  }
  return undefined;
}
