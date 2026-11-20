import { User } from "./models/user";

// The app's Worker: here, one route that finds a user by email.
export const app = {
  async fetch(request) {
    const email = new URL(request.url).searchParams.get("email") ?? "";
    const user = await User.findByOrThrow({ email });
    return Response.json({ id: user.id });
  },
} satisfies ExportedHandler<Env>;
