import { hasOne, Model } from "@forestfuture/active-record";

export class Profile extends Model.define({
  id: { type: "integer", null: false },
  userId: "integer",
  bio: "string",
  updatedAt: "datetime",
}) {}

// #region declare
export class User extends Model.define({
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
  updatedAt: "datetime",
}) {
  profile = hasOne(Profile, { touch: true });
}
// #endregion declare

export async function examples(id: number) {
  // #region touching
  const user = await User.find(id);
  await user.update({ name: "Ada" }); // sets the profile's updatedAt
  await user.touch(); // and again
  // #endregion touching
  return user;
}
