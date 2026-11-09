// A D1 test project's active-record.jsonc: every binding its Wrangler config declares, on the D1 adapter (#301).
import { dirname, join } from "node:path";

const wranglerNames = /(^|\/)wrangler\.(jsonc|json|toml)$/;

/** An `active-record.jsonc` naming these bindings as D1 databases. */
export function d1Config(...bindings: string[]): string {
  const databases = Object.fromEntries(bindings.map((binding) => [binding, { adapter: "d1" }]));
  return JSON.stringify({ databases }, null, 2);
}

/** The bindings a Wrangler config's text declares, in order: `"binding": "DB"` or `binding = "DB"`. */
function bindingsIn(text: string): string[] {
  return [...text.matchAll(/["']?binding["']?\s*[:=]\s*["']([^"']+)["']/g)].map((each) => each[1]!);
}

/**
 * A project's files with an `active-record.jsonc` beside each Wrangler config, naming its bindings
 * on D1, unless the files hold one there already.
 */
export function withD1Config(files: Record<string, string>): Record<string, string> {
  const added: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) {
    if (!wranglerNames.test(path)) continue;
    const config = join(dirname(path), "active-record.jsonc");
    if (config in files || config in added) continue;
    added[config] = d1Config(...bindingsIn(text));
  }
  return { ...files, ...added };
}
