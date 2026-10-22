import { randomInt } from "node:crypto";
import { config } from "../config.js";
import { naira } from "../lib/format.js";
import { derivedStatus, outstandingNgn, type Invoice, type Person } from "../ledger/index.js";

/** The invoice shape the agent sees. Pre-formatted amounts stop it doing maths. */
export interface InvoiceView {
  invoice_id: string;
  items: string;
  amount_ngn: number;
  amount_paid_ngn: number;
  outstanding_ngn: number;
  amount_display: string;
  outstanding_display: string;
  status: "paid" | "part_paid" | "unpaid";
  created_at: string;
  collected: boolean;
  collected_at?: string;
  collected_by?: string;
}

/**
 * The invoice shape every tool returns. Deliberately has no `pickup_code`:
 * staff see invoice status through these, and a code staff can read is a code
 * that can release goods without the reseller present. Only
 * `get_pickup_codes` attaches one, and only for the reseller who owns it.
 */
export function invoiceView(invoice: Invoice): InvoiceView {
  const outstanding = outstandingNgn(invoice);
  return {
    invoice_id: invoice.invoice_id,
    items: invoice.items,
    amount_ngn: invoice.amount_ngn,
    amount_paid_ngn: invoice.amount_paid_ngn,
    outstanding_ngn: outstanding,
    amount_display: naira(invoice.amount_ngn),
    outstanding_display: naira(outstanding),
    status: derivedStatus(invoice),
    created_at: invoice.created_at,
    collected: invoice.collected,
    ...(invoice.collected
      ? { collected_at: invoice.collected_at, collected_by: invoice.collected_by }
      : {}),
  };
}

export function isUnsettled(invoice: Invoice): boolean {
  return outstandingNgn(invoice) > 0;
}

/**
 * Spread a payment across invoices, oldest first, capped at each invoice's
 * outstanding amount. Any remainder is returned rather than silently dropped —
 * the caller flags it for the owner.
 */
export function allocateOldestFirst(
  amountNgn: number,
  invoices: Invoice[],
): { allocations: Array<{ invoice: Invoice; appliedNgn: number }>; unallocatedNgn: number } {
  let remaining = amountNgn;
  const allocations: Array<{ invoice: Invoice; appliedNgn: number }> = [];

  for (const invoice of invoices) {
    if (remaining <= 0) break;
    const room = outstandingNgn(invoice);
    if (room <= 0) continue;
    const applied = Math.min(room, remaining);
    allocations.push({ invoice, appliedNgn: applied });
    remaining -= applied;
  }

  return { allocations, unallocatedNgn: remaining };
}

/** Who the sender is, phrased the way the skill expects it. */
export function senderView(person: Person) {
  // Deliberately no PIN and no phone number. The PIN must never reach the
  // model, because anything the model sees it can repeat into the chat.
  return {
    name: person.name,
    role: person.role,
    account_code: person.account_code,
    account_id: person.account_id,
  };
}

export function creditSummary(invoices: Invoice[]) {
  const outstanding = invoices.reduce((total, invoice) => total + outstandingNgn(invoice), 0);
  return {
    total_outstanding_ngn: outstanding,
    total_outstanding_display: naira(outstanding),
    credit_limit_ngn: config.business.creditLimitNgn,
    over_credit_limit: outstanding > config.business.creditLimitNgn,
  };
}

/**
 * A six-digit pickup code, unique among the codes still live in the ledger.
 *
 * `randomInt` rather than `Math.random`: this is the only thing standing
 * between a stranger at the counter and a ₦2.4m laptop, so it should not be
 * predictable from an earlier code.
 */
export function newPickupCode(takenCodes: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = String(randomInt(100_000, 1_000_000));
    if (!takenCodes.has(code)) return code;
  }
  // 50 collisions against a six-digit space means something is very wrong —
  // better to fail loudly than hand out a code that is already in use.
  throw new Error("Could not find an unused pickup code after 50 attempts.");
}

/** Codes that must not be reissued: anything not yet collected. */
export function liveCodes(invoices: Invoice[]): Set<string> {
  return new Set(
    invoices.filter((invoice) => !invoice.collected && invoice.pickup_code !== "").map((i) => i.pickup_code),
  );
}

/**
 * KG-20261020-7F3K2A. Human-readable in the sheet, unique enough for Paystack,
 * and obviously ours when it turns up in a Paystack dashboard.
 */
export function newReference(date = new Date()): string {
  const day = date.toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `KG-${day}-${random}`;
}
