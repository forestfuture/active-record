// The part of `pg` this adapter and its tests call, typed here: `@types/pg` would bring Node's types into code that runs on Workers.
declare module "pg" {
  /** Reads a column's text, by its type's OID, as a JavaScript value. */
  interface TypeParsers {
    getTypeParser(oid: number, format?: string): (text: string) => unknown;
  }

  interface QueryConfig {
    text: string;
    values?: unknown[];
    types?: TypeParsers;
  }

  interface QueryResult {
    rows: Record<string, unknown>[];
    rowCount: number | null;
    command: string;
  }

  class Client {
    constructor(config: { connectionString: string });
    connect(): Promise<void>;
    query(config: QueryConfig): Promise<QueryResult>;
    end(): Promise<void>;
    on(event: "error", listener: (error: Error) => void): this;
    once(event: "end", listener: () => void): this;
  }

  interface PoolClient {
    query(config: QueryConfig): Promise<QueryResult>;
    release(error?: Error | boolean): void;
  }

  /** For tests: the adapter takes the app's Pool, typed by its own `Pool`. */
  class Pool {
    constructor(config: { connectionString: string; options?: string; max?: number });
    connect(): Promise<PoolClient>;
    query(config: QueryConfig): Promise<QueryResult>;
    end(): Promise<void>;
    on(event: "error", listener: (error: Error) => void): this;
  }

  const pg: { Client: typeof Client; Pool: typeof Pool; types: TypeParsers };
  export default pg;
}
