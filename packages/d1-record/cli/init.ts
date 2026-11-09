// What `active-record init` writes on D1: each D1 database the Wrangler config beside the file declares (#301).
import { basename } from "node:path";
import type { InitResult } from "@forestfuture/active-record/cli";
import { d1Entries, wranglerConfigIn } from "./wrangler.ts";

/**
 * The D1 databases in the Wrangler config in `dir`, each as an entry with nothing but its
 * adapter: Wrangler's config keeps the rest. Undefined when there are none, unless D1 was chosen.
 */
export function init(dir: string, chosen: boolean): InitResult {
  const file = wranglerConfigIn(dir);
  if (file === undefined) {
    if (!chosen) return undefined;
    return "No wrangler.jsonc, wrangler.json or wrangler.toml here: declare your D1 database in one first";
  }
  const entries = d1Entries(file);
  if (typeof entries === "string") return entries;
  if (entries.length === 0) {
    return chosen
      ? `${basename(file)} has no d1_databases: declare your database there first`
      : undefined;
  }
  return { databases: Object.fromEntries(entries.map((entry) => [String(entry.binding), {}])) };
}
