import { ApplicationRecord } from "./application-record";

export class Invoice extends ApplicationRecord {
  static {
    this.afterInitialize((invoice) => {
      if (invoice.isNewRecord()) invoice.currency ??= invoice.country === "GB" ? "GBP" : "USD";
    });
    this.afterFind((invoice) => {
      // A record loaded with select() may leave totalCents out.
      if (invoice.hasAttribute("totalCents") && invoice.totalCents > 1_000_000) {
        console.log(`Large invoice ${invoice.id} loaded`);
      }
    });
  }
}
