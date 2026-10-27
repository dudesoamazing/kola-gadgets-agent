export type Role = "owner" | "staff" | "reseller";

export interface Person {
  /** The code Kola issued, e.g. "KG-ADA". This is the identity handle. */
  account_code: string;
  name: string;
  role: Role;
  email: string;
  /**
   * The account invoices and payments are filed under, e.g. "ACC-ADA".
   * One-to-one with account_code; kept as the ledger's foreign key so the
   * Invoices and Payments tabs don't carry a credential.
   */
  account_id: string;
  /** Contact number for Kola's own use. Never used to identify anyone. */
  phone: string;
}

/**
 * Chord never passes the sender's phone number to a teammate or its tools
 * (confirmed by TSG, 22 Oct), so there is no way to know who is on the other
 * end of a WhatsApp conversation. Identity has to be proven in the chat
 * instead: an owner-issued account code plus a 4-digit PIN, checked on every
 * single call.
 *
 * `reason` is for our logs only. Both failures must read the same to the
 * person in the chat, or the agent becomes an oracle for which codes exist.
 */
export type AuthResult =
  | { ok: true; person: Person }
  | { ok: false; reason: "unknown_code" | "bad_pin" };

export interface Invoice {
  invoice_id: string;
  /** The reseller account that owes this, e.g. "ACC-ADA". */
  account_id: string;
  /**
   * Two words (e.g. "MANGO-TIGER", or legacy 6 digits) the reseller shows at the counter.
   * Issued only when a verified payment settles the invoice in full, and spent the moment staff
   * use it. Blank until then — and never shown to staff by any tool.
   *
   * This is how Computer Village already works: no code, no goods.
   */
  pickup_code: string;
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
  /** The account the money belongs to. Ownership is compared on this. */
  account_id: string;
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
  /** Who raised it, by account code. Blank when nobody could authenticate. */
  account_code: string;
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
 * can be tested without credentials).
 */
export interface Ledger {
  readonly backend: "sheets" | "csv";

  /**
   * Check an account code and PIN together. The PIN never leaves this method —
   * there is deliberately no way to read it back out of the ledger.
   */
  authenticate(accountCode: string, pin: string): Promise<AuthResult>;

  listInvoices(): Promise<Invoice[]>;
  listInvoicesForAccount(accountId: string): Promise<Invoice[]>;
  findInvoice(invoiceId: string): Promise<Invoice | undefined>;
  /** Look an invoice up by the code the reseller read out. */
  findInvoiceByPickupCode(pickupCode: string): Promise<Invoice | undefined>;
  /** Patch a single invoice row. Only the named fields are written. */
  updateInvoice(invoiceId: string, patch: Partial<Invoice>): Promise<void>;

  findPayment(reference: string): Promise<Payment | undefined>;
  listPaymentsForAccount(accountId: string): Promise<Payment[]>;
  appendPayment(payment: Payment): Promise<void>;
  updatePayment(reference: string, patch: Partial<Payment>): Promise<void>;

  appendFlag(flag: Flag): Promise<void>;

  /** Cheap round-trip used by the health endpoint. */
  healthCheck(): Promise<void>;
}
