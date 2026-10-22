import { timingSafeEqual } from "node:crypto";
import { normaliseAccountCode, normalisePhone, normalisePin } from "../lib/format.js";
import { cell, optionalCell, type TableStore } from "./store.js";
import type { AuthResult, Flag, Invoice, Ledger, Payment, PaymentStatus, Role } from "./types.js";

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

/**
 * Constant-time PIN comparison. A 4-digit PIN is small enough that timing
 * leaks are not the real risk here, but there is no reason to hand one over.
 */
function pinsMatch(stored: string, given: string): boolean {
  const a = Buffer.from(stored);
  const b = Buffer.from(given);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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

  /**
   * Account code plus PIN, checked together. Returns the person or a reason,
   * and never the PIN — there is no getter for it anywhere in the codebase.
   */
  async authenticate(accountCode: string, pin: string): Promise<AuthResult> {
    const wantedCode = normaliseAccountCode(accountCode);
    const wantedPin = normalisePin(pin);
    if (wantedCode === "" || wantedPin === "") return { ok: false, reason: "unknown_code" };

    const { header, rows } = await this.store.readTable("People");
    for (const row of rows) {
      if (normaliseAccountCode(cell(row, header, "account_code")) !== wantedCode) continue;

      const role = parseRole(cell(row, header, "role"));
      if (!role) continue; // a typo in the role column must not grant access

      const storedPin = normalisePin(cell(row, header, "pin"));
      // A blank PIN cell must never mean "no PIN required".
      if (storedPin === "" || !pinsMatch(storedPin, wantedPin)) {
        return { ok: false, reason: "bad_pin" };
      }

      const account = optionalCell(row, header, "account_id");
      return {
        ok: true,
        person: {
          // The code as Kola wrote it ("KG-ADA"), not the squashed form we
          // compare on ("KGADA") — this is what the agent says out loud.
          account_code: cell(row, header, "account_code").trim().toUpperCase(),
          name: cell(row, header, "name"),
          role,
          email: cell(row, header, "email"),
          // Fall back to the code so a blank account_id cannot silently
          // match every other blank-account row in the sheet.
          account_id: (account !== "" ? account : `ACC-${wantedCode}`).toUpperCase(),
          phone: normalisePhone(optionalCell(row, header, "phone")),
        },
      };
    }
    return { ok: false, reason: "unknown_code" };
  }

  async listInvoices(): Promise<Invoice[]> {
    const { header, rows } = await this.store.readTable("Invoices");
    return rows.map((row) => ({
      invoice_id: cell(row, header, "invoice_id"),
      account_id: cell(row, header, "account_id").toUpperCase(),
      items: cell(row, header, "items"),
      amount_ngn: parseAmount(cell(row, header, "amount_ngn")),
      amount_paid_ngn: parseAmount(cell(row, header, "amount_paid_ngn")),
      created_at: cell(row, header, "created_at"),
      collected: parseBoolean(cell(row, header, "collected")),
      collected_at: cell(row, header, "collected_at"),
      collected_by: cell(row, header, "collected_by"),
    }));
  }

  async listInvoicesForAccount(accountId: string): Promise<Invoice[]> {
    const wanted = accountId.trim().toUpperCase();
    const invoices = await this.listInvoices();
    return invoices.filter((invoice) => invoice.account_id === wanted).sort(byOldestFirst);
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
        account_id: optionalCell(row, header, "account_id").toUpperCase(),
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
      payment.account_id,
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
      flag.account_code,
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
