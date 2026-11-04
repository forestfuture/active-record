// `paginate()`: one page of a Relation's records, and its total, in one round trip (#100).
import { castValue, uncastable } from "./conversion.ts";
import { IncompatibleRelation } from "./errors.ts";
import { stableOrder } from "./finder-order.ts";
import type { QueryRunner } from "./load.ts";
import type { Model, ModelClass, QueryableClass } from "./model.ts";
import type { QueryDescription } from "./query.ts";

/** What `paginate()` takes: which page, how many records on it, and whether to count them all. */
export interface PageOptions {
  /** The page, from 1: a number, or untrusted text such as a query string's `"2"`. */
  page?: number | string | null;
  /** Records on a page, a number or text as `page` is. */
  perPage?: number | string | null;
  /** `false` skips the `COUNT`: the page has no `total` or `totalPages`. */
  count?: boolean;
}

/** A page of records, from `paginate({ count: false })`: where it is, but no total. */
export interface CountlessPage<M extends Model> {
  records: M[];
  page: number;
  perPage: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

/** A page of records, from `paginate()`, with the total it's a page of. */
export interface Page<M extends Model> extends CountlessPage<M> {
  total: number;
  totalPages: number;
}

/** `paginate` as a static of every Model, typed for the class it's called on. */
export interface PaginateStatic {
  <C extends QueryableClass>(
    this: C,
    options: PageOptions & { count: false },
  ): Promise<CountlessPage<InstanceType<C>>>;
  <C extends QueryableClass>(
    this: C,
    options?: PageOptions & { count?: true },
  ): Promise<Page<InstanceType<C>>>;
  <C extends QueryableClass>(
    this: C,
    options: PageOptions,
  ): Promise<Page<InstanceType<C>> | CountlessPage<InstanceType<C>>>;
}

/** A Relation's query and how it runs: what `paginate` pages. */
export interface Paged<M extends Model> {
  model: ModelClass<M>;
  query: QueryDescription;
  runner: QueryRunner<M>;
}

/**
 * One page of `paged`'s records. Counted, the `COUNT` and the page's SELECT go as one batch;
 * with `count: false`, one SELECT fetches a record past the page to learn whether there's a next.
 */
export async function paginate<M extends Model>(
  { model, query, runner }: Paged<M>,
  options: PageOptions,
): Promise<Page<M> | CountlessPage<M>> {
  if (query.limit !== undefined || query.offset !== undefined) {
    throw new IncompatibleRelation(
      "paginate() pages with its own limit and offset; remove the Relation's limit() and offset()",
    );
  }
  const page = pageNumber("page", options.page) ?? 1;
  const perPage = Math.min(
    pageNumber("perPage", options.perPage) ?? model.perPage,
    model.maxPerPage,
  );
  const onPage = {
    ...query,
    order: stableOrder(model, query),
    limit: perPage,
    offset: offsetOf(page, perPage),
  };
  const hasPrevious = page > 1;
  if (options.count === false) {
    const { records, hasMore } = await runner.loadAhead(onPage);
    return { records, page, perPage, hasNext: hasMore, hasPrevious };
  }
  const { records, count } = await runner.loadCounted(onPage, query);
  const totalPages = Math.ceil(count / perPage);
  const hasNext = page < totalPages;
  return { records, page, perPage, total: count, totalPages, hasNext, hasPrevious };
}

/**
 * The rows before `page`. A page so far that the rows to it (and one more, for `count: false`)
 * aren't a safe integer is a `TypeError`, as an uncastable page is, rather than an inexact offset.
 */
function offsetOf(page: number, perPage: number): number {
  const offset = (page - 1) * perPage;
  if (!Number.isSafeInteger(offset + perPage + 1)) {
    throw new TypeError("paginate()'s page is too far to reach");
  }
  return offset;
}

/**
 * A page or page size, cast as an integer attribute is (#81), so `"2"` is 2. Missing, `null` or
 * `""` is `undefined`, for the default; anything else not a whole number from 1 is a `TypeError`.
 */
function pageNumber(name: string, value: number | string | null | undefined): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const cast = castValue({ type: "integer" }, value);
  if (cast === uncastable || (cast as number) < 1) {
    throw new TypeError(`paginate()'s ${name} must be a whole number from 1`);
  }
  return cast as number;
}
