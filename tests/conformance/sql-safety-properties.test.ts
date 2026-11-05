import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { Model, sql } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, providedAdapter, type Harness } from "../support/harness.ts";
import { SLOW_RUNS, SLOW_TIMEOUT } from "../support/properties.ts";
import { allows } from "./allowed-differences.ts";

class Sample extends Model.define({ id: { type: "integer", null: false }, label: "string" }) {
  static table = "samples";
  // These tests read bound values, so nothing is filtered (#83).
  static override filterAttributes = [];
}

// The characters SQL and its comments, quoting and patterns are made of, plus ones that are
// awkward in a string (a NUL, a newline, accented and astral letters). Lone surrogates aren't
// here: the database stores UTF-8, so what comes back isn't the lone half the app sent, and that's
// not something the library controls.
// A NUL only where the database stores one (nul-in-text).
const nul = allows(providedAdapter(), "nul-in-text") ? [] : ["\u0000"];
const sqlCharacters = fc.constantFrom(
  "'",
  '"',
  "`",
  ";",
  "-",
  "/",
  "*",
  "\\",
  "%",
  "_",
  "?",
  ":",
  "$",
  "(",
  ")",
  "=",
  " ",
  "\n",
  "\t",
  ...nul,
  "a",
  "Z",
  "0",
  "é",
  "😀",
);
const fragments = fc.constantFrom(
  "' OR 1 = 1 --",
  "'; DROP TABLE samples; --",
  '" OR ""="',
  "x' UNION SELECT 1, 'y",
  "%",
);
const texts = fc.oneof(
  fc.string({ unit: sqlCharacters, maxLength: 24 }),
  fc.tuple(fc.string({ unit: sqlCharacters, maxLength: 6 }), fragments).map((p) => p.join("")),
);

const runs = SLOW_RUNS;

/** Stored labels, and a needle that is one of them half the time, so a match is common. */
const scenarios = fc
  .record({
    labels: fc.array(texts, { maxLength: 5 }),
    pick: fc.nat(),
    other: texts,
    fromLabels: fc.boolean(),
  })
  .map(({ labels, pick, other, fromLabels }) => ({
    labels,
    needle: fromLabels && labels.length > 0 ? labels[pick % labels.length]! : other,
  }));

/** The ids a database holding `labels` (ids from 1) should give for an exact match. */
function matching(labels: string[], needle: string): number[] {
  return labels.flatMap((label, index) => (label === needle ? [index + 1] : []));
}

describe("a text value of any content, in a query", { timeout: SLOW_TIMEOUT }, () => {
  let harness: Harness;
  const queries: QueryEvent[] = [];
  const samples = () => harness.connect({ onQuery: (event) => queries.push(event) }).model(Sample);
  type Relation = ReturnType<typeof samples>;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  /** Replaces the table's rows with `labels`, runs `run`, and gives the ids and statements. */
  async function runAgainst(labels: string[], run: (relation: Relation) => Promise<Sample[]>) {
    await harness.exec("DELETE FROM samples");
    for (const [index, label] of labels.entries()) {
      await harness.exec("INSERT INTO samples (id, label) VALUES (?, ?)", [index + 1, label]);
    }
    queries.length = 0;
    const rows = await run(samples());
    return {
      ids: rows.map((row) => row.id).sort((a, b) => a - b),
      statements: queries.map((query) => query.sql),
    };
  }

  /** The INSERT statements run since `queries` was last cleared. */
  const inserts = () =>
    queries.map((query) => query.sql).filter((text) => text.startsWith("INSERT"));

  test("is bound: the statement is the same, and the rows are those an exact match gives", async () => {
    const { statements: plain } = await runAgainst(["x"], (s) => s.where({ label: "x" }).toArray());

    await fc.assert(
      fc.asyncProperty(scenarios, async ({ labels, needle }) => {
        const found = await runAgainst(labels, (s) => s.where({ label: needle }).toArray());

        expect(found.statements).toEqual(plain);
        expect(found.ids).toEqual(matching(labels, needle));
      }),
      runs,
    );
  });

  test("is bound when interpolated into an sql fragment", async () => {
    const { statements: plain } = await runAgainst(["x"], (s) =>
      s.where(sql`label = ${"x"}`).toArray(),
    );

    await fc.assert(
      fc.asyncProperty(scenarios, async ({ labels, needle }) => {
        const found = await runAgainst(labels, (s) => s.where(sql`label = ${needle}`).toArray());

        expect(found.statements).toEqual(plain);
        expect(found.ids).toEqual(matching(labels, needle));
      }),
      runs,
    );
  });

  test("is bound in a list of values: the statement is the same, and each exact match is found", async () => {
    const { statements: plain } = await runAgainst(["x", "y"], (s) =>
      s.where({ label: ["x", "y"] }).toArray(),
    );

    await fc.assert(
      fc.asyncProperty(scenarios, texts, async ({ labels, needle }, other) => {
        const found = await runAgainst(labels, (s) =>
          s.where({ label: [needle, other] }).toArray(),
        );
        const expected = [...new Set([...matching(labels, needle), ...matching(labels, other)])];

        expect(found.statements).toEqual(plain);
        expect(found.ids).toEqual(expected.sort((a, b) => a - b));
      }),
      runs,
    );
  });

  test("is stored and read back as it was", async () => {
    await fc.assert(
      fc.asyncProperty(texts, async (label) => {
        const created = await samples().create({ label });

        expect((await samples().find(created.id)).label).toBe(label);
      }),
      runs,
    );
  });

  test("is inserted with the statement a harmless value gives", async () => {
    queries.length = 0;
    await samples().create({ label: "x" });
    const plain = inserts();

    await fc.assert(
      fc.asyncProperty(texts, async (label) => {
        queries.length = 0;
        await samples().create({ label });

        expect(inserts()).toEqual(plain);
      }),
      runs,
    );
  });
});
