import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  hasOne,
  Model,
  UnknownModelName,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  remarks = hasMany(Remark, { as: "commentable" });
}

class Photo extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
}) {
  static table = "photos";

  remarks = hasMany(Remark, { as: "commentable" });
  firstRemark = hasOne(Remark, { as: "commentable" });
}

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";
}

class Remark extends Model.define({
  id: { type: "integer", null: false },
  body: "string",
  commentableType: "string",
  commentableId: "integer",
}) {
  static table = "remarks";

  commentable = belongsTo([Post, Photo], { optional: true });
}

describe("polymorphic associations", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("remarks", "photos", "comments", "posts", "profiles", "users");
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'First')");
    await harness.exec("INSERT INTO photos (id, title) VALUES (10, 'Sunset')");
    await harness.exec(
      "INSERT INTO remarks (id, body, commentable_type, commentable_id) VALUES (1, 'On a post', 'Post', 10), (2, 'On a photo', 'Photo', 10), (3, 'On nothing', NULL, NULL)",
    );
  });

  describe("reading a polymorphic belongsTo", () => {
    test("loads the record of the Model its type names", async () => {
      const db = harness.connect();
      const [onPost, onPhoto] = await db.model(Remark).order({ id: "asc" }).limit(2).toArray();

      const post = await onPost!.commentable();
      const photo = await onPhoto!.commentable();

      expect(post).toBeInstanceOf(Post);
      expect((post as Post).title).toBe("First");
      expect(photo).toBeInstanceOf(Photo);
      expect((photo as Photo).title).toBe("Sunset");
    });

    test("is null without a query when the type and id are null", async () => {
      const queries: QueryEvent[] = [];
      const db = harness.connect({ onQuery: (event) => queries.push(event) });
      const remark = await db.model(Remark).find(3);
      queries.length = 0;

      expect(await remark.commentable()).toBeNull();
      expect(queries).toHaveLength(0);
    });
  });

  test("a type that names none of its Models throws UnknownModelName", async () => {
    await harness.exec("UPDATE remarks SET commentable_type = 'Video' WHERE id = 1");
    const db = harness.connect();
    const remark = await db.model(Remark).find(1);

    await expect(remark.commentable()).rejects.toThrow(
      new UnknownModelName(
        'Remark.commentable has the type "Video", which is none of its Models: Post, Photo',
      ),
    );
  });

  describe("setting a polymorphic belongsTo", () => {
    test("set points it at a record of any listed Model, by its type and key", async () => {
      const queries: QueryEvent[] = [];
      const db = harness.connect({ onQuery: (event) => queries.push(event) });
      const remark = await db.model(Remark).find(1);
      const photo = await db.model(Photo).find(10);
      queries.length = 0;

      remark.commentable.set(photo);

      expect(remark.commentableType).toBe("Photo");
      expect(remark.commentableId).toBe(10);
      expect(await remark.commentable()).toBe(photo);
      expect(queries).toHaveLength(0);
      await remark.saveOrThrow();
      const [row] = await harness.exec(
        "SELECT commentable_type, commentable_id FROM remarks WHERE id = 1",
      );
      expect(row).toEqual({ commentable_type: "Photo", commentable_id: 10 });
    });

    test("set(null) clears its type and key", async () => {
      const db = harness.connect();
      const remark = await db.model(Remark).find(1);

      remark.commentable.set(null);

      expect(remark.commentableType).toBeNull();
      expect(remark.commentableId).toBeNull();
      expect(await remark.commentable()).toBeNull();
    });

    test("set refuses a record of a Model it doesn't list", async () => {
      const db = harness.connect();
      const remark = await db.model(Remark).find(1);
      const user = db.model(User).build({ id: 2, email: "b@example.com" });

      expect(() => remark.commentable.set(user as never)).toThrow(
        new TypeError("Remark.commentable.set() takes a Post or Photo record or null"),
      );
      expect(remark.commentableType).toBe("Post");
    });

    test("changing only its type reads the other Model's record", async () => {
      const db = harness.connect();
      const remark = await db.model(Remark).find(1);
      expect(await remark.commentable()).toBeInstanceOf(Post);

      remark.commentableType = "Photo";

      expect(await remark.commentable()).toBeInstanceOf(Photo);
    });
  });

  describe("hasMany and hasOne through a polymorphic belongsTo, with as:", () => {
    test("read only the records whose type is the owner's Model", async () => {
      const db = harness.connect();
      const post = await db.model(Post).find(10);
      const photo = await db.model(Photo).find(10);

      expect((await post.remarks().toArray()).map(({ body }) => body)).toEqual(["On a post"]);
      expect((await photo.remarks().toArray()).map(({ body }) => body)).toEqual(["On a photo"]);
      expect((await photo.firstRemark())?.body).toBe("On a photo");
    });

    test("build and create through a hasMany fill in the type and key", async () => {
      const db = harness.connect();
      const post = await db.model(Post).find(10);

      const built = post.remarks().build({ id: 4, body: "Built" });
      const created = await post.remarks().create({ id: 5, body: "Created" });

      expect([built.commentableType, built.commentableId]).toEqual(["Post", 10]);
      expect([created.commentableType, created.commentableId]).toEqual(["Post", 10]);
      const rows = await harness.exec(
        "SELECT commentable_type, commentable_id FROM remarks WHERE id = 5",
      );
      expect(rows).toEqual([{ commentable_type: "Post", commentable_id: 10 }]);
    });

    test("build and set through a hasOne fill in the type and key", async () => {
      const db = harness.connect();
      const photo = await db.model(Photo).find(10);
      const other = await db.model(Remark).find(3);

      const built = photo.firstRemark.build({ id: 4, body: "Built" });
      await photo.firstRemark.set(other);

      expect([built.commentableType, built.commentableId]).toEqual(["Photo", 10]);
      const rows = await harness.exec(
        "SELECT commentable_type, commentable_id FROM remarks WHERE id = 3",
      );
      expect(rows).toEqual([{ commentable_type: "Photo", commentable_id: 10 }]);
    });
  });

  describe("removing records through as:", () => {
    class DestroyingPost extends Post {
      override remarks = hasMany(Remark, { as: "commentable", dependent: "destroy" });
    }
    class DeletingPost extends Post {
      override remarks = hasMany(Remark, { as: "commentable", dependent: "deleteAll" });
    }
    class NullifyingPost extends Post {
      override remarks = hasMany(Remark, { as: "commentable", dependent: "nullify" });
    }
    class RestrictedPost extends Post {
      override remarks = hasMany(Remark, {
        as: "commentable",
        dependent: "restrictWithException",
      });
    }
    class NullifyingPhoto extends Photo {
      override firstRemark = hasOne(Remark, { as: "commentable", dependent: "nullify" });
    }

    const remarkRows = () =>
      harness.exec("SELECT id, commentable_type, commentable_id FROM remarks ORDER BY id");
    const untouched = [
      { id: 2, commentable_type: "Photo", commentable_id: 10 },
      { id: 3, commentable_type: null, commentable_id: null },
    ];

    test("dependent destroy and deleteAll remove only the owner's Model's records", async () => {
      const db = harness.connect();
      await (await db.model(DestroyingPost).find(10)).destroyOrThrow();
      expect(await remarkRows()).toEqual(untouched);

      await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (11, 1, 'Second')");
      await harness.exec(
        "INSERT INTO remarks (id, body, commentable_type, commentable_id) VALUES (4, 'x', 'Post', 11)",
      );
      await (await db.model(DeletingPost).find(11)).destroyOrThrow();
      expect(await remarkRows()).toEqual(untouched);
    });

    test("nullify clears the type and the key", async () => {
      const db = harness.connect();
      await (await db.model(NullifyingPost).find(10)).destroyOrThrow();

      expect(await remarkRows()).toEqual([
        { id: 1, commentable_type: null, commentable_id: null },
        ...untouched,
      ]);
    });

    test("a restriction counts only the owner's Model's records", async () => {
      await harness.exec("DELETE FROM remarks WHERE id = 1");
      const db = harness.connect();

      await (await db.model(RestrictedPost).find(10)).destroyOrThrow();

      expect(await db.model(Post).where({ id: 10 }).count()).toBe(0);
    });

    test("deleteAll and clear on the association nullify the type and the key", async () => {
      const db = harness.connect();
      await (await db.model(Post).find(10)).remarks().deleteAll();
      expect(await remarkRows()).toEqual([
        { id: 1, commentable_type: null, commentable_id: null },
        ...untouched,
      ]);

      await harness.exec(
        "UPDATE remarks SET commentable_type = 'Post', commentable_id = 10 WHERE id = 1",
      );
      await (await db.model(Post).find(10)).remarks().clear();
      expect(await remarkRows()).toEqual([
        { id: 1, commentable_type: null, commentable_id: null },
        ...untouched,
      ]);
    });

    test("delete through the association nullifies the type and the key", async () => {
      const db = harness.connect();
      const post = await db.model(Post).find(10);
      const remark = await db.model(Remark).find(1);

      await post.remarks().delete(remark);

      expect(await remarkRows()).toEqual([
        { id: 1, commentable_type: null, commentable_id: null },
        ...untouched,
      ]);
    });

    test("a hasOne's nullify clears the type and the key, on destroy and on replacing", async () => {
      const db = harness.connect();
      const photo = await db.model(NullifyingPhoto).find(10);

      await photo.firstRemark.set(await db.model(Remark).find(3));
      expect(await remarkRows()).toEqual([
        { id: 1, commentable_type: "Post", commentable_id: 10 },
        { id: 2, commentable_type: null, commentable_id: null },
        { id: 3, commentable_type: "Photo", commentable_id: 10 },
      ]);

      await photo.destroyOrThrow();
      expect((await remarkRows())[2]).toEqual({
        id: 3,
        commentable_type: null,
        commentable_id: null,
      });
    });
  });

  describe("a hasMany's collection methods with as:", () => {
    test("push gives the records the owner's type and key", async () => {
      const db = harness.connect();
      const post = await db.model(Post).find(10);
      const remark = await db.model(Remark).find(3);

      expect(await post.remarks().push(remark)).toBe(true);

      const rows = await harness.exec(
        "SELECT commentable_type, commentable_id FROM remarks WHERE id = 3",
      );
      expect(rows).toEqual([{ commentable_type: "Post", commentable_id: 10 }]);
    });

    test("push on a new owner gives them its type and key when it's saved", async () => {
      const db = harness.connect();
      const post = db.model(Post).build({ id: 11, userId: 1, title: "New" });
      const remark = await db.model(Remark).find(3);

      await post.remarks().push(remark);
      await post.saveOrThrow();

      expect([remark.commentableType, remark.commentableId]).toEqual(["Post", 11]);
      const rows = await harness.exec(
        "SELECT commentable_type, commentable_id FROM remarks WHERE id = 3",
      );
      expect(rows).toEqual([{ commentable_type: "Post", commentable_id: 11 }]);
    });

    test("delete refuses a record of another Model with the same key", async () => {
      const db = harness.connect();
      const post = await db.model(Post).find(10);
      const onPhoto = await db.model(Remark).find(2);

      await expect(post.remarks().delete(onPhoto)).rejects.toThrow(
        new TypeError("Post.remarks doesn't hold this Remark: it belongs to a Photo"),
      );
    });
  });

  describe("saving through a polymorphic belongsTo", () => {
    class RequiredRemark extends Remark {
      override commentable = belongsTo([Post, Photo]);
    }

    test("its record is required: must exist", async () => {
      const db = harness.connect();
      const orphan = db.model(RequiredRemark).build({ id: 4, body: "x" });
      const missing = db
        .model(RequiredRemark)
        .build({ id: 5, body: "x", commentableType: "Photo", commentableId: 99 });

      expect(await orphan.save()).toBe(false);
      expect(orphan.errors.fullMessages()).toEqual(["Commentable must exist"]);
      expect(await missing.save()).toBe(false);
      expect(missing.errors.fullMessages()).toEqual(["Commentable must exist"]);
    });

    test("changing only its type checks the record again", async () => {
      await harness.exec("DELETE FROM remarks WHERE id = 2");
      await harness.exec("DELETE FROM photos");
      const db = harness.connect();
      const remark = await db.model(RequiredRemark).find(1);

      remark.commentableType = "Photo";

      expect(await remark.save()).toBe(false);
      expect(remark.errors.fullMessages()).toEqual(["Commentable must exist"]);
    });

    test("a new record set through it is saved first, its generated key filled in", async () => {
      const db = harness.connect();
      const remark = db.model(RequiredRemark).build({ id: 4, body: "On a new photo" });
      const photo = db.model(Photo).build({ title: "New" });

      remark.commentable.set(photo);
      await remark.saveOrThrow();

      expect(photo.isPersisted()).toBe(true);
      expect([remark.commentableType, remark.commentableId]).toEqual(["Photo", photo.id]);
      const rows = await harness.exec(
        "SELECT commentable_type, commentable_id FROM remarks WHERE id = 4",
      );
      expect(rows).toEqual([{ commentable_type: "Photo", commentable_id: photo.id }]);
    });
  });
});
