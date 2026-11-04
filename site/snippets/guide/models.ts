import { column, Model, sql } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";

// #region declare
export class User extends Model.define({
  id: { type: "string", null: false, generateId: true },
  email: { type: "string", null: false },
  role: "string",
  isActive: "boolean", // column: is_active
  htmlURL: "string", // column: html_url (a run of capitals is one word)
  legacyId: { type: "integer", column: "person_identifier" },
  settings: { type: "json", default: () => ({ theme: "light" }) },
  createdAt: "datetime",
  updatedAt: "datetime",
}) {
  static primaryKey = "id"; // the default

  static active = this.scope((q) => q.where({ isActive: true }));
  static createdAfter = this.scope((q, since: Date) =>
    q.where(sql`${column("createdAt")} > ${since}`),
  );
}
// #endregion declare

// #region generated
export class Product extends ApplicationRecord {
  static newest = this.scope((q) => q.order({ createdAt: "desc" }));
}
// #endregion generated

export async function examples(): Promise<unknown> {
  // #region build
  const user = User.build({ email: "ada@example.com" });
  console.log(user.id); // already generated, before saving: "3b241101-e2bb-…"
  console.log(user.role); // null: not assigned yet
  console.log(user.settings); // { theme: "light" }

  user.assign({ role: "admin", isActive: true });
  user.isChanged(); // true
  user.changes(); // { email: [null, "ada@example.com"], role: [null, "admin"], … }
  await user.save();
  // #endregion build

  // #region dirty
  user.email = "ada@lovelace.dev";
  user.changed(); // ["email"]
  user.attributeWas("email"); // "ada@example.com"
  user.isAttributeChanged("email", { from: "ada@example.com" }); // true
  await user.save();
  user.savedChangeTo("email"); // ["ada@example.com", "ada@lovelace.dev"]
  user.hasSavedChangeTo("email"); // true
  // #endregion dirty

  // #region scopes
  const admins = await User.active().where({ role: "admin" }).toArray();
  const recent = await User.createdAfter(new Date(Date.now() - 86_400_000)).count();
  // #endregion scopes

  // #region json
  const body = JSON.stringify(user); // dates as ISO strings, associations left out
  const attributes = user.attributes(); // a plain object, dates as Date
  // #endregion json
  return { admins, recent, body, attributes };
}

/** The guide's casting example: values that arrive as text are cast as they're assigned. */
export function castingExample(user: User): void {
  // #region casting
  // Values from JSON, a form or a query string often arrive as text:
  user.assign(JSON.parse('{ "isActive": "false", "legacyId": " 42 " }'));
  console.log(user.isActive); // false, not the truthy string "false"
  console.log(user.legacyId); // 42

  user.assign(JSON.parse('{ "isActive": "no" }'));
  // TypeError: User: "no" isn't a boolean for "isActive"
  // #endregion casting
}
