import type { PasswordAlgorithm } from "@forestfuture/active-record";
import bcrypt from "bcryptjs";

/** bcrypt, at a cost of 10. It verifies digests another app made with bcrypt too. */
export const bcryptPassword: PasswordAlgorithm = {
  hash: (password) => bcrypt.hash(password, 10),
  verify: (password, digest) => bcrypt.compare(password, digest),
  maxBytes: 72, // bcrypt reads only a password's first 72 bytes
};
