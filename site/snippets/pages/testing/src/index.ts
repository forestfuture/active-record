import { User } from "./models/user";

// The app's Worker: here, one route that lists the users' emails.
export default {
  async fetch() {
    return Response.json(await User.order({ email: "asc" }).pluck("email"));
  },
} satisfies ExportedHandler<Env>;
