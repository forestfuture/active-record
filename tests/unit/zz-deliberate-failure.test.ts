import { expect, test } from "vite-plus/test";

// Throwaway (#402): proves a failed shard names its test. Never merged.
test("a deliberately failing test fails", () => {
  expect(1).toBe(2);
});
