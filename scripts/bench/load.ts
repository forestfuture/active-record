// CPU per stage of loading records, from a real D1 through Miniflare: D1's own query, the
// executor, hydrating, and toArray() as a whole. Not part of CI; run with `vp run bench:load`
// before and after a change to how records are loaded. Prints the mean CPU (process.cpuUsage,
// user + system) of several runs after a warm-up, so Miniflare's waiting doesn't count, though
// its transport's CPU does.
import { Miniflare } from "miniflare";
import { connect } from "../../packages/d1-record/src/index.ts";
import { databaseExecutor } from "../../packages/active-record/src/database.ts";
import { hydrate } from "../../packages/active-record/src/model.ts";
import { Author, schema } from "./models.ts";

const ROWS = 10_000;
const RUNS = 20;

async function measure(label: string, run: () => unknown): Promise<number> {
  for (let warm = 0; warm < 5; warm++) await run();
  let total = 0;
  for (let index = 0; index < RUNS; index++) {
    const started = process.cpuUsage();
    await run();
    const used = process.cpuUsage(started);
    total += (used.user + used.system) / 1000;
  }
  const ms = total / RUNS;
  console.log(
    `${label.padEnd(36)} ${ms.toFixed(1).padStart(6)} ms  ${((ms / ROWS) * 1000).toFixed(2)} µs/row`,
  );
  return ms;
}

const mf = new Miniflare({ modules: true, script: "export default {}", d1Databases: ["DB"] });
const binding = await mf.getD1Database("DB");
await binding.exec(schema.replaceAll("\n", " "));
for (let start = 0; start < ROWS; start += 500) {
  const statements = Array.from({ length: 500 }, (_, offset) =>
    binding
      .prepare("INSERT INTO authors (id, name, created_at) VALUES (?, ?, ?)")
      .bind(`author-${start + offset}`, `Author ${start + offset}`, "2026-01-01T00:00:00.000Z"),
  );
  await binding.batch(statements);
}

const db = connect(binding as never);
const executor = db[databaseExecutor];
const { sql, params } = db.model(Author).toSql();
const select = { sql, params: [...params], model: Author };
const rows = await executor.all(select);

await measure("binding.prepare(SELECT *).all()", () =>
  binding.prepare("SELECT * FROM authors").all(),
);
await measure("executor.all(selectFor(Author))", () => executor.all(select));
await measure("hydrate() each row", () => {
  for (const row of rows) hydrate(Author, row, executor);
});
await measure("db.model(Author).toArray()", () => db.model(Author).toArray());
await mf.dispose();
