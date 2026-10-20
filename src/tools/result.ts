/**
 * Every tool answers with JSON the model can read, never an exception.
 *
 * The skill is written against these `error` codes, so a failure produces a
 * specific sentence to the reseller instead of the agent inventing one. The
 * `message` field is a plain-English hint for the model, not copy to send.
 */
export type ErrorCode =
  | "unknown_sender"
  | "not_permitted"
  | "not_found"
  | "invalid_amount"
  | "nothing_outstanding"
  | "already_paid"
  | "already_collected"
  | "not_fully_paid"
  | "paystack_unreachable"
  | "ledger_unreachable"
  | "bad_input";

export function ok<T extends Record<string, unknown>>(payload: T) {
  return asContent({ ok: true, ...payload });
}

export function fail(error: ErrorCode, message: string, extra: Record<string, unknown> = {}) {
  return asContent({ ok: false, error, message, ...extra });
}

/** MCP tool-result envelope. Pretty-printed because a human reads these in logs. */
function asContent(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

/**
 * Last line of defence. A tool must not throw at Chord — an unhandled error
 * becomes a transport-level failure the skill has no wording for.
 */
export async function guard<T>(
  run: () => Promise<T>,
): Promise<T | ReturnType<typeof fail>> {
  try {
    return await run();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[tool] unhandled error:", detail);
    return fail(
      "ledger_unreachable",
      `The ledger or payment system could not be reached: ${detail}. Nothing was changed.`,
    );
  }
}
