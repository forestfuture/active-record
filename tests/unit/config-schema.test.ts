import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { stringSettings } from "../../packages/active-record/cli/adapters/postgresql/config.ts";
import { adapterNames } from "../../packages/active-record/cli/project/adapters.ts";
import { parseJsonc } from "../../packages/active-record/cli/project/config-file.ts";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

interface Definition {
  properties: Record<string, { const?: string }>;
  required: string[];
}

const schema = JSON.parse(read("packages/active-record/config-schema.json")) as {
  definitions: Record<string, Definition>;
  properties: { databases: { additionalProperties: { oneOf: { $ref: string }[] } } };
};

/** Each adapter the schema describes an entry for, by the `adapter` it takes. */
const described = Object.fromEntries(
  schema.properties.databases.additionalProperties.oneOf.map(({ $ref }) => {
    const definition = schema.definitions[$ref.replace("#/definitions/", "")]!;
    return [definition.properties["adapter"]!.const!, definition];
  }),
);

/** The keys of an entry the schema wouldn't take, by binding: `DB.urll`. */
function unknownKeys(databases: Record<string, Record<string, unknown>>): string[] {
  return Object.entries(databases).flatMap(([binding, entry]) => {
    const definition = described[String(entry["adapter"])];
    if (definition === undefined) return [`${binding}.adapter`];
    return Object.keys(entry)
      .filter((key) => !(key in definition.properties))
      .map((key) => `${binding}.${key}`);
  });
}

// init links the file to a schema the package ships, for an editor to complete it from (#301).
describe("active-record.jsonc's JSON Schema", () => {
  test("ships in the package, where init's $schema links to it", () => {
    const manifest = JSON.parse(read("packages/active-record/package.json")) as { files: string[] };

    expect(manifest.files).toContain("config-schema.json");
  });

  test("describes an entry for each adapter, which requires its adapter", () => {
    expect(Object.keys(described).sort()).toEqual([...adapterNames].sort());
    for (const definition of Object.values(described)) {
      expect(definition.required).toEqual(["adapter"]);
    }
  });

  test.each([
    "tests/fixtures/active-record.jsonc",
    "site/snippets/getting-started/active-record.jsonc",
    "site/snippets/move-to-postgres/active-record.jsonc",
  ])("takes %s", (path) => {
    const config = parseJsonc(read(path)) as { databases: Record<string, Record<string, unknown>> };

    expect(unknownKeys(config.databases)).toEqual([]);
  });

  // A D1 database's Wrangler config in another folder, such as a monorepo's Worker (#306).
  test("takes a D1 database's wranglerConfig, a path", () => {
    const setting = described["d1"]!.properties["wranglerConfig"] as { type?: string } | undefined;

    expect(setting?.type).toBe("string");
  });

  test("takes every setting the PostgreSQL adapter reads", () => {
    for (const setting of stringSettings) {
      expect(described["postgresql"]!.properties).toHaveProperty(setting);
    }
  });
});
