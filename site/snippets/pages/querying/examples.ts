import { User } from "./src/models/user";

export async function building() {
  // #region relation
  const admins = User.where({ role: "admin" }).order({ createdAt: "desc" });
  const firstTen = admins.limit(10); // a new Relation; admins is unchanged
  const users = await firstTen.toArray(); // the query runs here
  // #endregion relation
  return users;
}

export async function finding() {
  // #region find
  const user = await User.findByOrThrow({ email: "jane@example.com" }); // or RecordNotFound
  const nobody = await User.findBy({ email: "nobody@example.com" }); // null
  const again = await User.find(user.id); // by primary key, or RecordNotFound
  const oldest = await User.first(); // by primary key, unless ordered
  const newest = await User.order({ createdAt: "asc" }).last(); // the order reversed
  const owner = await User.findSoleBy({ role: "owner" }); // the only one, or throws
  // #endregion find
  return { user, nobody, again, oldest, newest, owner };
}

export async function reading() {
  // #region pluck
  const emails = await User.order({ email: "asc" }).pluck("email"); // string[]
  const pairs = await User.order({ email: "asc" }).pluck("id", "email"); // [string, string][]
  const latest = await User.order({ createdAt: "desc" }).pick("email"); // string | null
  const adminIds = await User.where({ role: "admin" }).ids(); // primary keys
  // #endregion pluck
  return { emails, pairs, latest, adminIds };
}

export async function counting() {
  // #region count
  const admins = await User.where({ role: "admin" }).count();
  const hasAdmins = await User.exists({ role: "admin" });
  const severalAdmins = await User.where({ role: "admin" }).hasMoreThanOne();
  const oneOwner = await User.where({ role: "owner" }).hasExactlyOne();
  // #endregion count
  return { admins, hasAdmins, severalAdmins, oneOwner };
}

export async function selecting() {
  // #region select
  const [first] = await User.order({ email: "asc" }).select("email").toArray();
  console.log(first?.email); // loaded
  console.log(first?.id); // the primary key is always loaded too
  // first?.role would throw MissingAttribute: it wasn't selected
  const roles = await User.select("role").distinct().pluck("role");
  // #endregion select
  return { first, roles };
}

export async function matchingNothing() {
  // #region none
  const nothing = await User.none().where({ role: "admin" }).toArray(); // [], with no query
  // #endregion none
  return nothing;
}

export async function merging() {
  // #region merge
  const newest = User.order({ createdAt: "desc" }).limit(1);
  const newestAdmin = await User.where({ role: "admin" }).merge(newest).toArray();
  // #endregion merge
  return newestAdmin;
}

export function seeingSql() {
  // #region to-sql
  const { sql, params } = User.where({ role: "admin" }).limit(10).toSql();
  console.log(sql); // SELECT * FROM "users" WHERE ("role" = ?) LIMIT ?, with $1 and $2 on Postgres
  console.log(params); // ["admin", 10]
  // #endregion to-sql
  return { sql, params };
}
