import { config } from "../config.js";
import { CsvStore } from "./csv-store.js";
import { TableLedger } from "./ledger.js";
import { SheetsStore } from "./sheets-store.js";
import type { Ledger } from "./types.js";

let cached: Ledger | undefined;

/** One ledger per process. Chord may call several tools per reply. */
export function getLedger(): Ledger {
  if (cached) return cached;

  if (config.ledgerBackend === "sheets") {
    const { sheetId, clientEmail, privateKey } = config.sheets;
    if (!sheetId || !clientEmail || !privateKey) {
      throw new Error("Sheets ledger selected but GOOGLE_* credentials are incomplete.");
    }
    cached = new TableLedger(new SheetsStore({ sheetId, clientEmail, privateKey }));
  } else {
    cached = new TableLedger(new CsvStore(config.csvDir));
  }
  return cached;
}

export * from "./types.js";
export { normaliseInvoiceId, byOldestFirst } from "./ledger.js";
