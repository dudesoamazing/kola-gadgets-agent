import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { reseedLedger } from "./ledger/reseed.js";
import { resetMockPaystack } from "./paystack/mock.js";
import { resetToolState } from "./tools/index.js";

let lastResetTimestamp = 0;
const RESET_WINDOW_MS = 60_000;

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Demo reset · Kola Gadgets</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      max-width: 520px;
      margin: 60px auto;
      padding: 0 20px;
      line-height: 1.5;
      color: #111827;
      background: #f9fafb;
    }
    .card {
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 24px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    h1 {
      font-size: 1.25rem;
      margin: 0 0 12px;
      color: #1d326d;
    }
    p {
      margin: 0;
      color: #374151;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Demo reset</h1>
    <p>Demo reset. Ada owes ₦4,360,000 again and all locks are cleared. You can start testing.</p>
  </div>
</body>
</html>`;

export function registerDemoRoutes(app: Express): void {
  app.get("/demo/reset", async (req: Request, res: Response) => {
    // Only exists when DEMO_MODE=true. Otherwise 404, so it can never run in production.
    if (process.env["DEMO_MODE"] !== "true") {
      res.status(404).type("text/plain").send("Not Found");
      return;
    }

    const expectedToken = process.env["DEMO_RESET_TOKEN"];
    const givenToken = typeof req.query.token === "string" ? req.query.token : "";

    // Guarded by its own token with constant-time comparison. Wrong or missing returns 403 with no detail.
    if (!expectedToken || !givenToken || !timingSafeEqual(givenToken, expectedToken)) {
      res.status(403).type("text/plain").send("Forbidden");
      return;
    }

    const now = Date.now();
    // At most one reset per 60 seconds. A second call returns success without resetting again.
    if (now - lastResetTimestamp < RESET_WINDOW_MS) {
      res.status(200).type("html").send(SUCCESS_HTML);
      return;
    }

    try {
      await reseedLedger();
      resetToolState();
      resetMockPaystack();
      lastResetTimestamp = now;
      console.log(`[${new Date().toISOString()}] demo_reset ok`);
      res.status(200).type("html").send(SUCCESS_HTML);
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] demo_reset error: ${error instanceof Error ? error.message : String(error)}`,
      );
      res.status(500).type("text/plain").send("Internal Server Error");
    }
  });
}

