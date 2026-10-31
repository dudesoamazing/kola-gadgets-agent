import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import { config, configProblems } from "./config.js";
import { registerDemoRoutes } from "./demo.js";
import { getLedger } from "./ledger/index.js";
import { registerMockCheckout } from "./mock-checkout.js";
import { createMcpServer } from "./server.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.disable("x-powered-by");

/**
 * The public URL of this server, used for the mock checkout link. Render and
 * Railway both set it; otherwise fall back to the forwarded host, then local.
 */
function publicBaseUrl(req?: Request): string {
  const configured =
    process.env["PUBLIC_BASE_URL"] ??
    (process.env["RENDER_EXTERNAL_URL"] ? process.env["RENDER_EXTERNAL_URL"] : undefined) ??
    (process.env["RAILWAY_PUBLIC_DOMAIN"]
      ? `https://${process.env["RAILWAY_PUBLIC_DOMAIN"]}`
      : undefined);
  if (configured) return configured.replace(/\/$/, "");
  if (req) {
    const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol;
    return `${proto}://${req.headers.host}`;
  }
  return `http://localhost:${config.port}`;
}

/**
 * Chord sends `Authorization: Bearer <token>` when the tool is registered with
 * auth_type "bearer". Checked with a length-safe comparison on every MCP request.
 */
function bearerOk(req: Request): boolean {
  if (!config.bearerToken) return false;
  const header = req.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match?.[1]) return false;
  const given = Buffer.from(match[1].trim());
  const expected = Buffer.from(config.bearerToken);
  if (given.length !== expected.length) return false;
  return given.equals(expected);
}

// -------------------------------------------------------------------- live --
/**
 * Lightweight liveness probe used by Render's healthCheckPath.
 * Returns 200 immediately without hitting Google Sheets or Paystack so
 * external slowdowns never trigger service restarts.
 */
app.get("/live", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

// ------------------------------------------------------------------ health --
interface CachedLedgerHealth {
  status: "ok" | "error";
  error?: string;
  checkedAt: number;
}

let cachedLedgerHealth: CachedLedgerHealth | null = null;
let inFlightLedgerHealth: Promise<CachedLedgerHealth> | null = null;
let lastLoggedHealthError: string | null = null;
const LEDGER_HEALTH_TTL_MS = 60_000;

async function checkLedgerHealth(): Promise<CachedLedgerHealth> {
  const now = Date.now();
  if (cachedLedgerHealth && now - cachedLedgerHealth.checkedAt < LEDGER_HEALTH_TTL_MS) {
    return cachedLedgerHealth;
  }
  if (inFlightLedgerHealth) {
    return inFlightLedgerHealth;
  }

  inFlightLedgerHealth = (async () => {
    let status: "ok" | "error" = "ok";
    let errorMsg: string | undefined;

    let timer: NodeJS.Timeout | undefined;
    const healthTimeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Ledger healthCheck timed out after 5000ms")), 5000);
    });

    try {
      await Promise.race([getLedger().healthCheck(), healthTimeout]);
      status = "ok";
      lastLoggedHealthError = null;
    } catch (error) {
      status = "error";
      errorMsg = error instanceof Error ? error.message : String(error);
      if (lastLoggedHealthError !== errorMsg) {
        console.error("Health check error:", errorMsg);
        lastLoggedHealthError = errorMsg;
      }
    } finally {
      if (timer) clearTimeout(timer);
      inFlightLedgerHealth = null;
    }

    const result: CachedLedgerHealth = {
      status,
      error: errorMsg,
      checkedAt: Date.now(),
    };
    cachedLedgerHealth = result;
    return result;
  })();

  return inFlightLedgerHealth;
}

/**
 * Note for whoever reads this next: Chord's own health probe returns HTTP 200
 * even when the check failed, so read the `status` field, not the status code.
 * Ours does the opposite — a broken ledger returns 503 — so both are obvious.
 */
app.get(["/", "/health"], async (_req: Request, res: Response) => {
  const problems = configProblems();
  const { status: ledgerStatus, error: ledgerError } = await checkLedgerHealth();

  const healthy = ledgerStatus === "ok" && problems.length === 0;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    service: "kola-gadgets-payments",
    ledger: { backend: config.ledgerBackend, status: ledgerStatus, error: ledgerError },
    paystack: { mode: config.paystack.mode },
    config_problems: problems,
    time: new Date().toISOString(),
  });
});

// --------------------------------------------------------------------- MCP --
app.post("/mcp", async (req: Request, res: Response) => {
  if (!bearerOk(req)) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized: missing or invalid bearer token." },
      id: null,
    });
    return;
  }

  // Stateless: one server and transport per request, closed when it ends.
  const server = createMcpServer(() => publicBaseUrl(req));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // Reply with a plain JSON body instead of an SSE stream. The SDK prefers
    // SSE, but there is nothing to stream — one request, one response — and
    // JSON is readable with curl and safer with any client that handles
    // text/event-stream badly. Chord accepts either.
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[mcp] request failed:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error." },
        id: null,
      });
    }
  }
});

// GET and DELETE on /mcp are for SSE streams and session teardown, neither of
// which a stateless server supports. Say so rather than hanging.
app.all("/mcp", (req: Request, res: Response) => {
  if (req.method === "POST") return;
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: `${req.method} is not supported — this server is stateless. Use POST.` },
    id: null,
  });
});

if (config.paystack.mode === "mock") {
  registerMockCheckout(app);
}

registerDemoRoutes(app);

const problems = configProblems();
if (problems.length > 0) {
  console.error("Configuration problems:");
  for (const problem of problems) console.error(`  - ${problem}`);
  // A missing bearer token would leave the tools open to anyone who finds the
  // URL, so refuse to start rather than serve something unsafe.
  if (!config.bearerToken) process.exit(1);
}

app.listen(config.port, "0.0.0.0", () => {
  console.log(`kola-gadgets-payments MCP server on :${config.port}`);
  console.log(`  ledger   ${config.ledgerBackend}`);
  console.log(`  paystack ${config.paystack.mode}`);
  console.log(`  endpoint ${publicBaseUrl()}/mcp`);
});
