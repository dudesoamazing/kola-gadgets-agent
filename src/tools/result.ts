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
 * Strips secrets and personal data before logging error messages.
 * Account codes are preserved; PINs, pickup codes, references, phones, and tokens are redacted.
 */
function safeErrorSnippet(error: string, rawMessage?: unknown): string {
  if (typeof rawMessage !== "string" || !rawMessage) {
    return error;
  }
  let clean = rawMessage
    .replace(/\bKG-\d{8}-[A-Za-z0-9]+\b/gi, "[ref]")
    .replace(/\b(?!ACC|INV|REF)[A-Z]{3,6}-[A-Z]{3,6}\b/g, "[code]")
    .replace(/\b\d{6}\b/g, "[code]")
    .replace(/\b\d{4}\b/g, "[pin]")
    .replace(/\b[0-9]{11}\b/g, "[phone]")
    .replace(/\bsk_(live|test)_[A-Za-z0-9]+\b/g, "[key]")
    .replace(/\bBearer\s+[A-Za-z0-9_-]+/gi, "Bearer [token]")
    .replace(/\s+/g, " ")
    .trim();

  if (clean.length > 80) {
    clean = clean.slice(0, 77) + "...";
  }
  return `${error}: ${clean}`;
}

/**
 * Last line of defence. Logs one line per call (ISO timestamp, tool name,
 * duration in ms, and ok/error with short message). A tool must not throw
 * at Chord — an unhandled error becomes a transport-level failure the skill
 * has no wording for.
 */
export async function guard<T>(
  toolName: string,
  run: () => Promise<T>,
): Promise<T | ReturnType<typeof fail>> {
  const start = Date.now();
  try {
    const result = await run();
    const duration = Date.now() - start;
    const iso = new Date().toISOString();
    const structured = (result as { structuredContent?: Record<string, unknown> })?.structuredContent;
    if (structured && structured.ok === false) {
      const errCode = typeof structured.error === "string" ? structured.error : "error";
      const errDetail = safeErrorSnippet(errCode, structured.message);
      console.log(`${iso} ${toolName} ${duration}ms error: ${errDetail}`);
    } else {
      console.log(`${iso} ${toolName} ${duration}ms ok`);
    }
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    const detail = error instanceof Error ? error.message : String(error);
    const safeDetail = safeErrorSnippet("ledger_unreachable", detail);
    console.log(`${new Date().toISOString()} ${toolName} ${duration}ms error: ${safeDetail}`);
    return fail(
      "ledger_unreachable",
      `The ledger or payment system could not be reached: ${detail}. Nothing was changed.`,
    );
  }
}
