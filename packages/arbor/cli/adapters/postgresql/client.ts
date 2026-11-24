// A `pg` client the command opens itself, on a connection string: connected within 10 seconds, or why it couldn't be.
import type pg from "pg";
import { pgDriver } from "./drivers.ts";

export type Client = InstanceType<typeof pg.Client>;

/** A client on the connection string's database, connected, or the reason it couldn't be. */
export async function connected(connectionString: string): Promise<Client | string> {
  const pg = pgDriver();
  if (typeof pg === "string") return pg;
  try {
    // pg parses the string here, and throws for one it can't read.
    const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
    // An error on an idle client is the next query's to report.
    client.on("error", () => {});
    await client.connect();
    return client;
  } catch (error) {
    return (error as Error).message;
  }
}
