import { describe, expectTypeOf, test } from "vite-plus/test";
import type { CacheOptions, QueryEvent } from "../../packages/arbor/src/index.ts";
import type {
  ConnectOptions as D1ConnectOptions,
  QueryEvent as D1QueryEvent,
} from "../../packages/arbor/src/adapters/d1/index.ts";
import type {
  ConnectOptions as PgConnectOptions,
  QueryEvent as PgQueryEvent,
} from "../../packages/arbor/src/adapters/postgresql/index.ts";

// A guard: only the types are tested (#218).
describe("the request cache's types (#218)", () => {
  test("both adapters' connect take cache: { request?: boolean }", () => {
    expectTypeOf<D1ConnectOptions["cache"]>().toEqualTypeOf<CacheOptions | undefined>();
    expectTypeOf<PgConnectOptions["cache"]>().toEqualTypeOf<CacheOptions | undefined>();
    expectTypeOf<CacheOptions>().toEqualTypeOf<{ request?: boolean }>();
  });

  test("a query event's cached is true or missing", () => {
    expectTypeOf<QueryEvent["cached"]>().toEqualTypeOf<true | undefined>();
    expectTypeOf<D1QueryEvent["cached"]>().toEqualTypeOf<true | undefined>();
    expectTypeOf<PgQueryEvent["cached"]>().toEqualTypeOf<true | undefined>();
  });
});
