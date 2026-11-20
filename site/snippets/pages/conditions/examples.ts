import { between, column, gte, lt, sql } from "@forestfuture/active-record";
import { User } from "./src/models/user";

export async function matching() {
  // #region where
  const admins = await User.where({ role: "admin", isActive: true }).toArray();

  User.where({ role: null }); // role IS NULL
  User.where({ role: ["admin", "editor"] }); // role IN (…), any number of values
  // #endregion where

  // #region where-not
  const others = await User.whereNot({ role: "admin" }).toArray();
  const either = await User.where({ role: "admin" })
    .or(User.where({ isActive: false }))
    .toArray();
  // #endregion where-not
  return { admins, others, either };
}

/** The typo the page shows: the compiler rejects it, and so does where, with UnknownAttribute. */
export function misspelling() {
  // #region typos
  // @ts-expect-error: User has no attribute "rol"
  User.where({ rol: "admin" });
  // #endregion typos
}

export async function comparing() {
  // #region comparisons
  const since = new Date("2026-01-01");
  const until = new Date("2026-02-01");

  User.where({ createdAt: gte(since) }); // created_at >= ?
  User.where({ createdAt: lt(since) }); // created_at < ?
  User.where({ createdAt: between(since, until) }); // both ends included
  User.where({ createdAt: between(since, until, { excludeEnd: true }) });
  // #endregion comparisons

  // #region sql
  const email = "Ada@Example.com";
  const ada = await User.findBy(sql`lower(${column("email")}) = lower(${email})`);
  // #endregion sql

  // #region value
  const createdAt = column("createdAt");
  const newcomers = await User.where(
    sql`${createdAt} >= ${createdAt.value(new Date("2026-01-01"))}`,
  ).toArray();
  // #endregion value
  return { ada, newcomers };
}

export async function rewriting() {
  // #region rewhere
  const members = User.where({ role: "member", isActive: true });
  const activeAdmins = await members.rewhere({ role: "admin" }).toArray(); // is_active = ? AND role = ?
  // #endregion rewhere

  // #region unscope
  const recent = User.where({ role: "admin" }).order({ createdAt: "desc" }).limit(10);
  recent.unscope("order", "limit"); // every admin, unordered
  recent.unscope({ where: "role" }); // the 10 newest users
  recent.only("where"); // every admin
  // #endregion unscope

  // #region excluding
  const me = await User.findByOrThrow({ email: "ada@example.com" });
  const everyoneElse = await User.excluding(me).toArray();
  // #endregion excluding
  return { activeAdmins, everyoneElse };
}
