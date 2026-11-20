import { ApplicationRecord } from "./application-record";

// No uniqueness validation: the table's UNIQUE index refuses a taken email.
export class User extends ApplicationRecord {}
