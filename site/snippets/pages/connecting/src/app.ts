import { User } from "./models/user";

// The app's Worker. No setup: each Model queries the binding its generated schema names.
export const app = {
  async fetch(request) {
    const email = new URL(request.url).searchParams.get("email") ?? "";
    const user = await User.findByOrThrow({ email });
    return Response.json(await user.posts().order({ title: "asc" }).pluck("title"));
  },
} satisfies ExportedHandler<Env>;
