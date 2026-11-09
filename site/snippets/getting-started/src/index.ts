import { User } from "./models/user";

export default {
  async fetch(request: Request): Promise<Response> {
    // GET: the 20 newest active users, each with their posts.
    if (request.method === "GET") {
      const users = await User.active()
        .includes("posts") // loaded in one extra query, not one per user
        .order({ createdAt: "desc" })
        .limit(20)
        .toArray();
      return Response.json(users);
    }

    // POST: sign up a user with a first post, saved together.
    const { email } = await request.json<{ email: string }>();
    const user = User.build({ email });
    user.posts().build({ title: "Hello, world" });

    // save() validates and runs callbacks; false means it wasn't saved, and why is in errors.
    if (!(await user.save())) {
      return Response.json({ errors: user.errors.fullMessages() }, { status: 422 });
    }
    return Response.json(user, { status: 201 });
  },
} satisfies ExportedHandler<Env>;
