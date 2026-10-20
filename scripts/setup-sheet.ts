/**
 * Create the four ledger tabs in the Google Sheet and fill them from data/*.csv.
 *
 *   npm run setup:sheet          # refuses if a tab already has rows
 *   npm run setup:sheet -- --force   # clears and re-seeds
 *
 * Also the quickest way to find out whether the service account can actually
 * reach the sheet — a 403 here means the sheet was never shared with
 * GOOGLE_SERVICE_ACCOUNT_EMAIL.
 */
import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import { config } from "../src/config.js";
import { parseCsv } from "../src/ledger/csv-store.js";
import type { TabName } from "../src/ledger/store.js";

const TABS: Array<{ tab: TabName; file: string }> = [
  { tab: "People", file: "people.csv" },
  { tab: "Invoices", file: "invoices.csv" },
  { tab: "Payments", file: "payments.csv" },
  { tab: "Flags", file: "flags.csv" },
];

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const { sheetId, clientEmail, privateKey } = config.sheets;
  if (!sheetId || !clientEmail || !privateKey) {
    console.error(
      "Set GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env first.",
    );
    process.exit(1);
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  console.log(`Sheet: ${meta.data.properties?.title}`);
  const existing = new Set(
    (meta.data.sheets ?? []).map((sheet) => sheet.properties?.title ?? "").filter(Boolean),
  );

  // Add any missing tabs in one batch.
  const toCreate = TABS.filter(({ tab }) => !existing.has(tab));
  if (toCreate.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: toCreate.map(({ tab }) => ({ addSheet: { properties: { title: tab } } })),
      },
    });
    console.log(`Created tabs: ${toCreate.map((t) => t.tab).join(", ")}`);
  }

  for (const { tab, file } of TABS) {
    const current = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: tab });
    const rowCount = (current.data.values ?? []).length;
    if (rowCount > 1 && !force) {
      console.log(`${tab}: ${rowCount - 1} rows already — skipped. Use --force to replace.`);
      continue;
    }

    const rows = parseCsv(fs.readFileSync(path.join(config.csvDir, file), "utf8"));
    await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: tab });
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tab}!A1`,
      // RAW so "+2348020000001" stays text and is not mangled into a number.
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });
    console.log(`${tab}: wrote ${rows.length - 1} rows.`);
  }

  console.log("\nDone. Now set LEDGER_BACKEND=sheets and run `npm run dev`, then check /health.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nFailed: ${message}`);
  if (message.includes("403") || message.toLowerCase().includes("permission")) {
    console.error(
      `\nShare the sheet with ${config.sheets.clientEmail} as an Editor — a service account has no access until you do.`,
    );
  }
  if (message.includes("404")) {
    console.error("\nCheck GOOGLE_SHEET_ID: it is the long id in the sheet URL, between /d/ and /edit.");
  }
  process.exit(1);
});
