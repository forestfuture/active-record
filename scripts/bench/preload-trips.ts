// Round trips and time for a nested includes() (#217): authors → posts → comments on D1.
// Not part of CI; run with `vp run bench:preload` before and after a change to preloading.
// Miniflare is local, so the time leaves out network latency; the round trips are what real
// D1 multiplies.
import { Miniflare } from "miniflare";
import { hasMany, Model, sql } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/d1-record/src/index.ts";

const AUTHORS = 200,
  POSTS = 10,
  COMMENTS = 5,
  RUNS = 30;

class Comment extends Model.define({
  id: { type: "string", null: false },
  postId: { type: "string", null: false },
  body: { type: "string", null: false },
}) {}
class Post extends Model.define({
  id: { type: "string", null: false },
  authorId: { type: "string", null: false },
  title: { type: "string", null: false },
}) {
  comments = hasMany(Comment);
}
class Author extends Model.define({
  id: { type: "string", null: false },
  name: { type: "string", null: false },
}) {
  posts = hasMany(Post);
}

const mf = new Miniflare({ modules: true, script: "export default {}", d1Databases: ["DB"] });
const binding = await mf.getD1Database("DB");
await binding.exec(
  "CREATE TABLE authors (id TEXT PRIMARY KEY, name TEXT NOT NULL); " +
    "CREATE TABLE posts (id TEXT PRIMARY KEY, author_id TEXT NOT NULL, title TEXT NOT NULL); " +
    "CREATE INDEX posts_author ON posts(author_id); " +
    "CREATE TABLE comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, body TEXT NOT NULL); " +
    "CREATE INDEX comments_post ON comments(post_id);",
);
const authors = Array.from({ length: AUTHORS }, (_, a) => [`a${a}`, `Author ${a}`]);
const posts = authors.flatMap(([a]) =>
  Array.from({ length: POSTS }, (_, p) => [`${a}p${p}`, a, `Post ${p}`]),
);
const comments = posts.flatMap(([p]) =>
  Array.from({ length: COMMENTS }, (_, c) => [`${p}c${c}`, p, `Comment ${c} `.repeat(4)]),
);
for (const [table, rows] of [
  ["authors", authors],
  ["posts", posts],
  ["comments", comments],
] as const) {
  const values = rows[0]!.map((_, i) => `value ->> '$[${i}]'`).join(", ");
  await binding
    .prepare(`INSERT INTO ${table} SELECT ${values} FROM json_each(?)`)
    .bind(JSON.stringify(rows))
    .run();
}

// One round trip per D1 call: each batch(), and each statement's all(), run(), first() or raw().
// A batch is given the statements themselves, which D1 reads, not the proxies counting them.
type Statement = ReturnType<typeof binding.prepare>;
let trips = 0;
const statements = new WeakMap<object, Statement>();
const counting = new Proxy(binding, {
  get(target, key) {
    if (key === "batch") {
      return (wrapped: object[]) => (
        trips++,
        target.batch(wrapped.map((statement) => statements.get(statement)!))
      );
    }
    if (key !== "prepare") return Reflect.get(target, key).bind(target);
    const wrap = (statement: Statement): object => {
      const proxy = new Proxy(statement, {
        get(inner, name) {
          const value: unknown = Reflect.get(inner, name);
          if (typeof value !== "function") return value;
          const bound = value.bind(inner);
          if (name === "bind") return (...args: unknown[]) => wrap(bound(...args));
          if (["all", "run", "first", "raw"].includes(String(name)))
            return (...args: unknown[]) => (trips++, bound(...args));
          return bound;
        },
      });
      statements.set(proxy, statement);
      return proxy;
    };
    return (text: string) => wrap(target.prepare(text));
  },
});

const db = connect(counting as never);
// 50 authors, so 500 posts and 2,500 comments.
const load = () =>
  db
    .model(Author)
    .where(sql`name >= ${"Author 1"}`)
    .order({ name: "asc" })
    .limit(50)
    .includes({ posts: "comments" })
    .toArray();

for (let warm = 0; warm < 3; warm++) await load();
trips = 0;
const started = performance.now();
let found = 0;
for (let index = 0; index < RUNS; index++) found = (await load()).length;
const ms = (performance.now() - started) / RUNS;
console.log(
  `includes({ posts: "comments" }): ${found} authors, ${trips / RUNS} round trips, ${ms.toFixed(1)} ms per load`,
);
await mf.dispose();
