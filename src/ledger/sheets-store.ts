import { google, type sheets_v4 } from "googleapis";
import { columnIndex, columnLetter, type Table, type TableStore, type TabName } from "./store.js";

export interface SheetsStoreOptions {
  sheetId: string;
  clientEmail: string;
  privateKey: string;
}

/**
 * Google Sheets ledger — the tab the owner actually opens.
 *
 * Auth is a service-account JWT, not OAuth: Chord's `oauth` auth type needs
 * dynamic client registration and Google does not support it, so the sheet is
 * reached from our own server with its own credentials instead.
 */
export class SheetsStore implements TableStore {
  readonly backend = "sheets" as const;
  private readonly sheetId: string;
  private readonly api: sheets_v4.Sheets;

  constructor(options: SheetsStoreOptions) {
    this.sheetId = options.sheetId;
    const auth = new google.auth.JWT({
      email: options.clientEmail,
      key: options.privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    this.api = google.sheets({ version: "v4", auth });
  }

  async readTable(tab: TabName): Promise<Table> {
    const response = await this.api.spreadsheets.values.get({
      spreadsheetId: this.sheetId,
      range: tab,
      // Read what is displayed, so a date cell comes back as "2026-10-20"
      // rather than a Sheets serial number like 46316.
      valueRenderOption: "FORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });
    const values = (response.data.values ?? []) as string[][];
    if (values.length === 0) {
      throw new Error(`Tab "${tab}" is empty or missing in the ledger sheet.`);
    }
    const [header = [], ...rows] = values;
    // Sheets truncates trailing empty cells; pad so column lookups stay valid.
    const padded = rows
      .filter((row) => row.some((value) => (value ?? "").trim() !== ""))
      .map((row) => {
        const copy = [...row];
        while (copy.length < header.length) copy.push("");
        return copy;
      });
    return { header, rows: padded };
  }

  async appendRow(tab: TabName, row: string[]): Promise<void> {
    await this.api.spreadsheets.values.append({
      spreadsheetId: this.sheetId,
      range: tab,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
  }

  async patchRow(tab: TabName, rowIndex: number, patch: Record<string, string>): Promise<void> {
    const { header } = await this.readTable(tab);
    // +2: one for the header row, one because A1 notation is 1-based.
    const sheetRow = rowIndex + 2;
    const data = Object.entries(patch).map(([column, value]) => {
      const letter = columnLetter(columnIndex(header, column));
      return { range: `${tab}!${letter}${sheetRow}`, values: [[value]] };
    });
    await this.api.spreadsheets.values.batchUpdate({
      spreadsheetId: this.sheetId,
      requestBody: { valueInputOption: "RAW", data },
    });
  }
}
