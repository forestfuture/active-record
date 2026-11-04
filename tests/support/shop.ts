// A project for the console's tests: a users table in its local D1, a User Model, and a Wrangler
// config. Inside the repo, it finds this repo's wrangler, and its tsconfig finds the library's
// source, as an app's finds its own copies.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { openLocalBinding } from "../../cli/console/binding.ts";
import type { ChosenDatabase } from "../../cli/console/database.ts";
import type { TestDatabase } from "./d1.ts";

const library = new URL("../../src/index.ts", import.meta.url).pathname;

/** The project's one D1 binding, as the console would choose it. */
export function chosen(cwd: string): ChosenDatabase {
  const entry = { binding: "DB", database_name: "shop", database_id: "local-shop" };
  return { binding: "DB", entry, configFile: join(cwd, "wrangler.jsonc") };
}

/** A project, in the folder `scratch` makes, with its local database seeded: Alice, id 1. */
export async function shop(scratch: (prefix: string) => string): Promise<string> {
  const cwd = scratch("console-command-");
  const files: Record<string, string> = {
    "wrangler.jsonc": JSON.stringify({
      d1_databases: [{ binding: "DB", database_name: "shop", database_id: "local-shop" }],
    }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { paths: { "@forestfuture/d1-record": [library] } },
    }),
    "src/models/application-record.ts": `
      import { d1, Model } from "@forestfuture/d1-record";
      export abstract class ApplicationRecord extends Model {
        static override schema = {
          adapter: d1({ binding: "DB" }),
          tables: {
            users: { attributes: { id: "integer", name: "string", email: "string" }, primaryKey: "id" },
          },
          models: { User: "users" },
        };
      }
    `,
    "src/models/user.ts": `
      import { ApplicationRecord } from "./application-record";
      export class User extends ApplicationRecord {}
    `,
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  const opened = await openLocalBinding(cwd, chosen(cwd));
  if (typeof opened === "string") throw new Error(opened);
  const db = opened.binding as TestDatabase;
  await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)");
  await db.exec("INSERT INTO users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')");
  await opened.dispose();
  return cwd;
}

/**
 * A project whose own `wrangler` is the repo's, except that every `getPlatformProxy` is logged
 * and answered from the project's local database: a stand-in for Cloudflare, so a "remote"
 * session can be driven without an account. Returns the folder and what wrangler was asked.
 */
export async function remoteProject(
  scratch: (prefix: string) => string,
  entry?: Record<string, unknown>,
) {
  const cwd = await shop(scratch);
  if (entry !== undefined)
    writeFileSync(join(cwd, "wrangler.jsonc"), JSON.stringify({ d1_databases: [entry] }));
  const real = import.meta.resolve("wrangler");
  const log = join(cwd, "wrangler-calls.jsonl");
  mkdirSync(join(cwd, "node_modules/wrangler"), { recursive: true });
  writeFileSync(
    join(cwd, "node_modules/wrangler/package.json"),
    '{ "name": "wrangler", "type": "module", "exports": "./index.js" }',
  );
  writeFileSync(
    join(cwd, "node_modules/wrangler/index.js"),
    `import { appendFileSync, existsSync } from "node:fs";
     import { getPlatformProxy as real } from ${JSON.stringify(real)};
     export async function getPlatformProxy(options) {
       const { remoteBindings, persist } = options;
       appendFileSync(${JSON.stringify(log)}, JSON.stringify({ remoteBindings, persist }) + "\\n");
       const proxy = await real({
         ...options,
         remoteBindings: false,
         persist: { path: ${JSON.stringify(join(cwd, ".wrangler/state/v3"))} },
       });
       return {
         ...proxy,
         dispose: async () => {
           await proxy.dispose();
           if (existsSync(${JSON.stringify(join(cwd, "wont-stop"))})) throw new Error("proxy would not stop");
         },
       };
     }`,
  );
  const asked = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as object)
      : [];
  return { cwd, asked };
}
