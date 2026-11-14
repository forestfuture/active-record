import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { Post } from "../fixtures/models/post.ts";
import { openHarness, providedAdapter, type Harness } from "../support/harness.ts";
import { SLOW_RUNS, SLOW_TIMEOUT } from "../support/properties.ts";
import { isAllowed } from "./allowed-differences.ts";

/** Repeated titles and published flags, so distinct() changes how many rows there are. */
const POSTS = [
  [1, "A", 1],
  [2, "B", 0],
  [3, "B", 0],
  [4, "C", 1],
  [5, "A", 0],
  [6, "B", 1],
  [7, "C", 1],
  [8, "A", 0],
] as const;

const selections = [undefined, ["title"], ["published"], ["title", "published"]] as const;
const conditions = [undefined, { published: true }, { title: "B" }, { title: ["A", "C"] }] as const;
const orders = [undefined, { title: "asc" }, { id: "desc" }] as const;

// exists() is a cheaper toArray().length > 0: whatever the Relation, its order included, they
// agree (#222).
describe("exists(), for any Relation", { timeout: SLOW_TIMEOUT }, () => {
  let harness: Harness;
  const posts = () => harness.connect().model(Post);

  beforeAll(async () => {
    harness = await openHarness();
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    for (const [id, title, published] of POSTS) {
      await harness.exec("INSERT INTO posts (id, user_id, title, published) VALUES (?, 1, ?, ?)", [
        id,
        title,
        published,
      ]);
    }
  });
  afterAll(() => harness.dispose());

  const relations = fc
    .record({
      select: fc.constantFrom(...selections),
      distinct: fc.boolean(),
      where: fc.constantFrom(...conditions),
      order: fc.constantFrom(...orders),
      limit: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
      offset: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
    })
    .filter((relation) => isOrderable(relation));

  /** Whether the database orders it: Postgres won't order distinct rows by an unselected column. */
  function isOrderable({
    select,
    distinct,
    order,
  }: {
    select?: readonly string[];
    distinct: boolean;
    order?: object;
  }) {
    if (!distinct || select === undefined || order === undefined) return true;
    if (!isAllowed(providedAdapter(), "distinct-order")) return true;
    return Object.keys(order).every((key) => select.includes(key));
  }

  test("is whether toArray() returns any record", async () => {
    await fc.assert(
      fc.asyncProperty(relations, async ({ select, distinct, where, order, limit, offset }) => {
        let relation = posts();
        if (select !== undefined) relation = relation.select(...select);
        if (distinct) relation = relation.distinct();
        if (where !== undefined) relation = relation.where(where);
        if (order !== undefined) relation = relation.order(order);
        if (limit !== undefined) relation = relation.limit(limit);
        if (offset !== undefined) relation = relation.offset(offset);

        expect(await relation.exists()).toBe((await relation.toArray()).length > 0);
      }),
      SLOW_RUNS,
    );
  });
});
