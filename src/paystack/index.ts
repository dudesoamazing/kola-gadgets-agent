import { config } from "../config.js";
import { fromKobo, toKobo } from "../lib/format.js";
import { mockPaystack } from "./mock.js";
import {
  PaystackUnreachableError,
  type InitializeResult,
  type VerifyResult,
  type VerifyStatus,
} from "./types.js";

const TIMEOUT_MS = 15_000;

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data?: T;
}

async function call<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<{ httpStatus: number; envelope: PaystackEnvelope<T> }> {
  const url = `${config.paystack.baseUrl}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${config.paystack.secretKey}`,
        "Content-Type": "application/json",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // DNS failure, TLS failure, or our 15s timeout. We genuinely do not know
    // the outcome, so the caller must not guess one.
    throw new PaystackUnreachableError(
      "Could not reach Paystack.",
      error instanceof Error ? error.message : String(error),
    );
  }

  const text = await response.text();
  let envelope: PaystackEnvelope<T>;
  try {
    envelope = JSON.parse(text) as PaystackEnvelope<T>;
  } catch {
    throw new PaystackUnreachableError(
      `Paystack returned a non-JSON response (HTTP ${response.status}).`,
      text.slice(0, 300),
    );
  }
  return { httpStatus: response.status, envelope };
}

interface InitializeData {
  authorization_url: string;
  access_code: string;
  reference: string;
}

interface VerifyData {
  status: string;
  reference: string;
  amount: number;
  paid_at: string | null;
  channel: string | null;
  gateway_response: string | null;
}

export interface InitializeParams {
  reference: string;
  amountNgn: number;
  email: string;
  publicBaseUrl: string;
  metadata: Record<string, unknown>;
}

export async function initializeTransaction(params: InitializeParams): Promise<InitializeResult> {
  if (config.paystack.mode === "mock") {
    return mockPaystack.initialize(params);
  }

  const { httpStatus, envelope } = await call<InitializeData>("/transaction/initialize", {
    method: "POST",
    body: {
      email: params.email,
      // Paystack takes kobo. ₦2,400,000 → 240000000.
      amount: toKobo(params.amountNgn),
      // Our own reference, so verify_payment can look the row up in the ledger.
      reference: params.reference,
      currency: "NGN",
      metadata: params.metadata,
    },
  });

  if (!envelope.status || !envelope.data) {
    // A rejected initialize (bad key, amount above the test-mode cap) is a
    // real answer, not a connection problem — but the caller cannot proceed,
    // so it is still raised. The message carries Paystack's own words.
    throw new PaystackUnreachableError(
      `Paystack refused to create the payment link: ${envelope.message}`,
      `HTTP ${httpStatus}`,
    );
  }

  return {
    authorization_url: envelope.data.authorization_url,
    reference: envelope.data.reference ?? params.reference,
    access_code: envelope.data.access_code,
  };
}

function mapVerifyStatus(raw: string): VerifyStatus {
  switch (raw.toLowerCase()) {
    case "success":
      return "success";
    case "failed":
      return "failed";
    case "abandoned":
      return "abandoned";
    case "reversed":
      return "reversed";
    case "ongoing":
    case "pending":
    case "processing":
    case "queued":
      return "pending";
    default:
      return "failed";
  }
}

export async function verifyTransaction(reference: string): Promise<VerifyResult> {
  if (config.paystack.mode === "mock") {
    return mockPaystack.verify(reference);
  }

  const { httpStatus, envelope } = await call<VerifyData>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    { method: "GET" },
  );

  // 404 means Paystack has never seen an attempt on this reference — the link
  // was created but not opened. That is "nothing paid yet", not a failure.
  if (httpStatus === 404) {
    return { status: "not_found", reference, amountNgn: 0 };
  }

  if (!envelope.status || !envelope.data) {
    throw new PaystackUnreachableError(
      `Paystack could not verify ${reference}: ${envelope.message}`,
      `HTTP ${httpStatus}`,
    );
  }

  const data = envelope.data;
  return {
    status: mapVerifyStatus(data.status),
    reference: data.reference ?? reference,
    amountNgn: fromKobo(data.amount ?? 0),
    paidAt: data.paid_at ?? undefined,
    channel: data.channel ?? undefined,
    gatewayResponse: data.gateway_response ?? undefined,
  };
}

export { PaystackUnreachableError };
export type { InitializeResult, VerifyResult, VerifyStatus };
