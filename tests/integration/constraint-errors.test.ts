import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  CheckViolation,
  connect,
  ActiveRecordError,
  InvalidForeignKey,
  Model,
  NotNullViolation,
  RecordNotUnique,
} from "../../src/index.ts";
import { Post } from "../fixtures/models/post.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static table = "users";
}

class Product extends Model.define({
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
  priceCents: { type: "integer", null: false },
}) {
  static table = "products";
}

describe("constraint errors", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch([
      binding.prepare("DELETE FROM posts"),
      binding.prepare("DELETE FROM users"),
      binding.prepare("DELETE FROM products"),
      binding.prepare("INSERT INTO users (id, email) VALUES (1, 'taken@example.com')"),
    ]);
  });

  test("a UNIQUE violation throws RecordNotUnique naming the table, column and attribute", async () => {
    const user = connect(binding).model(User).build({ email: "taken@example.com" });

    const error = await user.save().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RecordNotUnique);
    expect(error).toBeInstanceOf(ActiveRecordError);
    expect(error).toMatchObject({ table: "users", columns: ["email"], attributes: ["email"] });
    expect((error as Error).cause).toBeInstanceOf(Error);
  });

  test("the record keeps its unsaved state after a constraint error", async () => {
    const users = connect(binding).model(User);
    const other = await users.create({ email: "other@example.com" });

    other.email = "taken@example.com";
    await expect(other.save()).rejects.toThrow(RecordNotUnique);
    await expect(users.create({ email: "taken@example.com" })).rejects.toThrow(RecordNotUnique);

    expect(other.isPersisted()).toBe(true);
    expect(other.changes()).toEqual({ email: ["other@example.com", "taken@example.com"] });
    // Still the changes from the last successful save (the create), not the failed one.
    expect(other.savedChanges()).toEqual({
      id: [null, other.id],
      email: [null, "other@example.com"],
    });
  });

  test("a FOREIGN KEY violation throws InvalidForeignKey", async () => {
    const post = connect(binding).model(Post).build({ userId: 999, title: "Orphan" });

    await expect(post.save()).rejects.toThrow(InvalidForeignKey);
    expect(post.isNewRecord()).toBe(true);
  });

  test("a NOT NULL violation throws NotNullViolation naming the attribute", async () => {
    const product = connect(binding)
      .model(Product)
      .build({ name: "Pen", priceCents: null as never });

    const error = await product.save().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotNullViolation);
    expect(error).toMatchObject({
      table: "products",
      columns: ["price_cents"],
      attributes: ["priceCents"],
    });
  });

  test("a CHECK violation throws CheckViolation, from both save and saveOrThrow", async () => {
    const products = connect(binding).model(Product);

    await expect(products.create({ name: "Pen", priceCents: -1 })).rejects.toThrow(CheckViolation);
    await expect(products.createOrThrow({ name: "Pen", priceCents: -1 })).rejects.toThrow(
      CheckViolation,
    );
  });

  test("constraint errors are translated on update too", async () => {
    const product = await connect(binding).model(Product).create({ name: "Pen", priceCents: 100 });

    product.priceCents = -5;
    await expect(product.save()).rejects.toThrow(CheckViolation);
    product.priceCents = null as never;
    await expect(product.save()).rejects.toThrow(NotNullViolation);
  });

  test("destroying a row that others reference throws InvalidForeignKey and keeps the record", async () => {
    const db = connect(binding);
    const user = await db.model(User).find(1);
    await db.model(Post).create({ userId: 1, title: "Hello" });

    await expect(user.destroy()).rejects.toThrow(InvalidForeignKey);

    expect(user.isDestroyed()).toBe(false);
    expect(await db.model(User).exists({ id: 1 })).toBe(true);
  });
});
