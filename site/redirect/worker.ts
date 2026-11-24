// The guide's old hosts, d1-record.forestfuture.dev (#270) and active-record.forestfuture.dev (#558): every request redirects permanently to its path and query on arbor.forestfuture.dev.
const guide = "https://arbor.forestfuture.dev";

export default {
  fetch(request: Request): Response {
    const { pathname, search } = new URL(request.url);
    return Response.redirect(`${guide}${pathname}${search}`, 301);
  },
};
