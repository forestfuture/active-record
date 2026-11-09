// A `pg` client the command opens itself, on a connection string: connected within 10 seconds, or why it couldn't be.
import pg from "pg";

export type Client = InstanceType<typeof pg.Client>;

/** A client on the connection string's database, connected, or the reason it couldn't be. */
export async function connected(connectionString: string): Promise<Client | string> {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
  // An error on an idle client is the next query's to report.
  client.on("error", () => {});
  try {
    await client.connect();
    return client;
  } catch (error) {
    return (error as Error).message;
  }
}
