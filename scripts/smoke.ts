/**
 * End-to-end smoke test. Boots the real server over HTTP, talks to it with a
 * real MCP client, and walks every tool path — including the ones that must
 * fail. Runs against a throwaway copy of data/*.csv in mock Paystack mode, so
 * it needs no Google Sheet, no Paystack key and no Chord credits.
 *
 *   npm run smoke
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { normalisePickupCode } from "../src/lib/format.js";
import { PICKUP_WORDS } from "../src/lib/wordlist.js";

const TOKEN = "smoke-test-token";

// Credentials, as a person would type them in WhatsApp. Chord never tells a
// tool who is calling, so every call carries these.
const OWNER = { account_code: "KG-KOLA", pin: "1042" };
const STAFF = { account_code: "KG-TUNDE", pin: "2270" };
const ADA = { account_code: "KG-ADA", pin: "4461" };
const EMEKA = { account_code: "KG-EMEKA", pin: "5529" };

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log(`  [32m✓[0m ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  [31m✗[0m ${label}`);
    if (detail !== undefined) console.log(`      got: ${JSON.stringify(detail)}`);
  }
}

function section(title: string): void {
  console.log(`\n[1m${title}[0m`);
}

type Json = Record<string, any>;

async function startServer(env: Record<string, string>, port: number): Promise<ChildProcess> {
  const child = spawn("npx", ["tsx", "src/index.ts"], {
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) console.error(`    [server] ${text}`);
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.status === 200 || response.status === 503) return child;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill("SIGKILL");
  throw new Error(`Server on :${port} did not come up.`);
}

async function connect(port: number, token = TOKEN): Promise<Client> {
  const client = new Client({ name: "smoke", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

async function main(): Promise<void> {
  // A scratch copy of the seed CSVs — the real ones must stay pristine.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kola-smoke-"));
  for (const file of ["people.csv", "invoices.csv", "payments.csv", "flags.csv"]) {
    fs.copyFileSync(path.join("data", file), path.join(dir, file));
  }
  console.log(`Scratch ledger: ${dir}`);

  const port = 3977;
  const server = await startServer(
    {
      MCP_BEARER_TOKEN: TOKEN,
      LEDGER_BACKEND: "csv",
      LEDGER_CSV_DIR: dir,
      PAYSTACK_MODE: "mock",
      PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      PAYSTACK_SECRET_KEY: "",
    },
    port,
  );

  try {
    // ------------------------------------------------------------ health ----
    section("Health and auth");
    const health = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as Json;
    check("health reports ok", health.status === "ok", health);
    check("health names the csv backend", health.ledger?.backend === "csv", health.ledger);

    const noAuth = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    check("POST /mcp without a token is 401", noAuth.status === 401, noAuth.status);

    const wrongAuth = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer wrong-token",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    check("POST /mcp with a wrong token is 401", wrongAuth.status === 401, wrongAuth.status);

    const client = await connect(port);
    const call = async (name: string, args: Json): Promise<Json> => {
      let result;
      try {
        result = await client.callTool({ name, arguments: args });
      } catch (error) {
        // A schema refusal arrives as a protocol error, not a tool result.
        return { ok: false, error: "bad_input", mcp_error: String(error) };
      }
      const structured = (result as Json).structuredContent;
      if (structured) return structured as Json;
      const text = (result as Json).content?.[0]?.text;
      if (!text) return {};
      try {
        return JSON.parse(text) as Json;
      } catch {
        // An input the schema refused comes back as plain text, not our JSON.
        return { ok: false, error: "bad_input", mcp_error: text };
      }
    };

    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    check(
      "all eight tools are exposed",
      JSON.stringify(names) ===
        JSON.stringify([
          "check_invoice_status",
          "create_payment_link",
          "flag_for_owner",
          "get_pickup_codes",
          "get_reseller_balance",
          "identify",
          "record_handover",
          "verify_payment",
        ]),
      names,
    );

    const toolLeaks: string[] = [];
    const toolWordWordRegex = /\b[A-Z]{2,}-[A-Z0-9]{2,}\b/g;
    const toolSixDigitRegex = /\b\d{6}\b/g;

    function checkTextForToolLeaks(location: string, text: string | undefined) {
      if (!text) return;
      const wordMatches = text.match(toolWordWordRegex) ?? [];
      for (const m of wordMatches) {
        if (!m.startsWith("KG-") && !m.startsWith("INV-") && !m.startsWith("ACC-")) {
          toolLeaks.push(`${location}: pattern "${m}"`);
        }
      }
      const digitMatches = text.match(toolSixDigitRegex) ?? [];
      for (const m of digitMatches) {
        toolLeaks.push(`${location}: 6-digit number "${m}"`);
      }
    }

    for (const tool of tools.tools) {
      checkTextForToolLeaks(`${tool.name} description`, tool.description);
      const schema = tool.inputSchema as { description?: string; properties?: Record<string, { description?: string }> };
      checkTextForToolLeaks(`${tool.name} schema description`, schema?.description);
      if (schema?.properties) {
        for (const [propName, prop] of Object.entries(schema.properties)) {
          checkTextForToolLeaks(`${tool.name}.${propName} description`, prop.description);
        }
      }
    }

    check(
      "no tool description or parameter description contains a WORD-WORD pattern or 6-digit code",
      toolLeaks.length === 0,
      toolLeaks,
    );

    // -------------------------------------------------------------- roles ---
    section("Roles come from the ledger");
    const unknown = await call("identify", { account_code: "KG-NOBODY", pin: "0000" });
    check("an unknown account code is refused", unknown.error === "not_permitted", unknown);

    const ada = await call("identify", { ...ADA });
    check("Ada is a reseller", ada.role === "reseller" && ada.name === "Ada Okafor", ada);
    check("identify returns signed_in_as", ada.signed_in_as === "Ada Okafor", ada);
    check(
      "identify returns single-account boundary note",
      typeof ada.note === "string" && ada.note.includes("Only discuss this person's account"),
      ada,
    );

    const staff = await call("identify", { ...STAFF });
    check("Tunde is staff", staff.role === "staff", staff);
    check(
      "identify after different account returns new signed_in_as and boundary note",
      staff.signed_in_as === "Tunde" &&
        typeof staff.note === "string" &&
        staff.note.includes("Only discuss this person's account"),
      staff,
    );

    const owner = await call("identify", { ...OWNER });
    check("Kola is the owner", owner.role === "owner", owner);

    const spaced = await call("identify", { account_code: "kg ada", pin: "4461" });
    check('"kg ada" resolves to KG-ADA', spaced.account_code === "KG-ADA", spaced);

    const squashed = await call("identify", { account_code: "kgada", pin: "4 4 6 1" });
    check('"kgada" and a spaced PIN work too', squashed.account_code === "KG-ADA", squashed);

    const badPin = await call("identify", { ...ADA, pin: "0000" });
    check("a real code with the wrong PIN is refused", badPin.error === "not_permitted", badPin);
    // The property that matters: a wrong PIN on a real code is
    // indistinguishable from a code that does not exist. Otherwise the agent
    // becomes a way to enumerate which codes are live.
    check(
      "a wrong PIN and an unknown code give the identical message",
      badPin.message === unknown.message,
      { badPin: badPin.message, unknown: unknown.message },
    );
    check("and leaks no name or role", badPin.name === undefined && badPin.role === undefined, badPin);

    const noPin = await call("identify", { account_code: "KG-ADA", pin: "" });
    check("an empty PIN is refused", noPin.ok !== true, noPin);

    // The PIN must never come back out of any tool, in any field.
    const ok1 = await call("identify", { ...ADA });
    check("identify never echoes the PIN", !JSON.stringify(ok1).includes("4461"), ok1);

    // A 4-digit PIN is 10,000 guesses and the agent will answer all day, so
    // repeated misses have to leave a trace for Kola.
    for (let attempt = 0; attempt < 5; attempt++) {
      await call("identify", { account_code: "KG-CHIDI", pin: "0001" });
    }
    const bruteFlags = fs.readFileSync(path.join(dir, "flags.csv"), "utf8");
    check(
      "five failed attempts on one code flags the owner",
      bruteFlags.includes("failed sign-in attempts") && bruteFlags.includes("KG-CHIDI"),
      bruteFlags,
    );
    check("the flag does not record the attempted PIN", !bruteFlags.includes("0001"), bruteFlags);
    const chidiStillWorks = await call("identify", { account_code: "KG-CHIDI", pin: "6673" });
    check(
      "but the account is not locked out — the right PIN still works",
      chidiStillWorks.role === "reseller",
      chidiStillWorks,
    );

    // ------------------------------------------------------------ balance ---
    section("Balance");
    const balance = await call("get_reseller_balance", { ...ADA });
    check("Ada has 3 open invoices", balance.invoices?.length === 3, balance.invoices?.length);
    check(
      "total outstanding is ₦4,360,000",
      balance.total_outstanding_ngn === 4_360_000,
      balance.total_outstanding_ngn,
    );
    check("oldest invoice is INV-104", balance.oldest_invoice_id === "INV-104", balance.oldest_invoice_id);
    check(
      "the paid invoice INV-101 is not listed",
      !(balance.invoices ?? []).some((invoice: Json) => invoice.invoice_id === "INV-101"),
    );

    const staffBalance = await call("get_reseller_balance", { ...STAFF });
    check("staff have no balance to show", staffBalance.error === "not_permitted", staffBalance);

    // Every tool re-checks the credentials, because there is no session —
    // Chord hands us nothing about who is on the other end.
    const balanceBadPin = await call("get_reseller_balance", { ...ADA, pin: "9999" });
    check("get_reseller_balance re-checks the PIN", balanceBadPin.error === "not_permitted", balanceBadPin);
    check("and returns no invoices", balanceBadPin.invoices === undefined, balanceBadPin);

    // ------------------------------------------------------- invoice reads --
    section("Invoice visibility");
    const peeking = await call("check_invoice_status", { ...ADA, invoice_id: "INV-112" });
    check("Ada cannot see Emeka's invoice", peeking.error === "not_permitted", peeking);
    check("and nothing about it leaks", peeking.invoice === undefined, peeking);

    const staffView = await call("check_invoice_status", { ...STAFF, invoice_id: "INV-112" });
    check("staff can see any invoice", staffView.ok === true, staffView);
    check("INV-112 reads part_paid", staffView.invoice?.status === "part_paid", staffView.invoice?.status);
    check("INV-112 is not safe to release", staffView.safe_to_release === false, staffView);

    const loose = await call("check_invoice_status", { ...ADA, invoice_id: "inv 109" });
    check('"inv 109" resolves to INV-109', loose.invoice?.invoice_id === "INV-109", loose.invoice);

    const missing = await call("check_invoice_status", { ...ADA, invoice_id: "INV-999" });
    check("a missing invoice is not_found", missing.error === "not_found", missing);

    // A part-paid invoice has no pickup code at all, so there is nothing for
    // staff to type — the refusal happens one step earlier than before.
    const staffSeesCode = await call("check_invoice_status", { ...STAFF, invoice_id: "INV-110" });
    check(
      "check_invoice_status never shows staff a pickup code",
      staffSeesCode.invoice?.pickup_code === undefined &&
        !JSON.stringify(staffSeesCode).includes("418637"),
      staffSeesCode,
    );

    const staffCodes = await call("get_pickup_codes", { ...STAFF });
    check("staff cannot list pickup codes", staffCodes.error === "not_permitted", staffCodes);
    check("and no code leaks in the refusal", !JSON.stringify(staffCodes).includes("418637"), staffCodes);

    // ------------------------------------------------------- payment link ---
    section("Payment link");
    const foreign = await call("create_payment_link", { ...ADA, invoice_ids: ["INV-112"] });
    check("Ada cannot pay someone else's invoice", foreign.error === "not_found", foreign);

    const staffLink = await call("create_payment_link", { ...STAFF, invoice_ids: ["INV-104"] });
    check("staff cannot raise a payment link", staffLink.error === "not_permitted", staffLink);

    const tooMuch = await call("create_payment_link", {
      ...ADA,
      invoice_ids: ["INV-109"],
      amount_ngn: 500_000,
    });
    check("paying more than is owed is refused", tooMuch.error === "invalid_amount", tooMuch);

    const tooLittle = await call("create_payment_link", {
      ...ADA,
      invoice_ids: ["INV-104"],
      amount_ngn: 10_000,
    });
    check("a part payment under ₦50,000 is refused", tooLittle.error === "invalid_amount", tooLittle);

    const link = await call("create_payment_link", { ...ADA, invoice_ids: ["INV-104", "INV-109"] });
    check("link created for INV-104 + INV-109", link.ok === true, link);
    check("charged the full ₦2,710,000", link.amount_ngn === 2_710_000, link.amount_ngn);
    check("it is not flagged as a part payment", link.is_part_payment === false, link.is_part_payment);
    check("reference looks like ours", /^KG-\d{8}-[A-Z0-9]{6}$/.test(String(link.reference)), link.reference);
    const reference = String(link.reference);

    // --------------------------------------------------- verify, unpaid ----
    section("Verify before paying");
    const early = await call("verify_payment", { ...ADA, reference });
    check("nothing is applied yet", early.applied === false, early);
    check("status is not success", early.payment_status !== "success", early.payment_status);

    const invented = await call("verify_payment", { ...ADA, reference: "KG-20261020-FAKE01" });
    check("an invented reference is refused", invented.error === "not_found", invented);

    // A reference must not act as a bearer token for anyone who holds it.
    const nosy = await call("verify_payment", { ...EMEKA, reference });
    check("another reseller cannot verify Ada's payment", nosy.error === "not_permitted", nosy);
    check("and learns nothing about it", nosy.amount_ngn === undefined, nosy);

    const staffVerify = await call("verify_payment", { ...STAFF, reference });
    check("staff can verify any payment", staffVerify.ok === true, staffVerify);

    // ------------------------------------------------- verify, paid once ----
    section("Verify after paying");
    await fetch(`http://127.0.0.1:${port}/mock/checkout/${reference}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "outcome=success",
    });

    const applied = await call("verify_payment", { ...ADA, reference });
    check("payment confirmed", applied.payment_status === "success" && applied.applied === true, applied);
    check("₦2,710,000 applied", applied.amount_ngn === 2_710_000, applied.amount_ngn);
    check(
      "INV-104 and INV-109 are now paid",
      (applied.applied_to ?? []).every((row: Json) => row.now_status === "paid") &&
        applied.applied_to?.length === 2,
      applied.applied_to,
    );
    check(
      "only INV-107 is left outstanding",
      applied.total_outstanding_ngn === 1_650_000,
      applied.total_outstanding_ngn,
    );

    const inv104Applied = applied.applied_to?.[0];
    const inv109Applied = applied.applied_to?.[1];
    check(
      "INV-104 was already collected so collected is true and has explanation note",
      inv104Applied?.collected === true &&
        typeof inv104Applied?.note === "string" &&
        inv104Applied.note.includes("Already collected on credit"),
      inv104Applied,
    );
    check(
      "INV-104 has no pickup code",
      inv104Applied?.pickup_code === undefined,
      inv104Applied?.pickup_code,
    );
    check(
      "INV-109 was uncollected so collected is false and receives a two-word pickup code",
      inv109Applied?.collected === false &&
        typeof inv109Applied?.pickup_code === "string" &&
        /^[A-Z]{3,6}-[A-Z]{3,6}$/.test(inv109Applied.pickup_code),
      inv109Applied,
    );
    check(
      "summary_for_reply is present and explains settled vs pickup code and new balance",
      typeof applied.summary_for_reply === "string" &&
        applied.summary_for_reply.includes("settled, collected earlier") &&
        applied.summary_for_reply.includes("pickup code") &&
        applied.summary_for_reply.includes("₦1,650,000"),
      applied.summary_for_reply,
    );

    // ------------------------------------------- the double-apply guard ----
    section("Verifying twice must not pay twice");
    const again = await call("verify_payment", { ...ADA, reference });
    check("the second verify reports the existing payment", again.already_applied === true, again);
    check("it does not apply anything", again.applied === undefined || again.applied === false, again.applied);

    const afterTwice = await call("get_reseller_balance", { ...ADA });
    check(
      "the balance is unchanged after verifying twice",
      afterTwice.total_outstanding_ngn === 1_650_000,
      afterTwice.total_outstanding_ngn,
    );

    // Concurrent verifies of the same reference: the race the lock exists for.
    const racePort = port;
    const raceLink = await call("create_payment_link", { ...EMEKA, invoice_ids: ["INV-112"] });
    const raceRef = String(raceLink.reference);
    await fetch(`http://127.0.0.1:${racePort}/mock/checkout/${raceRef}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "outcome=success",
    });
    const [raceA, raceB] = await Promise.all([
      call("verify_payment", { ...EMEKA, reference: raceRef }),
      call("verify_payment", { ...EMEKA, reference: raceRef }),
    ]);
    const appliedCount = [raceA, raceB].filter((result) => result.applied === true).length;
    check("two simultaneous verifies apply the money once", appliedCount === 1, {
      a: raceA.applied,
      b: raceB.applied,
    });
    const emekaAfter = await call("check_invoice_status", { ...STAFF, invoice_id: "INV-112" });
    check(
      "INV-112 is paid exactly once (₦1,200,000)",
      emekaAfter.invoice?.amount_paid_ngn === 1_200_000,
      emekaAfter.invoice?.amount_paid_ngn,
    );

    const settled = await call("create_payment_link", { ...ADA, invoice_ids: ["INV-104"] });
    check("a settled invoice cannot be billed again", settled.error === "already_paid", settled);

    // -------------------------------------------------------- part payment --
    section("Part payment, oldest first");
    const part = await call("create_payment_link", {
      ...ADA,
      invoice_ids: ["INV-107"],
      amount_ngn: 1_000_000,
    });
    check("part payment accepted", part.ok === true && part.is_part_payment === true, part);
    check(
      "it shows ₦650,000 will be left on INV-107",
      part.applies_to?.[0]?.leaves_outstanding_ngn === 650_000,
      part.applies_to,
    );
    const partRef = String(part.reference);
    await fetch(`http://127.0.0.1:${port}/mock/checkout/${partRef}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "outcome=success",
    });
    const partApplied = await call("verify_payment", { ...ADA, reference: partRef });
    check(
      "INV-107 becomes part_paid, not paid",
      partApplied.applied_to?.[0]?.now_status === "part_paid",
      partApplied.applied_to,
    );
    check(
      "₦650,000 still outstanding",
      partApplied.applied_to?.[0]?.outstanding_ngn === 650_000,
      partApplied.applied_to,
    );
    check(
      "a part-paid invoice is not safe to release",
      partApplied.applied_to?.[0]?.safe_to_release === false,
      partApplied.applied_to,
    );
    // The mechanic in one line: a part payment mints no pickup code, so there
    // is nothing the reseller can show at the counter.
    check(
      "a part payment issues no pickup code",
      partApplied.applied_to?.[0]?.pickup_code === undefined,
      partApplied.applied_to,
    );
    const partRow = fs
      .readFileSync(path.join(dir, "invoices.csv"), "utf8")
      .split("\n")
      .find((line) => line.startsWith("INV-107"));
    check("and the pickup_code cell stays empty", partRow?.startsWith("INV-107,ACC-ADA,,") === true, partRow);

    // ------------------------------------------------------ failed payment --
    section("Failed payment");
    const failLink = await call("create_payment_link", {
      ...ADA,
      invoice_ids: ["INV-107"],
      amount_ngn: 650_000,
    });
    const failRef = String(failLink.reference);
    await fetch(`http://127.0.0.1:${port}/mock/checkout/${failRef}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "outcome=failed",
    });
    const failed1 = await call("verify_payment", { ...ADA, reference: failRef });
    check("a failed payment is reported, not applied", failed1.applied === false, failed1);
    check("status is failed", failed1.payment_status === "failed", failed1.payment_status);
    const stillOwed = await call("check_invoice_status", { ...ADA, invoice_id: "INV-107" });
    check(
      "INV-107 still owes ₦650,000 after the failure",
      stillOwed.invoice?.outstanding_ngn === 650_000,
      stillOwed.invoice?.outstanding_ngn,
    );

    // ---------------------------- verify without reference (lost between turns) ---
    section("Verify without reference");
    const CHIDI = { account_code: "KG-CHIDI", pin: "6673" };

    // Case 1: One pending unpaid — create link, do not pay, call verify with no reference
    const chidiLinkA = await call("create_payment_link", {
      ...CHIDI,
      invoice_ids: ["INV-111"],
      amount_ngn: 200_000,
    });
    const chidiRefA = String(chidiLinkA.reference);
    const chidiUnpaid = await call("verify_payment", { ...CHIDI });
    check("one pending unpaid is not applied", chidiUnpaid.applied === false, chidiUnpaid);
    check(
      "one pending unpaid status is pending",
      chidiUnpaid.payment_status === "pending" || chidiUnpaid.payment_status === "abandoned",
      chidiUnpaid.payment_status,
    );

    // Case 2: Another account's pending payment is never touched
    const emekaProbe = await call("verify_payment", { ...EMEKA });
    check("another account's pending payment never touched", emekaProbe.applied === false, emekaProbe);

    // Case 3: One pending paid — pay the link in Paystack mock, verify without reference
    await fetch(`http://127.0.0.1:${port}/mock/checkout/${chidiRefA}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "outcome=success",
    });
    const chidiPaid = await call("verify_payment", { ...CHIDI });
    check(
      "one pending paid confirms payment",
      chidiPaid.payment_status === "success" && chidiPaid.applied === true,
      chidiPaid,
    );
    check(
      "INV-111 amount paid updated",
      chidiPaid.applied_to?.[0]?.applied_ngn === 200_000,
      chidiPaid.applied_to,
    );

    // Case 4: Repeat call applying nothing twice
    const chidiAgain = await call("verify_payment", { ...CHIDI });
    check("repeat call reports already applied", chidiAgain.already_applied === true, chidiAgain);
    check("repeat call applies nothing twice", chidiAgain.applied === false, chidiAgain.applied);

    // Case 5: Several pending payments for one account
    const chidiLinkB = await call("create_payment_link", {
      ...CHIDI,
      invoice_ids: ["INV-111"],
      amount_ngn: 200_000,
    });
    const chidiLinkC = await call("create_payment_link", {
      ...CHIDI,
      invoice_ids: ["INV-111"],
      amount_ngn: 200_000,
    });
    const chidiRefB = String(chidiLinkB.reference);
    const chidiRefC = String(chidiLinkC.reference);

    // Pay link C, leave link B unpaid
    await fetch(`http://127.0.0.1:${port}/mock/checkout/${chidiRefC}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "outcome=success",
    });

    const chidiMulti = await call("verify_payment", { ...CHIDI });
    check(
      "several pending verifies and applies the paid one",
      chidiMulti.applied === true && chidiMulti.amount_ngn === 200_000,
      chidiMulti,
    );
    check(
      "several pending reports both payments",
      Array.isArray(chidiMulti.payments) && chidiMulti.payments.length === 2,
      chidiMulti.payments,
    );

    // ------------------------------------------------------- pickup codes ---
    section("Pickup codes");
    // INV-109 was settled in full earlier in this run, so verify_payment
    // should have minted it a code.
    const adaCodes = await call("get_pickup_codes", { ...ADA });
    const inv109 = (adaCodes.ready_to_collect ?? []).find((i: Json) => i.invoice_id === "INV-109");
    check("a settled invoice has a pickup code", /^[A-Z]{3,6}-[A-Z]{3,6}$/.test(String(inv109?.pickup_code)), adaCodes);
    check(
      "the part-paid INV-107 is not listed as ready",
      !(adaCodes.ready_to_collect ?? []).some((i: Json) => i.invoice_id === "INV-107"),
      adaCodes.ready_to_collect,
    );
    const adaCode = String(inv109?.pickup_code);

    // INV-112 was settled in full by the concurrent-verify test earlier, so it
    // has a code now too — and every issued code must be distinct.
    const emekaCodes = await call("get_pickup_codes", { ...EMEKA });
    const inv112 = (emekaCodes.ready_to_collect ?? []).find((i: Json) => i.invoice_id === "INV-112");
    check("INV-112 got its own code once it was settled", /^[A-Z]{3,6}-[A-Z]{3,6}$/.test(String(inv112?.pickup_code)), emekaCodes);
    check("no two invoices share a code", inv112?.pickup_code !== inv109?.pickup_code, {
      inv112: inv112?.pickup_code,
      inv109: inv109?.pickup_code,
    });
    check(
      "a reseller sees only their own codes",
      (emekaCodes.ready_to_collect ?? []).every((i: Json) => i.invoice_id !== "INV-109"),
      emekaCodes.ready_to_collect,
    );

    // Verifying again must not mint a second code for the same goods.
    await call("verify_payment", { ...ADA, reference });
    const codesAgain = await call("get_pickup_codes", { ...ADA });
    const inv109Again = (codesAgain.ready_to_collect ?? []).find((i: Json) => i.invoice_id === "INV-109");
    check(
      "verifying twice does not reissue a different code",
      inv109Again?.pickup_code === adaCode,
      { first: adaCode, second: inv109Again?.pickup_code },
    );

    // ----------------------------------------------------------- handover ---
    section("Handover against a code");
    const resellerRelease = await call("record_handover", { ...ADA, pickup_code: adaCode });
    check("a reseller cannot release goods", resellerRelease.error === "not_permitted", resellerRelease);

    const seededRelease = await call("record_handover", { ...STAFF, pickup_code: "418 637" });
    check("the seeded code for INV-110 works, spaces and all", seededRelease.ok === true, seededRelease);
    check(
      "it names the item to hand over",
      String(seededRelease.items).includes("Galaxy S24"),
      seededRelease.items,
    );
    check("it records Tunde", seededRelease.collected_by === "Tunde", seededRelease.collected_by);
    check(
      "and a Lagos timestamp",
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(seededRelease.collected_at)),
      seededRelease.collected_at,
    );

    const reused = await call("record_handover", { ...STAFF, pickup_code: "418637" });
    check("a code works exactly once", reused.error === "already_collected", reused);

    // Release Ada's item now using lowercase with a space to test normalisation
    const spacedAdaCode = adaCode.toLowerCase().replace("-", " ");
    const release = await call("record_handover", { ...STAFF, pickup_code: spacedAdaCode });
    check("Ada's code releases INV-109 even in lowercase with space", release.ok === true && release.invoice_id === "INV-109", release);

    check(
      "normalisePickupCode matches hyphenated, spaced, lowercase, and seamless",
      normalisePickupCode("mango tiger") === normalisePickupCode("Mango-Tiger") &&
        normalisePickupCode("MANGOTIGER") === normalisePickupCode("mango-tiger") &&
        normalisePickupCode("418 637") === "418637",
    );

    const BLOCKED_PICKUP_WORDS = [
      "SCAM", "THEFT", "ARREST", "POLICE", "POISON", "VIRUS", "AIDS", "AGONY",
      "GRIEF", "DECAY", "ANGER", "UNPAID", "DEBIT", "CREDIT", "CASH", "PAYING",
      "VOID", "CANCEL", "ERROR", "FALSE", "EMPTY", "GONE", "BROKEN",
    ];
    const foundBlockedWords = PICKUP_WORDS.filter((w) => BLOCKED_PICKUP_WORDS.includes(w));
    check("pickup word list contains no blocked words", foundBlockedWords.length === 0, foundBlockedWords);
    check("pickup word list contains no generic words like ITEM", !PICKUP_WORDS.includes("ITEM"));
    check("pickup word list contains no obscure words like FAWN", !PICKUP_WORDS.includes("FAWN"));
    check(
      "pickup word list contains no clumsy words like PAGING or ANNEX",
      !PICKUP_WORDS.includes("PAGING") && !PICKUP_WORDS.includes("ANNEX"),
    );
    check("pickup word list has at least 1,000 words", PICKUP_WORDS.length >= 1000, PICKUP_WORDS.length);
    check(
      "pickup word list contains MANGO, TIGER, RIVER, PILLOW",
      PICKUP_WORDS.includes("MANGO") &&
        PICKUP_WORDS.includes("TIGER") &&
        PICKUP_WORDS.includes("RIVER") &&
        PICKUP_WORDS.includes("PILLOW"),
    );
    check("all pickup words are 3 to 6 uppercase letters", PICKUP_WORDS.every((w) => /^[A-Z]{3,6}$/.test(w)));

    // Ensure no literal example pickup codes leak into the skill files
    const skillDir = path.resolve("skill");
    const skillFiles: string[] = [];
    function collectSkillMd(dirPath: string) {
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const full = path.join(dirPath, entry.name);
        if (entry.isDirectory()) collectSkillMd(full);
        else if (entry.name.endsWith(".md")) skillFiles.push(full);
      }
    }
    collectSkillMd(skillDir);
    const leakedCodes: string[] = [];
    const wordWordRegex = /\b[A-Z]{2,}-[A-Z0-9]{2,}\b/g;
    for (const f of skillFiles) {
      const content = fs.readFileSync(f, "utf8");
      const matches = content.match(wordWordRegex) ?? [];
      for (const m of matches) {
        if (!m.startsWith("KG-") && !m.startsWith("INV-") && !m.startsWith("ACC-")) {
          leakedCodes.push(`${path.basename(f)}: ${m}`);
        }
      }
    }
    check(
      "no file in skill/ contains a WORD-WORD pattern apart from KG-, INV- and ACC- identifiers",
      leakedCodes.length === 0,
      leakedCodes,
    );

    const spentCode = await call("get_pickup_codes", { ...ADA });
    check(
      "a collected invoice drops off the ready-to-collect list",
      !(spentCode.ready_to_collect ?? []).some((i: Json) => i.invoice_id === "INV-109"),
      spentCode.ready_to_collect,
    );

    // ------------------------------------------------------ wrong codes ----
    section("Wrong pickup codes lock the counter");
    const bisi = { account_code: "KG-BISI", pin: "3318" };
    const firstWrong = await call("record_handover", { ...bisi, pickup_code: "000001" });
    check("a wrong code releases nothing", firstWrong.error === "not_found", firstWrong);
    check("and says how many attempts are left", /attempt/i.test(String(firstWrong.message)), firstWrong.message);
    check("no invoice leaks on a wrong code", firstWrong.invoice === undefined, firstWrong);

    await call("record_handover", { ...bisi, pickup_code: "000002" });
    const thirdWrong = await call("record_handover", { ...bisi, pickup_code: "000003" });
    check("the third wrong code locks the account", thirdWrong.locked === true, thirdWrong);

    const lockedOut = await call("record_handover", { ...bisi, pickup_code: "418637" });
    check(
      "a locked account cannot release even with a real code",
      lockedOut.error === "not_permitted" && lockedOut.locked === true,
      lockedOut,
    );

    const lockFlags = fs.readFileSync(path.join(dir, "flags.csv"), "utf8");
    check("the lockout is flagged for the owner", lockFlags.includes("wrong pickup codes"), lockFlags);
    check("and names the staff member", lockFlags.includes("KG-BISI"), lockFlags);

    // Tunde is unaffected — one staff account locking must not shut the shop.
    const tundeStillOk = await call("record_handover", { ...STAFF, pickup_code: "000009" });
    check(
      "another staff account is not locked out",
      tundeStillOk.error === "not_found" && tundeStillOk.locked === false,
      tundeStillOk,
    );

    // --------------------------------------------------------------- flag ---
    section("Flag for the owner");
    const flag = await call("flag_for_owner", {
      ...ADA,
      invoice_id: "INV-107",
      summary: "Says she paid INV-107 by bank transfer this morning.",
    });
    check("a flag is logged", flag.ok === true, flag);
    const flagsCsv = fs.readFileSync(path.join(dir, "flags.csv"), "utf8");
    check("it reaches the Flags tab", flagsCsv.includes("bank transfer this morning"), flagsCsv);
    check("with the sender's name and role", flagsCsv.includes("Ada Okafor (reseller)"), flagsCsv);
    check("and the account code, not a phone number", flagsCsv.includes("KG-ADA"), flagsCsv);

    const flagUnknown = await call("flag_for_owner", {
      ...EMEKA,
      summary: "Asking about an order placed last week.",
    });
    check("another account can raise its own flag", flagUnknown.ok === true, flagUnknown);

    // --------------------------------------------------- ledger integrity ---
    section("Ledger integrity");
    const invoicesCsv = fs.readFileSync(path.join(dir, "invoices.csv"), "utf8");
    const inv104 = invoicesCsv.split("\n").find((line) => line.startsWith("INV-104"));
    check("INV-104 is written as fully paid once", inv104?.includes("2400000,2400000") === true, inv104);
    const lastLink = await call("create_payment_link", {
      ...ADA,
      invoice_ids: ["INV-107"],
      amount_ngn: 650_000,
    });
    check("a further link can be raised", lastLink.ok === true, lastLink);

    const paymentsCsv = fs.readFileSync(path.join(dir, "payments.csv"), "utf8");
    check(
      "the seed payment rows are untouched",
      paymentsCsv.includes("KG-SEED-0001,ACC-ADA,INV-101,720000,success"),
    );
    check(
      "the new row is filed under the account and carries no phone number",
      paymentsCsv.includes(`${lastLink.reference},ACC-ADA,INV-107`),
      paymentsCsv.split("\n").find((line) => line.startsWith(String(lastLink.reference))),
    );
    check("no PIN is ever written to the ledger", !paymentsCsv.includes("4461"), paymentsCsv);
    check("verified payments carry a timestamp", new RegExp(`${reference},.*success,.*\\d{2}:\\d{2}`).test(paymentsCsv));

    await client.close();
  } finally {
    server.kill("SIGTERM");
  }

  // ------------------------------------------------- Paystack unreachable --
  section("Paystack unreachable");
  const deadPort = 3978;
  const deadServer = await startServer(
    {
      MCP_BEARER_TOKEN: TOKEN,
      LEDGER_BACKEND: "csv",
      LEDGER_CSV_DIR: dir,
      PAYSTACK_MODE: "live",
      PAYSTACK_SECRET_KEY: "sk_test_deliberately_invalid",
      // Port 9 is the discard port — connections are refused immediately.
      PAYSTACK_BASE_URL: "http://127.0.0.1:9",
    },
    deadPort,
  );
  try {
    const client = await connect(deadPort);
    const result = await client.callTool({
      name: "create_payment_link",
      arguments: { ...EMEKA, invoice_ids: ["INV-113"] },
    });
    const payload = ((result as Json).structuredContent ??
      JSON.parse((result as Json).content[0].text)) as Json;
    check("an unreachable Paystack returns an error, not a crash", payload.error === "paystack_unreachable", payload);
    check(
      "and says nothing changed",
      String(payload.message).toLowerCase().includes("nothing has changed"),
      payload.message,
    );
    const paymentsCsv = fs.readFileSync(path.join(dir, "payments.csv"), "utf8");
    check("no pending row was logged for a link that was never created", !paymentsCsv.includes("INV-113"));
    await client.close();
  } finally {
    deadServer.kill("SIGTERM");
  }

  // --------------------------------------------------- Paystack says no ----
  // Paystack rejecting our data is not the same as Paystack being down. This
  // really happened: the seed emails used the reserved .test TLD, so every
  // initialize came back '"email" must be a valid email'.
  section("Paystack rejects the request");
  const stubPort = 3979;
  const stub = http.createServer((_req, res) => {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: false,
        message: '"email" must be a valid email',
        type: "validation_error",
        code: "invalid_params",
      }),
    );
  });
  await new Promise<void>((resolve) => {
    stub.listen(stubPort, "127.0.0.1", () => resolve());
  });

  const rejectPort = 3980;
  const rejectServer = await startServer(
    {
      MCP_BEARER_TOKEN: TOKEN,
      LEDGER_BACKEND: "csv",
      LEDGER_CSV_DIR: dir,
      PAYSTACK_MODE: "live",
      PAYSTACK_SECRET_KEY: "sk_test_stub",
      PAYSTACK_BASE_URL: `http://127.0.0.1:${stubPort}`,
    },
    rejectPort,
  );
  try {
    const client = await connect(rejectPort);
    const result = await client.callTool({
      name: "create_payment_link",
      arguments: { ...EMEKA, invoice_ids: ["INV-113"] },
    });
    const payload = ((result as Json).structuredContent ??
      JSON.parse((result as Json).content[0].text)) as Json;
    check("a rejected request is bad_input, not paystack_unreachable", payload.error === "bad_input", payload);
    check("it is flagged for the owner", payload.flagged_for_owner === true, payload);
    check(
      "it does not tell the reseller to try again",
      !String(payload.message).toLowerCase().includes("try again"),
      payload.message,
    );
    const flagsCsv = fs.readFileSync(path.join(dir, "flags.csv"), "utf8");
    check("the flag carries Paystack's own complaint", flagsCsv.includes("must be a valid email"), flagsCsv);
    await client.close();
  } finally {
    rejectServer.kill("SIGTERM");
    stub.close();
  }

  console.log(`\n[1m${passed} passed, ${failed} failed[0m`);
  if (failed > 0) {
    console.log("Failures:");
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
