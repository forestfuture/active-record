import { ActiveRecordError, RecordNotFound, RecordNotUnique } from "@forestfuture/active-record";
import { User } from "./src/models/user";

// #region check
export async function showUser(id: string): Promise<Response> {
  try {
    return Response.json(await User.find(id));
  } catch (error) {
    if (error instanceof RecordNotFound) return new Response("No such user", { status: 404 });
    if (error instanceof ActiveRecordError) return new Response(error.message, { status: 400 });
    throw error; // not one of Active Record's own
  }
}
// #endregion check

// #region not-unique
export async function signUp(email: string) {
  const user = User.build({ email });
  try {
    await user.save();
  } catch (error) {
    if (error instanceof RecordNotUnique && error.attributes.includes("email")) {
      user.errors.add("email", "has already been taken", { type: "taken" });
    } else {
      throw error;
    }
  }
  return user;
}
// #endregion not-unique
