// Sends statements to Postgres: each on a client of its own lease, reads in order, and writes in a transaction on a client of their own (ADR-0017).
import {
  type CompiledSql,
  type Driver,
  type StatementResult,
  boundValue,
} from "@forestfuture/active-record/adapter";
import type { Clients, ClientScope, Queryable } from "./clients.ts";
import { withoutRowValues } from "./errors.ts";
import { typeParsers } from "./type-parsers.ts";

/** What `onQuery` hears from Postgres about a statement: its command and the rows it counted. */
export interface PgMeta {
  /** `SELECT`, `INSERT`, `UPDATE`, `DELETE`, … */
  command: string;
  rowCount: number | null;
}

/** Sends `statement` on `client`, its values bound as the core stores them. */
async function sent(client: Queryable, { sql, params }: CompiledSql): Promise<StatementResult> {
  const { rows, rowCount, command } = await client
    .query({ text: sql, values: params.map(boundValue), types: typeParsers })
    .catch((error: unknown) => {
      throw withoutRowValues(error);
    });
  const meta: PgMeta = { command, rowCount };
  return { rows, rowsAffected: rowCount ?? 0, meta };
}

/** The single place the adapter calls Postgres. */
export class PgDriver implements Driver<ClientScope | undefined> {
  readonly #clients: Clients;

  constructor(clients: Clients) {
    this.#clients = clients;
  }

  async send(statement: CompiledSql, scope?: ClientScope): Promise<StatementResult> {
    return (await this.read([statement], scope))[0]!;
  }

  /** One after another on one client: Postgres has no batch, and reads needn't be atomic. */
  async read(statements: readonly CompiledSql[], scope?: ClientScope): Promise<StatementResult[]> {
    const lease = await this.#clients.borrow(scope);
    try {
      const results: StatementResult[] = [];
      for (const statement of statements) results.push(await sent(lease.client, statement));
      await lease.done();
      return results;
    } catch (error) {
      await lease.done(error);
      throw error;
    }
  }

  /**
   * In one transaction, on a client nothing else sends on: a write sent beside it on a shared
   * client would join the transaction, and be lost if it rolls back (ADR-0017).
   */
  async write(statements: readonly CompiledSql[]): Promise<StatementResult[]> {
    const lease = await this.#clients.own();
    const { client } = lease;
    try {
      await client.query({ text: "BEGIN" });
      const results: StatementResult[] = [];
      for (const statement of statements) results.push(await sent(client, statement));
      await client.query({ text: "COMMIT" });
      await lease.done();
      return results;
    } catch (error) {
      await rolledBack(client);
      await lease.done(error);
      throw error;
    }
  }

  openScope(): ClientScope | undefined {
    return this.#clients.openScope?.();
  }

  async closeScope(scope: ClientScope | undefined): Promise<void> {
    if (scope !== undefined) await this.#clients.closeScope?.(scope);
  }

  /** Postgres's errors are final: nothing is sent again. */
  recover(): boolean {
    return false;
  }
}

/** Rolls back an open transaction. A client too broken to is given back as broken anyway. */
async function rolledBack(client: Queryable): Promise<void> {
  await client.query({ text: "ROLLBACK" }).catch(() => {});
}
