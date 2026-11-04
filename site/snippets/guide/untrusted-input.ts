import { Model } from "@forestfuture/active-record";

export class Account extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  handle: { type: "string", null: false },
  plan: "string",
  seats: "integer",
}) {}

export class Invitation extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  token: "string", // NULL once the invitation is accepted
  acceptedAt: "datetime",
}) {}

export async function signUp(request: Request): Promise<Account> {
  // #region permit
  const permitted = Account.permit(await request.json(), "email", "handle");
  const account = await Account.create(permitted);
  // #endregion permit
  return account;
}

// #region bad-request
export async function updateAccount(account: Account, request: Request): Promise<Response> {
  let permitted;
  try {
    permitted = Account.permit(await request.json(), "handle", "seats");
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      return new Response("Bad request", { status: 400 });
    }
    throw error;
  }

  await account.update(permitted);
  return Response.json(account);
}
// #endregion bad-request

// #region null-check
export async function accept(request: Request): Promise<Response> {
  const { token } = await request.json<{ token: string }>();
  if (typeof token !== "string" || token === "") {
    return new Response("Send the invitation's token", { status: 400 });
  }

  const invitation = await Invitation.findBy({ token });
  if (invitation === null) return new Response("No such invitation", { status: 404 });

  await invitation.update({ token: null, acceptedAt: new Date() });
  return new Response(`Welcome, ${invitation.email}`);
}
// #endregion null-check
