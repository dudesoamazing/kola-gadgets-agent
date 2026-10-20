import fs from "node:fs/promises";
import path from "node:path";
import { columnIndex, type Table, type TableStore, type TabName } from "./store.js";

const FILES: Record<TabName, string> = {
  People: "people.csv",
  Invoices: "invoices.csv",
  Payments: "payments.csv",
  Flags: "flags.csv",
};

/** Quote-aware parse — invoice_ids and flag summaries both contain commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((value) => value.trim() !== ""));
}

export function serialiseCsv(rows: string[][]): string {
  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return rows.map((row) => row.map(escape).join(",")).join("\n") + "\n";
}

/**
 * Local CSV ledger. Used for development and for the smoke test, so every tool
 * path can be exercised before the Google Sheet exists. Not for production:
 * writes are last-one-wins and a restart on Render wipes them.
 */
export class CsvStore implements TableStore {
  readonly backend = "csv" as const;

  constructor(private readonly dir: string) {}

  private file(tab: TabName): string {
    return path.join(this.dir, FILES[tab]);
  }

  private async readAll(tab: TabName): Promise<string[][]> {
    const text = await fs.readFile(this.file(tab), "utf8");
    const rows = parseCsv(text);
    if (rows.length === 0) throw new Error(`${FILES[tab]} is empty — it needs a header row.`);
    return rows;
  }

  async readTable(tab: TabName): Promise<Table> {
    const [header = [], ...rows] = await this.readAll(tab);
    return { header, rows };
  }

  async appendRow(tab: TabName, row: string[]): Promise<void> {
    const rows = await this.readAll(tab);
    rows.push(row);
    await fs.writeFile(this.file(tab), serialiseCsv(rows), "utf8");
  }

  async patchRow(tab: TabName, rowIndex: number, patch: Record<string, string>): Promise<void> {
    const rows = await this.readAll(tab);
    const header = rows[0] ?? [];
    const target = rows[rowIndex + 1];
    if (!target) throw new Error(`${tab} row ${rowIndex} does not exist.`);
    for (const [column, value] of Object.entries(patch)) {
      const index = columnIndex(header, column);
      while (target.length <= index) target.push("");
      target[index] = value;
    }
    await fs.writeFile(this.file(tab), serialiseCsv(rows), "utf8");
  }
}
