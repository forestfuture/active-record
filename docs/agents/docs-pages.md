# Docs pages

How a guide page is built. Readers land on one page from a search or an agent, and rarely read the guide in order, so every page stands on its own: its Models, its imports, and its answers are on the page. [docs-voice.md](docs-voice.md) decides how the sentences read.

[Conditions](<../../site/docs/(basics)/conditions.mdx>) and [Through associations](<../../site/docs/(basics)/through-associations.mdx>) are the models to copy.

## The layout

1. **The deck** is the front matter's `description`: one declarative sentence saying what the page lets you do. "Filter a query’s records by their attributes." Not a list of keywords, and no code formatting, since it renders as plain text.
2. **Nothing between the deck and the first heading.** A paragraph there reads as a second deck. A note or tip box may sit there, or start with a heading.
3. **`## At a glance`**: a table of each task and the code it takes (and the SQL it writes, for a query). Options go beneath it in a `<TypeTable>`, written by hand: agents read it as a Markdown table, while an `<AutoTypeTable>` reaches them as raw JSX.
4. **`## The Model` (or `## The Models`)**: "The examples use this Model and table:", then `<Tabs syncKey="database">` with the Model, its D1 table, and its Postgres table.
5. **A section for each task**, headed with a gerund ("Matching values"). One sentence ending in a colon, the example, then at most a few bullets. Side facts go in a note, and Rails comparisons in a Compared with Rails box at the end.

Say where D1 and Postgres differ, and only there: a `:::warning` at the top for a feature one of them lacks, or `<Tabs>` around an example whose code differs. Working the same on both is implied.

Keep a page to one subject. When a section grows into a subject of its own, give it its own page, and leave a one-paragraph pointer where it was.

## Examples

- Write each page's examples in a snippet file, `site/snippets/guide/<page>.ts`. Its `model` region declares the page's Models. The page shows that region once, under The Model.
- Each other region is one example. Write it to stand alone: it finds the records it needs (`Tag.findByOrThrow({ name: "essays" })`) rather than taking them as parameters, so it can be copied as it is.
- Embed it with Twoslash: `<include meta="twoslash">/_excerpts/guide/<page>/<region>.twoslash.ts</include>`. The page shows the example with its imports, its Models come from `./models`, and hovering a name shows its type. The site's build fails if an example doesn't type-check.
- Don't pin a type with `// ^?`: its popup never closes.
- To show a compile error, put `// @ts-expect-error` above the line. `vp check` proves the error is there, and the page shows it.
- Run the examples against D1 in `tests/integration/d1/site-examples.test.ts`, on the page's own tables (`site/snippets/**/*.sql`).
