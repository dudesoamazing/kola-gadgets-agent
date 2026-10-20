export type TabName = "People" | "Invoices" | "Payments" | "Flags";

export interface Table {
  header: string[];
  /** Data rows only. Index 0 is the first row under the header. */
  rows: string[][];
}

/**
 * The narrow storage shape both backends provide: read a tab, append a row,
 * patch cells in a row. Everything else — parsing, status rules, permissions —
 * lives once in TableLedger, so the Sheet and the local CSVs can never drift.
 */
export interface TableStore {
  readonly backend: "sheets" | "csv";
  readTable(tab: TabName): Promise<Table>;
  appendRow(tab: TabName, row: string[]): Promise<void>;
  /** `patch` maps column name → new value. Unlisted columns are untouched. */
  patchRow(tab: TabName, rowIndex: number, patch: Record<string, string>): Promise<void>;
}

export function columnIndex(header: string[], column: string): number {
  const index = header.findIndex((h) => h.trim().toLowerCase() === column.toLowerCase());
  if (index === -1) {
    throw new Error(`Column "${column}" not found. Columns present: ${header.join(", ")}`);
  }
  return index;
}

export function cell(row: string[], header: string[], column: string): string {
  return (row[columnIndex(header, column)] ?? "").trim();
}

/** A1 column letter for a zero-based index: 0 → A, 26 → AA. */
export function columnLetter(index: number): string {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}
