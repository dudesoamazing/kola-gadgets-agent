import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import { config } from "../config.js";
import { parseCsv } from "./csv-store.js";
import type { TabName } from "./store.js";

export const LEDGER_TABS: Array<{ tab: TabName; file: string }> = [
  { tab: "People", file: "people.csv" },
  { tab: "Invoices", file: "invoices.csv" },
  { tab: "Payments", file: "payments.csv" },
  { tab: "Flags", file: "flags.csv" },
];

export interface ReseedSheetsOptions {
  force?: boolean;
  verbose?: boolean;
}

/**
 * Reseeds the Google Sheets ledger from data/*.csv.
 * Shared between scripts/setup-sheet.ts and the demo reset endpoint.
 */
export async function reseedSheets(options: ReseedSheetsOptions = {}): Promise<void> {
  const { force = true, verbose = false } = options;
  const { sheetId, clientEmail, privateKey } = config.sheets;
  if (!sheetId || !clientEmail || !privateKey) {
    throw new Error(
      "Set GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env first.",
    );
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  if (verbose) {
    console.log(`Sheet: ${meta.data.properties?.title}`);
  }
  const existing = new Set(
    (meta.data.sheets ?? []).map((sheet) => sheet.properties?.title ?? "").filter(Boolean),
  );

  const toCreate = LEDGER_TABS.filter(({ tab }) => !existing.has(tab));
  if (toCreate.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: toCreate.map(({ tab }) => ({ addSheet: { properties: { title: tab } } })),
      },
    });
    if (verbose) {
      console.log(`Created tabs: ${toCreate.map((t) => t.tab).join(", ")}`);
    }
  }

  const seedDir = path.resolve(process.cwd(), "data");
  for (const { tab, file } of LEDGER_TABS) {
    const current = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: tab });
    const rowCount = (current.data.values ?? []).length;
    if (rowCount > 1 && !force) {
      if (verbose) {
        console.log(`${tab}: ${rowCount - 1} rows already — skipped. Use --force to replace.`);
      }
      continue;
    }

    const rows = parseCsv(fs.readFileSync(path.join(seedDir, file), "utf8"));
    await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: tab });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tab}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });
    if (verbose) {
      console.log(`${tab}: wrote ${rows.length - 1} rows.`);
    }
  }
}

/**
 * Reseeds local CSV files from data/*.csv.
 */
export function reseedCsv(targetDir = config.csvDir): void {
  const seedDir = path.resolve(process.cwd(), "data");
  for (const { file } of LEDGER_TABS) {
    const src = path.join(seedDir, file);
    const dst = path.join(targetDir, file);
    fs.copyFileSync(src, dst);
  }
}

/**
 * Reseeds the active ledger backend (sheets or csv) from data/*.csv.
 */
export async function reseedLedger(): Promise<void> {
  if (config.ledgerBackend === "sheets") {
    await reseedSheets({ force: true, verbose: false });
  } else {
    reseedCsv();
  }
}

