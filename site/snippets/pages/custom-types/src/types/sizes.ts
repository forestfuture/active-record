import { defineType } from "@forestfuture/active-record";

export const sizes = defineType({
  storedAs: "string",
  cast(input) {
    if (Array.isArray(input) && input.every((size) => typeof size === "string")) {
      return input as string[];
    }
    throw new TypeError("sizes are a list of strings");
  },
  serialize: (list) => list.join(","),
  deserialize: (text) => (text === "" ? [] : text.split(",")),
});
