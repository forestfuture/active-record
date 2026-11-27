// A Worker on the built package, imported by its name as an app's is, for tests/workerd/built-package.test.ts: Wrangler bundles it against the packed tarball and the test runs it in workerd.
import { withDatabase } from "@forestfuture/arbor";
import { connect } from "@forestfuture/arbor/d1";
import { Product, Review } from "./models";

interface Env {
  DB: Parameters<typeof connect>[0];
}

/** What the Workers-only paths and a preload did, for the test to assert on. */
async function smoke(env: Env) {
  // The Model's binding, read from cloudflare:workers: no database given.
  const product = await Product.find(1);

  // The request's database, which withDatabase keeps in AsyncLocalStorage: its listener hears
  // the Models' queries only if they found it there.
  let heard = 0;
  const db = connect(env.DB, { onQuery: () => (heard += 1) });
  const readBack = await withDatabase(db, async () => {
    const review = await Review.create({ productId: product.id, body: "Sturdy" });
    return (await Review.find(review.id)).body;
  });

  const [loaded] = await Product.where({ id: product.id }).includes("reviews").toArray();
  return {
    found: product.title,
    readBack,
    heard,
    reviews: loaded!.loaded("reviews").map((review) => review.body),
    className: Product.name,
  };
}

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    try {
      return Response.json(await smoke(env));
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 500 });
    }
  },
};
