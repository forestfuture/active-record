import { describe, expect, test } from "vite-plus/test";
import { transactionControl } from "../../packages/active-record/cli/adapters/postgresql/transaction-control.ts";

// migrate runs each migration in a transaction of its own, which a migration mustn't end (#285).
describe("a migration's own transaction control", () => {
  test("is the statement that would end or start the command's transaction", () => {
    expect(transactionControl("BEGIN;\nCREATE TABLE a (id BIGINT);\nCOMMIT;")).toBe("BEGIN");
    expect(transactionControl("CREATE TABLE a (id BIGINT);\ncommit")).toBe("COMMIT");
    expect(transactionControl("start transaction; select 1")).toBe("START TRANSACTION");
    expect(transactionControl("SELECT 1; END;")).toBe("END");
    expect(transactionControl("SELECT 1;\n  ROLLBACK ;")).toBe("ROLLBACK");
    expect(transactionControl("ABORT")).toBe("ABORT");
  });

  test("leaves out savepoints, which nest inside it", () => {
    expect(
      transactionControl("SAVEPOINT a; SELECT 1; ROLLBACK TO SAVEPOINT a; RELEASE a;"),
    ).toBeUndefined();
  });

  test("isn't a word in a function's body, a string, a quoted name, or a comment", () => {
    const sql = `
      CREATE FUNCTION touch() RETURNS trigger AS $$ BEGIN NEW.at = now(); RETURN NEW; END $$ LANGUAGE plpgsql;
      DO $body$ BEGIN PERFORM 1; END $body$;
      INSERT INTO notes (text) VALUES ('; COMMIT;'), (E'it\\'s; COMMIT');
      CREATE TABLE "commit" (id BIGINT);
      -- COMMIT;
      /* ; COMMIT; */
      SELECT 1;`;

    expect(transactionControl(sql)).toBeUndefined();
  });
});
