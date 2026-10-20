import { toKobo } from "../lib/format.js";
import type { InitializeResult, VerifyResult } from "./types.js";

interface MockTransaction {
  reference: string;
  amountKobo: number;
  email: string;
  status: "abandoned" | "success" | "failed";
  paidAt?: string;
}

const transactions = new Map<string, MockTransaction>();

/**
 * Stand-in for Paystack test mode, used when PAYSTACK_SECRET_KEY is absent.
 *
 * Two reasons it exists: the whole flow can be tested before a Paystack
 * account is open, and Paystack test mode caps transaction amounts — Kola's
 * invoices run to ₦2.4m, so the mock is the fallback if a real test
 * transaction is refused for size.
 *
 * It is in-memory on purpose: a restart clears it, which is exactly the
 * behaviour you want from a fake.
 */
export const mockPaystack = {
  initialize(params: {
    reference: string;
    amountNgn: number;
    email: string;
    publicBaseUrl: string;
  }): InitializeResult {
    transactions.set(params.reference, {
      reference: params.reference,
      amountKobo: toKobo(params.amountNgn),
      email: params.email,
      status: "abandoned",
    });
    return {
      authorization_url: `${params.publicBaseUrl}/mock/checkout/${encodeURIComponent(params.reference)}`,
      reference: params.reference,
      access_code: `mock_${params.reference}`,
    };
  },

  verify(reference: string): VerifyResult {
    const transaction = transactions.get(reference);
    if (!transaction) {
      return { status: "not_found", reference, amountNgn: 0 };
    }
    return {
      status: transaction.status,
      reference,
      amountNgn: transaction.amountKobo / 100,
      paidAt: transaction.paidAt,
      channel: transaction.status === "success" ? "mock" : undefined,
    };
  },

  /** Called by the /mock/checkout page to simulate the reseller's action. */
  settle(reference: string, outcome: "success" | "failed"): MockTransaction | undefined {
    const transaction = transactions.get(reference);
    if (!transaction) return undefined;
    transaction.status = outcome;
    transaction.paidAt = outcome === "success" ? new Date().toISOString() : undefined;
    return transaction;
  },

  get(reference: string): MockTransaction | undefined {
    return transactions.get(reference);
  },
};
