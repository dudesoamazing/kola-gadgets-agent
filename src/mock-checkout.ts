import type { Express, Request, Response } from "express";
import { naira } from "./lib/format.js";
import { mockPaystack } from "./paystack/mock.js";

/**
 * A two-button stand-in for the Paystack checkout page, served only when
 * PAYSTACK_MODE=mock. It exists so the whole conversation — link, pay, verify,
 * release — can be demonstrated with no Paystack account, and as the fallback
 * if Paystack test mode refuses a ₦2.4m transaction.
 */
export function registerMockCheckout(app: Express): void {
  app.get("/mock/checkout/:reference", (req: Request, res: Response) => {
    const reference = req.params.reference ?? "";
    const transaction = mockPaystack.get(reference);
    if (!transaction) {
      res.status(404).type("html").send(page("Unknown reference", `<p>No mock transaction for <code>${escapeHtml(reference)}</code>.</p>`));
      return;
    }

    const amount = naira(transaction.amountKobo / 100);
    res
      .type("html")
      .send(
        page(
          `Pay ${amount}`,
          `<p class="label">Mock checkout — no money moves here.</p>
           <h1>${amount}</h1>
           <p class="ref">Reference <code>${escapeHtml(reference)}</code><br>Status <strong>${transaction.status}</strong></p>
           <form method="post" action="/mock/checkout/${encodeURIComponent(reference)}">
             <button name="outcome" value="success" class="pay">Pay now</button>
             <button name="outcome" value="failed" class="fail">Simulate a failed payment</button>
           </form>`,
        ),
      );
  });

  app.post("/mock/checkout/:reference", (req: Request, res: Response) => {
    const reference = req.params.reference ?? "";
    const outcome = req.body?.outcome === "failed" ? "failed" : "success";
    const transaction = mockPaystack.settle(reference, outcome);
    if (!transaction) {
      res.status(404).type("html").send(page("Unknown reference", "<p>No mock transaction with that reference.</p>"));
      return;
    }
    res.type("html").send(
      page(
        outcome === "success" ? "Payment complete" : "Payment failed",
        `<h1>${outcome === "success" ? "Payment complete" : "Payment failed"}</h1>
         <p>${naira(transaction.amountKobo / 100)} · <code>${escapeHtml(reference)}</code></p>
         <p class="label">${
           outcome === "success"
             ? "Go back to WhatsApp and tell the agent you have paid."
             : "Nothing was charged. Ask the agent for a fresh link."
         }</p>`,
      ),
    );
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Kola Gadgets</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 26rem; margin: 3rem auto; padding: 0 1.25rem; }
  h1 { font-size: 2rem; margin: .25rem 0 1rem; }
  .label { color: #767676; font-size: .875rem; }
  .ref { font-size: .875rem; }
  code { font-family: ui-monospace, monospace; }
  form { display: grid; gap: .6rem; margin-top: 1.5rem; }
  button { font: inherit; padding: .8rem 1rem; border-radius: .5rem; border: 1px solid transparent; cursor: pointer; }
  .pay { background: #0b8f3a; color: #fff; font-weight: 600; }
  .fail { background: transparent; border-color: #c0c0c0; }
</style></head>
<body>${body}</body></html>`;
}
