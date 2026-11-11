import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";
import { attempt, Sample, sampleAttributes } from "../support/attribute-samples.ts";
import { preparedWrites } from "../../packages/active-record/src/prepared-writes.ts";
import { statementParts } from "../../packages/active-record/src/statement.ts";
import { PURE_RUNS } from "../support/properties.ts";
import { values } from "../support/values.ts";

// An attribute's conversions (#148) are the ones a record uses: for a value of any shape, `cast`,
// `serialize` and assigning it accept the same values and refuse the same ones, `serialize` is
// what an insert binds, and `deserialize` reads it back as `cast` gave it.
// No D1 needed: `toInsert` compiles the statement and never runs it.
const samples = connect({} as never).model(Sample);

const attributes = sampleAttributes;

describe("an attribute's conversions, for a value of any shape", () => {
  test("cast and serialize refuse the same values, with the same TypeError", () => {
    fc.assert(
      fc.property(fc.constantFrom(...attributes), values, (attribute, value) => {
        const type = Sample.typeForAttribute(attribute);
        const cast = attempt(() => type.cast(value));
        const serialized = attempt(() => type.serialize(value));

        expect(serialized.ok).toBe(cast.ok);
        if (!cast.ok && !serialized.ok) {
          expect(cast.error).toBeInstanceOf(TypeError);
          expect((serialized.error as TypeError).message).toBe((cast.error as TypeError).message);
        }
      }),
      PURE_RUNS,
    );
  });

  test("serialize is what an insert binds, and an insert refuses what serialize does", () => {
    fc.assert(
      fc.property(fc.constantFrom(...attributes), values, (attribute, value) => {
        const serialized = attempt(() => Sample.typeForAttribute(attribute).serialize(value));
        const inserted = attempt(
          () =>
            samples[preparedWrites].insert({ [attribute]: value } as never)[statementParts].query
              .params,
        );

        expect(inserted.ok).toBe(serialized.ok);
        if (inserted.ok && serialized.ok) {
          // The row is bound as one JSON value, [[the stored value]], so -0 is 0 there.
          const stored = (JSON.parse(inserted.value[0] as string) as unknown[][])[0]?.[0];
          expect(stored).toEqual(JSON.parse(JSON.stringify(serialized.value)));
        }
      }),
      PURE_RUNS,
    );
  });

  test("deserialize reads a serialized value back as cast gave it, to the stored unit", () => {
    fc.assert(
      fc.property(fc.constantFrom(...attributes), values, (attribute, value) => {
        const type = Sample.typeForAttribute(attribute);
        const cast = attempt(() => type.cast(value));
        if (!cast.ok) return;

        const back = type.deserialize(type.serialize(value));

        if (attribute === "seconds" && cast.value instanceof Date) {
          expect((back as Date).getTime()).toBe(Math.floor(cast.value.getTime() / 1000) * 1000);
        } else if (attribute === "settings") {
          expect(back).toEqual(JSON.parse(JSON.stringify(cast.value)));
        } else {
          expect(back).toEqual(cast.value);
        }
      }),
      PURE_RUNS,
    );
  });
});
