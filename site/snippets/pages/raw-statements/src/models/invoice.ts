import { ApplicationRecord } from "./application-record";

export class Invoice extends ApplicationRecord {
  static override attributes = {
    paidAt: { type: "datetime", storage: "unixSeconds" }, // an integer column of Unix seconds
  } as const;
}
