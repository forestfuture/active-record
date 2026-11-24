import { defineConfig } from "blume";

export default defineConfig({
  title: "Arbor ORM",
  description:
    "Arbor: an Active Record ORM for TypeScript on Cloudflare D1 and PostgreSQL, built for Cloudflare Workers.",
  github: { owner: "forestfuture", repo: "arbor", dir: "site" },
  lastModified: "git",
  // Blume's own header shows it on the 404 page; components/HeaderLogo.astro replaces that header
  // logo everywhere else.
  logo: "/icon.svg",
  // Cloudflare Web Analytics counts page views, turned on for the zone in the dashboard. Adding
  // Blume's cloudflare() adapter as well would count each view twice. It has no event API, so the
  // page rating stays off until its votes have somewhere to go.
  feedback: false,
  theme: { accent: { light: "#2f6b3f", dark: "#8cc79a" } },
  footer: {
    copyright: "Arbor ORM is a ForestFuture project",
    links: [{ label: "ForestFuture", href: "https://forestfuture.dev" }],
  },
  agents: {
    llmsTxt: {
      details:
        "Arbor ORM is `@forestfuture/arbor` on npm, an Active Record ORM for TypeScript on Cloudflare D1 and PostgreSQL, built for Cloudflare Workers, with an adapter for each database inside it: `@forestfuture/arbor/d1` for D1, and `@forestfuture/arbor/postgresql` for Postgres. Install its agent skill, with the rules for writing Arbor code, using `npx skills add forestfuture/arbor`. Every behavior the tests prove is in the [behavior contract](https://github.com/forestfuture/arbor/blob/main/docs/contract.md). The installed package ships this guide for its own version at `node_modules/@forestfuture/arbor/llms-full.txt`.",
    },
    // Published at /.well-known/agent-skills/arbor/SKILL.md, in place of Blume's generated skill.
    skills: "../packages/arbor/skills",
    contentSignals: { aiTrain: false },
  },
  deployment: { site: "https://arbor.forestfuture.dev" },
});
