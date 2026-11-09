import { describe, expect, test } from "vite-plus/test";
import { InvalidModel, Model } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";
import { singularize } from "../../packages/active-record/src/inflections.ts";
import { underscore } from "../../packages/active-record/src/naming.ts";

const db = connect({} as never);

/** A Model class with this exact class name, as `class <name> extends Model.define(…)` makes. */
function modelNamed(name: string) {
  return { [name]: class extends Model.define({ id: "integer" }) {} }[name]!;
}

// Rails' tableize cases (from Rails' inflector tests): a class name, and its table.
const inflected: [string, string][] = [
  ["User", "users"],
  ["BlogPost", "blog_posts"],
  ["APIKey", "api_keys"],
  ["Search", "searches"],
  ["Switch", "switches"],
  ["Box", "boxes"],
  ["Process", "processes"],
  ["Address", "addresses"],
  ["Wish", "wishes"],
  ["Category", "categories"],
  ["Query", "queries"],
  ["Day", "days"],
  ["Movie", "movies"],
  ["Archive", "archives"],
  ["Index", "indices"],
  ["Vertex", "vertices"],
  ["Matrix", "matrices"],
  ["MatrixFu", "matrix_fus"],
  ["Wife", "wives"],
  ["Safe", "saves"],
  ["Half", "halves"],
  ["Dwarf", "dwarves"],
  ["Basis", "bases"],
  ["Analysis", "analyses"],
  ["Datum", "data"],
  ["Medium", "media"],
  ["Quiz", "quizzes"],
  ["Bus", "buses"],
  ["Status", "statuses"],
  ["Alias", "aliases"],
  ["Octopus", "octopi"],
  ["Axis", "axes"],
  ["Ox", "oxen"],
  ["Mouse", "mice"],
  ["House", "houses"],
  ["Buffalo", "buffaloes"],
  ["Tomato", "tomatoes"],
  ["Photo", "photos"],
  ["Person", "people"],
  ["Salesperson", "salespeople"],
  ["Man", "men"],
  ["Woman", "women"],
  ["Child", "children"],
  ["NodeChild", "node_children"],
  ["Move", "moves"],
  ["Zombie", "zombies"],
  ["Sheep", "sheep"],
  ["Fish", "fish"],
  ["Series", "series"],
  ["Species", "species"],
  ["Equipment", "equipment"],
  ["Information", "information"],
  ["Police", "police"],
  ["Rice", "rice"],
  ["Price", "prices"],
  ["News", "news"],
];

describe("inferred table names", () => {
  // Rails' tableize: underscore, then pluralize by Active Support's English inflections.
  test.each(inflected)("%s → %s", (className, table) => {
    expect(modelNamed(className).table).toBe(table);
  });

  test("an explicit table wins", () => {
    class Person extends Model.define({ id: "integer" }) {
      static table = "humans";
    }

    expect(Person.table).toBe("humans");
  });

  test("a subclass shares its parent's table, inferred or explicit, unless it declares its own", () => {
    class User extends Model.define({ id: "integer" }) {}
    class Admin extends User {}
    class Archived extends User {
      static table = "archived_users";
    }
    class Account extends Model.define({ id: "integer" }) {
      static table = "billing_accounts";
    }
    class Business extends Account {}

    expect([Admin.table, Archived.table, Business.table]).toEqual([
      "users",
      "archived_users",
      "billing_accounts",
    ]);
  });

  test("a class renamed by a bundler infers from the name it has", () => {
    // What a minifier without keep_names does: the class is now called e.
    const e = class extends Model.define({ id: "integer" }) {};

    expect(e.table).toBe("es");
  });

  test("assigning table sets it for that class, as compiled class fields and static blocks do", () => {
    class User extends Model.define({ id: "integer" }) {}
    class Admin extends User {}
    class Member extends Model.define({ id: "integer" }) {
      static {
        this.table = "people";
      }
    }

    // What `static table = "…"` compiles to without useDefineForClassFields.
    User.table = "members";
    Admin.table = "admins";

    expect([User.table, Admin.table, Member.table]).toEqual(["members", "admins", "people"]);
  });

  test("a class with no name to infer from must declare its table", () => {
    const anonymous = [class extends Model.define({ id: "integer" }) {}][0]!;
    const defaultExport = { default: class extends Model.define({ id: "integer" }) {} }.default;
    const direct = Model.define({ id: "integer" });

    for (const model of [anonymous, defaultExport, direct]) {
      expect(() => db.model(model)).toThrow(InvalidModel);
      expect(() => db.model(model)).toThrow(
        /has no class name to infer its table from; set static table/,
      );
    }
  });
});

describe("singularize", () => {
  // The reverse of the same cases, as Active Support's singular rules turn them back.
  test.each(inflected)("%s ← %s", (className, table) => {
    expect(singularize(table)).toBe(underscore(className));
  });
});
