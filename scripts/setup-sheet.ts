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
import { config } from "../src/config.js";
import { reseedSheets } from "../src/ledger/reseed.js";

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  await reseedSheets({ force, verbose: true });
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
