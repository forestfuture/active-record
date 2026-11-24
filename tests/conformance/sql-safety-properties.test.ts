import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { Model, sql } from "../../packages/arbor/src/index.ts";
import type { QueryEvent } from "../../packages/arbor/src/executor.ts";
import { openHarness, providedAdapter, type Harness } from "../support/harness.ts";
import { SLOW_RUNS, SLOW_TIMEOUT } from "../support/properties.ts";
import { isAllowed } from "./allowed-differences.ts";

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
const nul = isAllowed(providedAdapter(), "nul-in-text") ? [] : ["\u0000"];
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

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  /**
   * One test's own connection to the samples table, and the statements its model ran. A property
   * that times out keeps running after its test ends (#454). Its own `queries` keep its statements
   * out of the next test's, and once the test's `signal` is aborted it stops before its next
   * statement, so at most the one statement already running reaches the table after the next test
   * starts. Rows are seeded through the harness, so only the model's statements are recorded.
   */
  function testConnection(signal: AbortSignal) {
    const queries: QueryEvent[] = [];
    const samples = harness.connect({ onQuery: (event) => queries.push(event) }).model(Sample);
    const stopIfEnded = () => signal.throwIfAborted();
    const current = () => {
      stopIfEnded();
      return samples;
    };
    const clear = () => {
      queries.length = 0;
    };
    const exec = (text: string, params?: unknown[]) => {
      stopIfEnded();
      return harness.exec(text, params);
    };

    return {
      /** The model on this test's connection, while the test is still running. */
      samples: current,
      /** Forgets the statements run so far. */
      clear,
      /** The model's INSERT statements since the last `clear` or `runAgainst`, or since it opened. */
      inserts: () => queries.map((query) => query.sql).filter((text) => text.startsWith("INSERT")),
      /** Replaces the table's rows with `labels`, runs `run`, and gives the ids and statements. */
      async runAgainst(labels: string[], run: (relation: typeof samples) => Promise<Sample[]>) {
        await exec("DELETE FROM samples");
        for (const [index, label] of labels.entries()) {
          await exec("INSERT INTO samples (id, label) VALUES (?, ?)", [index + 1, label]);
        }
        clear();
        const rows = await run(current());
        return {
          ids: rows.map((row) => row.id).sort((a, b) => a - b),
          statements: queries.map((query) => query.sql),
        };
      },
    };
  }

  test("is bound: the statement is the same, and the rows are those an exact match gives", async ({
    signal,
  }) => {
    const connection = testConnection(signal);
    const { statements: plain } = await connection.runAgainst(["x"], (s) =>
      s.where({ label: "x" }).toArray(),
    );

    await fc.assert(
      fc.asyncProperty(scenarios, async ({ labels, needle }) => {
        const found = await connection.runAgainst(labels, (s) =>
          s.where({ label: needle }).toArray(),
        );

        expect(found.statements).toEqual(plain);
        expect(found.ids).toEqual(matching(labels, needle));
      }),
      runs,
    );
  });

  test("is bound when interpolated into an sql fragment", async ({ signal }) => {
    const connection = testConnection(signal);
    const { statements: plain } = await connection.runAgainst(["x"], (s) =>
      s.where(sql`label = ${"x"}`).toArray(),
    );

    await fc.assert(
      fc.asyncProperty(scenarios, async ({ labels, needle }) => {
        const found = await connection.runAgainst(labels, (s) =>
          s.where(sql`label = ${needle}`).toArray(),
        );

        expect(found.statements).toEqual(plain);
        expect(found.ids).toEqual(matching(labels, needle));
      }),
      runs,
    );
  });

  test("is bound in a list of values: the statement is the same, and each exact match is found", async ({
    signal,
  }) => {
    const connection = testConnection(signal);
    const { statements: plain } = await connection.runAgainst(["x", "y"], (s) =>
      s.where({ label: ["x", "y"] }).toArray(),
    );

    await fc.assert(
      fc.asyncProperty(scenarios, texts, async ({ labels, needle }, other) => {
        const found = await connection.runAgainst(labels, (s) =>
          s.where({ label: [needle, other] }).toArray(),
        );
        const expected = [...new Set([...matching(labels, needle), ...matching(labels, other)])];

        expect(found.statements).toEqual(plain);
        expect(found.ids).toEqual(expected.sort((a, b) => a - b));
      }),
      runs,
    );
  });

  test("is stored and read back as it was", async ({ signal }) => {
    const connection = testConnection(signal);
    await fc.assert(
      fc.asyncProperty(texts, async (label) => {
        const created = await connection.samples().create({ label });

        expect((await connection.samples().find(created.id)).label).toBe(label);
      }),
      runs,
    );
  });

  test("is inserted with the statement a harmless value gives", async ({ signal }) => {
    const connection = testConnection(signal);
    await connection.samples().create({ label: "x" });
    const plain = connection.inserts();

    await fc.assert(
      fc.asyncProperty(texts, async (label) => {
        connection.clear();
        await connection.samples().create({ label });

        // oxlint-disable-next-line arbor/no-sql-text -- a value is bound, so it never changes the statement
        expect(connection.inserts()).toEqual(plain);
      }),
      runs,
    );
  });
});
