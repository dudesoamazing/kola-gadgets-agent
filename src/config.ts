import fs from "node:fs";
import path from "node:path";

/**
 * Minimal .env loader. No dotenv dependency — Render and Railway inject real
 * environment variables, so the file is only read for local runs.
 */
function loadDotEnv(file = ".env"): void {
  const full = path.resolve(process.cwd(), file);
  if (!fs.existsSync(full)) return;
  for (const raw of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue; // real env always wins
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnv();

export type LedgerBackend = "sheets" | "csv";
export type PaystackMode = "live" | "mock";

function env(key: string): string | undefined {
  let value = process.env[key];
  if (!value || value.trim() === "") return undefined;
  value = value.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value !== "" ? value : undefined;
}

/**
 * Google ships service-account private keys with real newlines. Env vars and
 * dashboards usually carry them as the two characters \n, so put them back.
 * Also strip any accidental surrounding quotes.
 */
function normalisePrivateKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  let clean = key.trim();
  if (
    (clean.startsWith('"') && clean.endsWith('"')) ||
    (clean.startsWith("'") && clean.endsWith("'"))
  ) {
    clean = clean.slice(1, -1).trim();
  }
  return clean.replace(/\\n/g, "\n");
}

const ledgerBackend: LedgerBackend =
  (env("LEDGER_BACKEND") as LedgerBackend | undefined) ??
  (env("GOOGLE_SHEET_ID") ? "sheets" : "csv");

const paystackSecret = env("PAYSTACK_SECRET_KEY");
const paystackMode: PaystackMode =
  (env("PAYSTACK_MODE") as PaystackMode | undefined) ??
  (paystackSecret && paystackSecret.startsWith("sk_") ? "live" : "mock");

export const config = {
  port: Number(env("PORT") ?? 3000),
  bearerToken: env("MCP_BEARER_TOKEN"),

  ledgerBackend,
  csvDir: path.resolve(process.cwd(), env("LEDGER_CSV_DIR") ?? "data"),
  sheets: {
    sheetId: env("GOOGLE_SHEET_ID"),
    clientEmail: env("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    privateKey: normalisePrivateKey(env("GOOGLE_PRIVATE_KEY")),
  },

  paystack: {
    mode: paystackMode,
    secretKey: paystackSecret,
    baseUrl: env("PAYSTACK_BASE_URL") ?? "https://api.paystack.co",
    /** Paystack abandons unused transactions; we tell resellers 24 hours. */
    linkExpiryHours: 24,
  },

  business: {
    name: "Kola Gadgets",
    timezone: "Africa/Lagos",
    minPartPaymentNgn: 50_000,
    creditLimitNgn: 5_000_000,
    bankTransferFallback: "Kola Gadgets Ltd · Moniepoint MFB · 0123456789",
  },
} as const;

/** Problems that should stop the server booting, rather than surface mid-chat. */
export function configProblems(): string[] {
  const problems: string[] = [];
  if (!config.bearerToken) {
    problems.push("MCP_BEARER_TOKEN is not set — Chord's bearer auth cannot be checked.");
  }
  if (config.ledgerBackend === "sheets") {
    if (!config.sheets.sheetId) problems.push("LEDGER_BACKEND=sheets but GOOGLE_SHEET_ID is missing.");
    if (!config.sheets.clientEmail) problems.push("LEDGER_BACKEND=sheets but GOOGLE_SERVICE_ACCOUNT_EMAIL is missing.");
    if (!config.sheets.privateKey) problems.push("LEDGER_BACKEND=sheets but GOOGLE_PRIVATE_KEY is missing.");
  }
  if (config.paystack.mode === "live" && !config.paystack.secretKey) {
    problems.push("PAYSTACK_MODE=live but PAYSTACK_SECRET_KEY is missing.");
  }
  if (config.paystack.secretKey && config.paystack.secretKey.startsWith("sk_live")) {
    problems.push("PAYSTACK_SECRET_KEY is a LIVE key. This exercise must use sk_test_ only.");
  }
  return problems;
}
