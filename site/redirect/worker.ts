// d1-record.forestfuture.dev, the guide's old host: every request redirects permanently to its path and query on active-record.forestfuture.dev (#270).
const guide = "https://active-record.forestfuture.dev";

export default {
  fetch(request: Request): Response {
    const { pathname, search } = new URL(request.url);
    return Response.redirect(`${guide}${pathname}${search}`, 301);
  },
};
