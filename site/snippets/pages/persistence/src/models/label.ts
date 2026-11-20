import { ApplicationRecord } from "./application-record";

// The UNIQUE index on name keeps it unique, so createOrFindBy can rely on it.
export class Label extends ApplicationRecord {}
