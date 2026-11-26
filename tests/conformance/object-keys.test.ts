import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../packages/arbor/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

const courseAttributes = {
  id: { type: "integer", null: false },
  tag: "json",
  startsAt: "datetime",
  digest: "binary",
} as const;

const lessonAttributes = {
  id: { type: "integer", null: false },
  courseTag: "json",
  courseStartsAt: "datetime",
  courseDigest: "binary",
} as const;

type CourseKey = "tag" | "startsAt" | "digest";

const foreignKeys = {
  tag: "courseTag",
  startsAt: "courseStartsAt",
  digest: "courseDigest",
} as const satisfies Record<CourseKey, keyof typeof lessonAttributes>;

/** A course Model whose lessons link to its `key`, an attribute a record holds as an object. */
function modelsLinking(key: CourseKey) {
  const foreignKey = foreignKeys[key];

  class Course extends Model.define(courseAttributes) {
    static table = "courses";

    lessons = hasMany(Lesson, { foreignKey, primaryKey: key });
  }

  class Lesson extends Model.define(lessonAttributes) {
    static table = "lessons";

    course = belongsTo(Course, { foreignKey, primaryKey: key });
    classmates = hasMany(Lesson, { through: "course", source: "lessons" });
  }

  return { Course, Lesson };
}

const ids = (records: readonly { id: number }[] | null | undefined) =>
  (records ?? []).map(({ id }) => id).sort((a, b) => a - b);

// A json value, a Date and bytes are objects, which equal only themselves: a preload matches such
// keys by the value they hold, as a join or a lazy read does (#591).
describe("a link by a key a record holds as an object", () => {
  let harness: Harness;
  const db = () => harness.connect();

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  beforeEach(async () => {
    await harness.reset("lessons", "courses");
    const { Course, Lesson } = modelsLinking("tag");
    const course = (row: number) => ({
      tag: { row },
      startsAt: new Date(Date.UTC(2026, 0, row)),
      digest: new Uint8Array([row]),
    });
    const lesson = (row: number) => {
      const { tag, startsAt, digest } = course(row);
      return { courseTag: tag, courseStartsAt: startsAt, courseDigest: digest };
    };
    await db()
      .model(Course)
      .insertAll([
        { id: 1, ...course(1) },
        { id: 2, ...course(2) },
      ]);
    await db()
      .model(Lesson)
      .insertAll([
        { id: 1, ...lesson(1) },
        { id: 2, ...lesson(1) },
        { id: 3, ...lesson(3) },
      ]);
  });

  describe.each<CourseKey>(["tag", "startsAt", "digest"])("by %s", (key) => {
    const { Course, Lesson } = modelsLinking(key);

    test("a belongsTo preload links each lesson to its course", async () => {
      const lessons = await db().model(Lesson).includes("course").order({ id: "asc" }).toArray();

      expect(lessons.map((lesson) => lesson.loaded("course")?.id ?? null)).toEqual([1, 1, null]);
    });

    test("a hasMany preload links each course to its lessons", async () => {
      const courses = await db().model(Course).includes("lessons").order({ id: "asc" }).toArray();

      expect(courses.map((course) => ids(course.loaded("lessons")))).toEqual([[1, 2], []]);
    });

    test("a through preload links each lesson to its course's lessons", async () => {
      const lessons = await db()
        .model(Lesson)
        .includes("classmates")
        .order({ id: "asc" })
        .toArray();

      expect(lessons.map((lesson) => ids(lesson.loaded("classmates")))).toEqual([
        [1, 2],
        [1, 2],
        [],
      ]);
    });

    test("joins find the linked rows both ways", async () => {
      expect(await db().model(Course).joins("lessons").pluck("id")).toEqual([1, 1]);
      expect(await db().model(Lesson).joins("course").order({ id: "asc" }).pluck("id")).toEqual([
        1, 2,
      ]);
    });
  });
});
