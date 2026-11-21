import { bcryptPassword } from "../bcrypt";
import { ApplicationRecord } from "./application-record";

export class Admin extends ApplicationRecord {
  static override attributes = {
    password: { securePassword: { algorithm: bcryptPassword } },
  } as const;
}
