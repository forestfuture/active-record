import { between, column, gte, lt, sql } from "@forestfuture/active-record";
import { Post } from "../getting-started/models";
import { User } from "./models";

export async function examples(since: Date, until: Date): Promise<unknown> {
  // #region relation
  const admins = User.where({ role: "admin" }).order({ createdAt: "desc" });
  const firstTen = admins.limit(10); // a new Relation; admins is unchanged
  const users = await firstTen.toArray(); // the query runs here
  // #endregion relation

  // #region where
  User.where({ role: "admin", isActive: true }); // role = ? AND is_active = ?
  User.where({ role: null }); // role IS NULL
  User.where({ role: ["admin", "editor"] }); // role IN (…), any number of values
  User.whereNot({ role: "admin" }); // NOT (role = ?)
  User.where({ role: "admin" }).or(User.where({ isActive: false }));
  // #endregion where

  // #region comparisons
  Post.where({ publishedAt: gte(since) }); // published_at >= since
  User.where({ createdAt: lt(since) }); // created_at < since
  User.where({ createdAt: between(since, until) }); // both ends included
  User.where({ createdAt: between(since, until, { excludeEnd: true }) });
  // #endregion comparisons

  // #region sql
  const email = "Ada@Example.com";
  User.where(sql`lower(${column("email")}) = lower(${email})`);
  // #endregion sql

  // #region rewhere
  const members = User.where({ role: "member", isActive: true });
  members.rewhere({ role: "admin" }); // is_active = ? AND role = ?
  // #endregion rewhere

  // #region unscope
  const recent = User.where({ role: "admin" }).order({ createdAt: "desc" }).limit(10);
  recent.unscope("order", "limit"); // every admin, unordered
  recent.unscope({ where: "role" }); // the 10 newest users
  recent.only("where"); // every admin
  // #endregion unscope

  // #region order
  User.order({ role: "asc", createdAt: "desc" });
  User.order({ role: { direction: "asc", nulls: "last" } });
  User.order(sql`lower(${column("email")})`);
  User.order({ role: "asc" }).reorder({ email: "asc" }); // replaces the order
  User.order({ createdAt: "desc" }).limit(20).offset(40); // page 3
  // #endregion order

  // #region in-order-of
  User.inOrderOf("role", ["owner", "admin", "member"]); // only those roles, owners first
  User.inOrderOf("role", ["owner", "admin"], { filter: false }); // everyone else last
  // #endregion in-order-of

  // #region excluding
  const current = await User.firstOrThrow();
  const others = await User.where({ role: "admin" }).excluding(current).toArray();
  // #endregion excluding

  const results = await gettingResults();

  // #region select
  const partial = await User.select("email").toArray();
  console.log(partial[0]?.email); // loaded
  console.log(partial[0]?.id); // the primary key is always loaded too
  // partial[0]?.role would throw MissingAttribute: it wasn't selected
  const roles = await User.select("role").distinct().pluck("role");
  // #endregion select

  // #region none
  const nothing = await User.none().where({ role: "admin" }).toArray(); // [], no query
  // #endregion none

  // #region to-sql
  const { sql: text, params } = User.where({ role: "admin" }).limit(10).toSql();
  console.log(text); // SELECT * FROM "users" WHERE ("role" = ?) LIMIT ?
  console.log(params); // ["admin", 10]
  // #endregion to-sql

  return [users, text, params, results, roles, nothing, others];
}

/** The Getting results section's finders and terminals. */
async function gettingResults(): Promise<unknown[]> {
  // #region terminal
  const all = await User.toArray();
  const user = await User.find("3b241101-e2bb-4255-8caf-4136c566a962"); // or RecordNotFound
  const two = await User.find(["id-1", "id-2"]); // in the ids' order
  const byEmail = await User.findBy({ email: "ada@example.com" }); // or null
  const oldest = await User.first(); // by primary key, unless ordered
  const newest = await User.order({ createdAt: "asc" }).last(); // order reversed
  const any = await User.take(); // no ordering at all
  const earliest = await User.firstOrThrow(); // or RecordNotFound
  const owner = await User.findSoleBy({ role: "owner" }); // the only one, or throws
  const emails = await User.pluck("email"); // string[]
  const pairs = await User.pluck("id", "email"); // [string, string][]
  const latest = await User.order({ createdAt: "desc" }).pick("email"); // string | null
  const adminIds = await User.where({ role: "admin" }).ids(); // primary keys
  const admins2 = await User.where({ role: "admin" }).count();
  const hasAdmins = await User.exists({ role: "admin" });
  const severalAdmins = await User.where({ role: "admin" }).hasMoreThanOne();
  const oneOwner = await User.where({ role: "owner" }).hasExactlyOne();
  // #endregion terminal

  return [
    all,
    user,
    two,
    byEmail,
    oldest,
    newest,
    any,
    earliest,
    owner,
    emails,
    pairs,
    latest,
    adminIds,
    admins2,
    hasAdmins,
    severalAdmins,
    oneOwner,
  ];
}
