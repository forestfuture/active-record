import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  Model,
  withDatabase,
} from "../../../packages/active-record/src/index.ts";
import { connect, d1 } from "../../../packages/active-record/src/adapters/d1/index.ts";
import {
  connect as connectPostgres,
  postgresql,
} from "../../../packages/active-record/src/adapters/postgresql/index.ts";
import { createTestDatabase, type TestDatabase } from "../../support/d1.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";

abstract class D1Record extends Model {
  static override schema = { adapter: d1({ binding: "DB" }), tables: {}, models: {} };
}

abstract class PgRecord extends Model {
  static override schema = {
    adapter: postgresql({ binding: "DATABASE_URL" }),
    tables: {},
    models: {},
  };
}

class Customer extends PgRecord.define({
  id: { type: "string", null: false, generateId: true },
  name: { type: "string", null: false },
}) {
  static override table = "customers";

  orders = hasMany(Order);
}

class Order extends D1Record.define({
  id: { type: "integer", null: false },
  customerId: "string",
  total: { type: "integer", null: false },
}) {
  static override table = "orders";

  customer = belongsTo(Customer);
}

const fixture = (name: string) => new URL(`../../fixtures/cross-database/${name}`, import.meta.url);
const ada = "8d0e8f8a-2d5b-4a8e-9a43-3b7c6c1f2e10";

let binding: TestDatabase;
let disposeD1: () => Promise<void>;
let schema: PgSchema;

beforeAll(async () => {
  ({ db: binding, dispose: disposeD1 } = await createTestDatabase(fixture("d1-orders.sql")));
  schema = await openPgSchema([fixture("pg-customers.sql")]);
});
afterAll(async () => {
  await disposeD1();
  await schema.dispose();
});
beforeEach(async () => {
  await binding.batch([
    binding.prepare("DELETE FROM orders"),
    binding.prepare("INSERT INTO orders (id, customer_id, total) VALUES (1, ?, 30)").bind(ada),
  ]);
  await schema.pool.query({ text: "DELETE FROM customers" });
  await schema.pool.query({
    text: "INSERT INTO customers (id, name) VALUES ($1, 'Ada')",
    values: [ada],
  });
});

/** `fn`, in a request with a D1 database and a Postgres one, outside a Worker. */
function inRequest<R>(fn: () => Promise<R>): Promise<R> {
  return withDatabase([connect(binding), connectPostgres(schema.url)], fn);
}

// An association between Models on databases of different adapters (#228). Each query is
// written in its own database's SQL.
describe("an association between a D1 Model and a Postgres one", () => {
  test("a D1 record reads its belongsTo from Postgres", async () => {
    const name = await inRequest(async () => (await (await Order.find(1)).customer())?.name);

    expect(name).toBe("Ada");
  });

  test("a Postgres record reads its hasMany from D1", async () => {
    const totals = await inRequest(async () => (await Customer.find(ada)).orders().pluck("total"));

    expect(totals).toEqual([30]);
  });

  test("D1 records preload their belongsTo from Postgres", async () => {
    const [order] = await inRequest(() => Order.includes("customer").toArray());

    expect(order!.loaded("customer")?.name).toBe("Ada");
  });

  test("Postgres records preload their hasMany from D1", async () => {
    const customer = await inRequest(() => Customer.includes("orders").find(ada));

    expect(customer.loaded("orders").map((order) => order.total)).toEqual([30]);
  });

  test("creating through a hasMany writes the record to D1", async () => {
    await inRequest(async () => (await Customer.find(ada)).orders().create({ id: 2, total: 12 }));

    const { results } = await binding.prepare("SELECT customer_id FROM orders WHERE id = 2").all();
    expect(results).toEqual([{ customer_id: ada }]);
  });

  test("a new Postgres record a D1 record points at is written to Postgres first", async () => {
    const id = await inRequest(async () => {
      const order = Order.build({ id: 2, total: 12 });
      const customer = order.customer.build({ name: "Grace" });
      await order.saveOrThrow();
      return customer.id;
    });

    const { rows } = await schema.pool.query({
      text: "SELECT name FROM customers WHERE id = $1",
      values: [id],
    });
    expect(rows).toEqual([{ name: "Grace" }]);
    const { results } = await binding.prepare("SELECT customer_id FROM orders WHERE id = 2").all();
    expect(results).toEqual([{ customer_id: id }]);
  });
});
