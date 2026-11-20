import { ApplicationRecord } from "./application-record";

export class Account extends ApplicationRecord {
  static {
    this.validates("email", { presence: true, uniqueness: { caseSensitive: false } });
    this.validates("handle", { length: { minimum: 3, maximum: 30 }, format: /^[a-z0-9_]+$/ });
    this.validates("plan", { inclusion: ["free", "team", "enterprise"] });
    this.validates("seats", { numericality: { onlyInteger: true, greaterThan: 0 } });
    this.validates("website", { format: /^https:\/\//, allowNull: true });
    this.validates("companyName", {
      presence: true,
      if: (account) => account.isCompany === true,
      message: "is required for a company",
    });
  }
}
