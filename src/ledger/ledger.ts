import { normalisePhone, samePhone } from "../lib/format.js";
import { cell, type TableStore } from "./store.js";
import type { Flag, Invoice, Ledger, Payment, PaymentStatus, Person, Role } from "./types.js";

/**
 * The sheet is typed by a human, so amounts may arrive as "2,400,000" or even
 * "₦2,400,000". Strip anything that is not a digit, dot or minus sign.
 */
function parseAmount(value: string): number {
  if (value.trim() === "") return 0;
  const cleaned = value.replace(/[^\d.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** "yes", "y", "true", "TRUE" all mean collected. Anything else does not. */
function parseBoolean(value: string): boolean {
  return ["yes", "y", "true", "1"].includes(value.trim().toLowerCase());
}

function parseRole(value: string): Role | undefined {
  const role = value.trim().toLowerCase();
  return role === "owner" || role === "staff" || role === "reseller" ? role : undefined;
}

function parsePaymentStatus(value: string): PaymentStatus {
  const status = value.trim().toLowerCase();
  if (status === "success" || status === "failed" || status === "abandoned") return status;
  return "pending";
}

/** Oldest first, by pickup date then invoice id — the part-payment rule. */
export function byOldestFirst(a: Invoice, b: Invoice): number {
  const dates = a.created_at.localeCompare(b.created_at);
  return dates !== 0 ? dates : a.invoice_id.localeCompare(b.invoice_id);
}

export class TableLedger implements Ledger {
  constructor(private readonly store: TableStore) {}

  get backend() {
    return this.store.backend;
  }

  async findPerson(phone: string): Promise<Person | undefined> {
    const wanted = normalisePhone(phone);
    if (wanted === "") return undefined;
    const { header, rows } = await this.store.readTable("People");
    for (const row of rows) {
      if (normalisePhone(cell(row, header, "phone")) !== wanted) continue;
      const role = parseRole(cell(row, header, "role"));
      if (!role) continue; // a typo in the role column must not grant access

      // primary_phone is optional, so an older sheet without the column still works.
      let primary = "";
      try {
        primary = normalisePhone(cell(row, header, "primary_phone"));
      } catch {
        primary = "";
      }
      // A row pointing at itself, or at a number that is not a person, would
      // silently hide a balance. Ignore it and fall back to this number.
      const linked = primary !== "" && primary !== wanted ? primary : "";

      // A second-line row may leave name and email blank. Paystack needs an
      // email, so fall back to the primary row rather than failing later.
      let name = cell(row, header, "name");
      let email = cell(row, header, "email");
      if (linked && (name === "" || email === "")) {
        const primaryRow = rows.find(
          (candidate) => normalisePhone(cell(candidate, header, "phone")) === linked,
        );
        if (primaryRow) {
          if (name === "") name = cell(primaryRow, header, "name");
          if (email === "") email = cell(primaryRow, header, "email");
        }
      }

      return {
        phone: wanted,
        name,
        role,
        email,
        ...(linked ? { primary_phone: linked } : {}),
        ledger_phone: linked || wanted,
      };
    }
    return undefined;
  }

  async listInvoices(): Promise<Invoice[]> {
    const { header, rows } = await this.store.readTable("Invoices");
    return rows.map((row) => ({
      invoice_id: cell(row, header, "invoice_id"),
      reseller_phone: normalisePhone(cell(row, header, "reseller_phone")),
      items: cell(row, header, "items"),
      amount_ngn: parseAmount(cell(row, header, "amount_ngn")),
      amount_paid_ngn: parseAmount(cell(row, header, "amount_paid_ngn")),
      created_at: cell(row, header, "created_at"),
      collected: parseBoolean(cell(row, header, "collected")),
      collected_at: cell(row, header, "collected_at"),
      collected_by: cell(row, header, "collected_by"),
    }));
  }

  async listInvoicesFor(phone: string): Promise<Invoice[]> {
    const invoices = await this.listInvoices();
    return invoices.filter((invoice) => samePhone(invoice.reseller_phone, phone)).sort(byOldestFirst);
  }

  async findInvoice(invoiceId: string): Promise<Invoice | undefined> {
    const wanted = normaliseInvoiceId(invoiceId);
    const invoices = await this.listInvoices();
    return invoices.find((invoice) => normaliseInvoiceId(invoice.invoice_id) === wanted);
  }

  async updateInvoice(invoiceId: string, patch: Partial<Invoice>): Promise<void> {
    const wanted = normaliseInvoiceId(invoiceId);
    const { header, rows } = await this.store.readTable("Invoices");
    const rowIndex = rows.findIndex(
      (row) => normaliseInvoiceId(cell(row, header, "invoice_id")) === wanted,
    );
    if (rowIndex === -1) throw new Error(`Invoice ${invoiceId} is not in the ledger.`);

    const cells: Record<string, string> = {};
    if (patch.amount_paid_ngn !== undefined) {
      cells["amount_paid_ngn"] = String(Math.round(patch.amount_paid_ngn));
    }
    if (patch.collected !== undefined) cells["collected"] = patch.collected ? "yes" : "no";
    if (patch.collected_at !== undefined) cells["collected_at"] = patch.collected_at;
    if (patch.collected_by !== undefined) cells["collected_by"] = patch.collected_by;
    if (Object.keys(cells).length === 0) return;
    await this.store.patchRow("Invoices", rowIndex, cells);
  }

  async findPayment(reference: string): Promise<Payment | undefined> {
    const wanted = reference.trim().toUpperCase();
    const { header, rows } = await this.store.readTable("Payments");
    for (const row of rows) {
      if (cell(row, header, "reference").toUpperCase() !== wanted) continue;
      return {
        reference: cell(row, header, "reference"),
        reseller_phone: normalisePhone(cell(row, header, "reseller_phone")),
        invoice_ids: splitInvoiceIds(cell(row, header, "invoice_ids")),
        amount_ngn: parseAmount(cell(row, header, "amount_ngn")),
        status: parsePaymentStatus(cell(row, header, "status")),
        link: cell(row, header, "link"),
        created_at: cell(row, header, "created_at"),
        verified_at: cell(row, header, "verified_at"),
      };
    }
    return undefined;
  }

  async appendPayment(payment: Payment): Promise<void> {
    await this.store.appendRow("Payments", [
      payment.reference,
      payment.reseller_phone,
      payment.invoice_ids.join(","),
      String(Math.round(payment.amount_ngn)),
      payment.status,
      payment.link,
      payment.created_at,
      payment.verified_at,
    ]);
  }

  async updatePayment(reference: string, patch: Partial<Payment>): Promise<void> {
    const wanted = reference.trim().toUpperCase();
    const { header, rows } = await this.store.readTable("Payments");
    const rowIndex = rows.findIndex(
      (row) => cell(row, header, "reference").toUpperCase() === wanted,
    );
    if (rowIndex === -1) throw new Error(`Payment ${reference} is not in the ledger.`);

    const cells: Record<string, string> = {};
    if (patch.status !== undefined) cells["status"] = patch.status;
    if (patch.verified_at !== undefined) cells["verified_at"] = patch.verified_at;
    if (patch.link !== undefined) cells["link"] = patch.link;
    if (patch.amount_ngn !== undefined) cells["amount_ngn"] = String(Math.round(patch.amount_ngn));
    if (Object.keys(cells).length === 0) return;
    await this.store.patchRow("Payments", rowIndex, cells);
  }

  async appendFlag(flag: Flag): Promise<void> {
    await this.store.appendRow("Flags", [
      flag.created_at,
      flag.phone,
      flag.invoice_id,
      flag.summary,
    ]);
  }

  async healthCheck(): Promise<void> {
    await this.store.readTable("People");
  }
}

/** Resellers write "inv 104", "104", "INV-104". Compare on the digits. */
export function normaliseInvoiceId(input: string): string {
  const trimmed = (input ?? "").trim().toUpperCase();
  const digits = trimmed.replace(/\D/g, "");
  return digits === "" ? trimmed : `INV-${digits}`;
}

export function splitInvoiceIds(value: string): string[] {
  return value
    .split(/[,;|]/)
    .map((id) => id.trim())
    .filter((id) => id !== "");
}
