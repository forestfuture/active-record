import { Admin } from "./src/models/admin";
import { User } from "./src/models/user";

// #region sign-up
export async function signUp(request: Request): Promise<Response> {
  const form = await request.formData();
  const permitted = User.permit(form, "email", "password", "passwordConfirmation");
  const user = await User.create(permitted);
  if (!user.isPersisted()) {
    return Response.json({ errors: user.errors.fullMessages() }, { status: 422 });
  }
  return Response.json(user, { status: 201 }); // no password, digest, or token in it
}
// #endregion sign-up

export async function storing() {
  // #region digest
  const user = User.build({ email: "jane@example.com", password: "correct horse battery" });
  console.log(user.passwordDigest === null); // true, until the user is saved

  await user.saveOrThrow();
  const isHashed = user.passwordDigest?.startsWith("$pbkdf2-sha256$") === true;
  console.log(isHashed); // true
  // #endregion digest
  return user;
}

export async function checking() {
  // #region authenticate
  const user = await User.findByOrThrow({ email: "jane@example.com" });

  const isSignedIn = (await user.authenticate("correct horse battery")) !== false;
  console.log(isSignedIn); // true
  // #endregion authenticate
  return isSignedIn;
}

// #region sign-in
export async function signIn(request: Request): Promise<Response> {
  const form = await request.formData();
  const { email = "", password = "" } = User.permit(form, "email", "password");
  const user = await User.authenticateBy({ email, password });
  if (user === null) return new Response("Wrong email or password", { status: 401 });
  return Response.json({ token: user.authToken });
}
// #endregion sign-in

export async function changing() {
  // #region challenge
  const user = await User.findByOrThrow({ email: "jane@example.com" });

  const isChanged = await user.update({
    password: "staple battery horse",
    passwordConfirmation: "staple battery horse",
    passwordChallenge: "correct horse battery", // the current password
  });
  console.log(isChanged); // false if the challenge isn't the current password
  // #endregion challenge
  return { user, isChanged };
}

export async function hashingWithBcrypt() {
  // #region bcrypt
  const admin = await Admin.create({ email: "sam@example.com", password: "correct horse battery" });
  const isBcrypt = admin.passwordDigest?.startsWith("$2b$10$") === true;
  console.log(isBcrypt); // true
  // #endregion bcrypt
  return admin;
}

export async function tokens() {
  // #region token
  const user = User.build({ email: "sam@example.com", password: "correct horse battery" });
  console.log(user.authToken?.length); // 24, such as "pX27zsMN2ViQKta1bGfLmVJE"
  await user.saveOrThrow();

  const found = await User.findBy({ authToken: user.authToken });
  // #endregion token
  return { user, found };
}

export async function regenerating() {
  // #region regenerate
  const user = await User.findByOrThrow({ email: "sam@example.com" });

  await user.regenerateAuthTokenOrThrow(); // saves a new token, so the old one stops working
  // #endregion regenerate
  return user;
}
