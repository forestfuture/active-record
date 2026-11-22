import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  ActiveRecordError,
  Model,
  StaleRecord,
  type StaleAction,
} from "../../packages/active-record/src/index.ts";

class Notebook extends Model.define({ id: "integer", lockVersion: "integer" }) {}

describe("StaleRecord", () => {
  // A guard: the error's shape, which the conformance suite throws.
  test("is an ActiveRecordError naming the record's Model and what was attempted", () => {
    const record = new Notebook();
    const error = new StaleRecord(record, "destroy");

    expect(error).toBeInstanceOf(ActiveRecordError);
    expect(error.name).toBe("StaleRecord");
    expect(error.message).toBe("Attempted to destroy a stale Notebook record");
    expect(error.record).toBe(record);
    expectTypeOf(error.action).toEqualTypeOf<StaleAction>();
    expectTypeOf<StaleAction>().toEqualTypeOf<"update" | "destroy" | "touch">();
  });
});
