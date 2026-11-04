// Rows D1 reads for exists(), count() and paginate()'s count on an ordered Relation (#215).
// Run with `vp run bench:ordered-reads` before and after a change to how they're compiled.
import { Miniflare } from "miniflare";
import { Model } from "../../packages/active-record/src/index.ts";
import { connect, type QueryEvent } from "../../packages/d1-record/src/index.ts";

class Post extends Model.define({
  id: { type: "string", null: false },
  authorId: { type: "string", null: false },
  title: { type: "string", null: false },
}) {}

const mf = new Miniflare({ modules: true, script: "export default {}", d1Databases: ["DB"] });
const binding = await mf.getD1Database("DB");
await binding.exec(
  "CREATE TABLE posts (id TEXT PRIMARY KEY, author_id TEXT NOT NULL, title TEXT NOT NULL); " +
    "CREATE INDEX posts_author ON posts(author_id);",
);
// 20,000 posts, 100 for each of 200 authors.
const rows = Array.from({ length: 20_000 }, (_, i) => [`p${i}`, `a${i % 200}`, `Title ${i}`]);
await binding
  .prepare(
    "INSERT INTO posts SELECT value ->> '$[0]', value ->> '$[1]', value ->> '$[2]' FROM json_each(?)",
  )
  .bind(JSON.stringify(rows))
  .run();

const events: QueryEvent[] = [];
const db = connect(binding as never, { onQuery: (event) => events.push(event) });
const ordered = () => db.model(Post).where({ authorId: "a7" }).order({ title: "asc" });

async function report(label: string, run: () => Promise<unknown>) {
  events.length = 0;
  const result = await run();
  const read = events.reduce((sum, event) => sum + (event.meta?.rows_read ?? 0), 0);
  const sql = events.map((event) => event.sql).join(" ; ");
  console.log(
    `${label.padEnd(26)} rows_read ${String(read).padStart(4)}  ${JSON.stringify(result)}\n  ${sql}`,
  );
}

await report("exists()", () => ordered().exists());
await report("isEmpty()", () => ordered().isEmpty());
await report("count()", () => ordered().count());
await report("count('title')", () => ordered().count("title"));
// The page's own SELECT is in the same batch; it needs its order.
await report(
  "paginate({ perPage: 10 })",
  async () => (await ordered().paginate({ perPage: 10 })).total,
);
await mf.dispose();
