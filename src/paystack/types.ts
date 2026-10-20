export interface InitializeResult {
  authorization_url: string;
  reference: string;
  access_code: string;
}

/**
 * `not_found` is Paystack's answer when a link was created but never opened.
 * It is not an error — it means "no completed payment yet", and the skill is
 * told to word it that way.
 */
export type VerifyStatus =
  | "success"
  | "failed"
  | "abandoned"
  | "pending"
  | "reversed"
  | "not_found";

export interface VerifyResult {
  status: VerifyStatus;
  reference: string;
  amountNgn: number;
  paidAt?: string;
  channel?: string;
  gatewayResponse?: string;
}

/** Thrown only for "we could not get an answer"; business outcomes are returned. */
export class PaystackUnreachableError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "PaystackUnreachableError";
  }
}
