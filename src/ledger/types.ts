export type Role = "owner" | "staff" | "reseller";

export interface Person {
  /** The number this person messaged from. */
  phone: string;
  name: string;
  role: Role;
  email: string;
  /**
   * Set on a second phone to point at the number the invoices are filed under.
   * Resellers in Computer Village routinely carry two lines, and a balance
   * that disappears when they message from the other one is worse than no
   * agent at all. Only the owner can link a number, by editing the sheet.
   */
  primary_phone?: string;
  /** The number to look invoices up by: primary_phone if set, else phone. */
  ledger_phone: string;
}

export interface Invoice {
  invoice_id: string;
  reseller_phone: string;
  items: string;
  amount_ngn: number;
  amount_paid_ngn: number;
  created_at: string;
  collected: boolean;
  collected_at: string;
  collected_by: string;
}

export type PaymentStatus = "pending" | "success" | "failed" | "abandoned";

export interface Payment {
  reference: string;
  reseller_phone: string;
  /** Invoice ids this payment was raised against, in the order shown to the reseller. */
  invoice_ids: string[];
  amount_ngn: number;
  status: PaymentStatus;
  link: string;
  created_at: string;
  verified_at: string;
}

export interface Flag {
  created_at: string;
  phone: string;
  invoice_id: string;
  summary: string;
}

/** Status is derived from the amounts, never stored — one less thing to go stale. */
export type DerivedStatus = "paid" | "part_paid" | "unpaid";

export function outstandingNgn(invoice: Invoice): number {
  return Math.max(0, invoice.amount_ngn - invoice.amount_paid_ngn);
}

export function derivedStatus(invoice: Invoice): DerivedStatus {
  if (invoice.amount_paid_ngn >= invoice.amount_ngn) return "paid";
  if (invoice.amount_paid_ngn > 0) return "part_paid";
  return "unpaid";
}

/**
 * Everything the tools need from the ledger. Two implementations: Google
 * Sheets (what the owner actually looks at) and local CSV (so every tool path
 * can be tested before the Sheet exists).
 */
export interface Ledger {
  readonly backend: "sheets" | "csv";

  findPerson(phone: string): Promise<Person | undefined>;

  listInvoices(): Promise<Invoice[]>;
  listInvoicesFor(phone: string): Promise<Invoice[]>;
  findInvoice(invoiceId: string): Promise<Invoice | undefined>;
  /** Patch a single invoice row. Only the named fields are written. */
  updateInvoice(invoiceId: string, patch: Partial<Invoice>): Promise<void>;

  findPayment(reference: string): Promise<Payment | undefined>;
  appendPayment(payment: Payment): Promise<void>;
  updatePayment(reference: string, patch: Partial<Payment>): Promise<void>;

  appendFlag(flag: Flag): Promise<void>;

  /** Cheap round-trip used by the health endpoint. */
  healthCheck(): Promise<void>;
}
