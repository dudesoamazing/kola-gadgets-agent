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

const TOKEN = "smoke-test-token";
const OWNER = "+2348010000001";
const STAFF = "+2348010000002";
const ADA = "+2348020000001";
const ADA_SECOND = "+2348020000011";
const EMEKA = "+2348020000002";

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
      const result = await client.callTool({ name, arguments: args });
      const structured = (result as Json).structuredContent;
      if (structured) return structured as Json;
      const text = (result as Json).content?.[0]?.text;
      return text ? (JSON.parse(text) as Json) : {};
    };

    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    check(
      "all seven tools are exposed",
      JSON.stringify(names) ===
        JSON.stringify([
          "check_invoice_status",
          "create_payment_link",
          "flag_for_owner",
          "get_reseller_balance",
          "get_sender_role",
          "record_handover",
          "verify_payment",
        ]),
      names,
    );

    // -------------------------------------------------------------- roles ---
    section("Roles come from the ledger");
    const unknown = await call("get_sender_role", { phone: "+2349999999999" });
    check("an unknown number is refused", unknown.error === "unknown_sender", unknown);

    const ada = await call("get_sender_role", { phone: ADA });
    check("Ada is a reseller", ada.role === "reseller" && ada.name === "Ada Okafor", ada);

    const staff = await call("get_sender_role", { phone: STAFF });
    check("Tunde is staff", staff.role === "staff", staff);

    const owner = await call("get_sender_role", { phone: OWNER });
    check("Kola is the owner", owner.role === "owner", owner);

    const localFormat = await call("get_sender_role", { phone: "08020000001" });
    check("0802… matches the same person as +2348…", localFormat.phone === ADA, localFormat);

    const bareFormat = await call("get_sender_role", { phone: "2348020000001" });
    check("2348… matches too", bareFormat.phone === ADA, bareFormat);

    // ------------------------------------------------------------ balance ---
    section("Balance");
    const balance = await call("get_reseller_balance", { phone: ADA });
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

    const staffBalance = await call("get_reseller_balance", { phone: STAFF });
    check("staff have no balance to show", staffBalance.error === "not_permitted", staffBalance);

    // A reseller's second line must see the same balance — they carry two
    // phones and a vanishing balance is worse than no agent at all.
    const second = await call("get_sender_role", { phone: ADA_SECOND });
    check("Ada's second line is recognised", second.role === "reseller", second);
    check("and shares Ada's account", second.account_id === "ACC-ADA", second);

    const secondBalance = await call("get_reseller_balance", { phone: ADA_SECOND });
    check(
      "the second line sees the same ₦4,360,000",
      secondBalance.total_outstanding_ngn === 4_360_000,
      secondBalance.total_outstanding_ngn,
    );
    check(
      "and the same three invoices",
      JSON.stringify((secondBalance.invoices ?? []).map((i: Json) => i.invoice_id)) ===
        JSON.stringify((balance.invoices ?? []).map((i: Json) => i.invoice_id)),
      secondBalance.invoices?.map((i: Json) => i.invoice_id),
    );

    const secondOwn = await call("check_invoice_status", { phone: ADA_SECOND, invoice_id: "INV-109" });
    check("the second line can check her own invoice", secondOwn.ok === true, secondOwn);
    const secondPeek = await call("check_invoice_status", { phone: ADA_SECOND, invoice_id: "INV-112" });
    check(
      "but still cannot see Emeka's",
      secondPeek.error === "not_permitted",
      secondPeek,
    );

    // ------------------------------------------------------- invoice reads --
    section("Invoice visibility");
    const peeking = await call("check_invoice_status", { phone: ADA, invoice_id: "INV-112" });
    check("Ada cannot see Emeka's invoice", peeking.error === "not_permitted", peeking);
    check("and nothing about it leaks", peeking.invoice === undefined, peeking);

    const staffView = await call("check_invoice_status", { phone: STAFF, invoice_id: "INV-112" });
    check("staff can see any invoice", staffView.ok === true, staffView);
    check("INV-112 reads part_paid", staffView.invoice?.status === "part_paid", staffView.invoice?.status);
    check("INV-112 is not safe to release", staffView.safe_to_release === false, staffView);

    const loose = await call("check_invoice_status", { phone: ADA, invoice_id: "inv 109" });
    check('"inv 109" resolves to INV-109', loose.invoice?.invoice_id === "INV-109", loose.invoice);

    const missing = await call("check_invoice_status", { phone: ADA, invoice_id: "INV-999" });
    check("a missing invoice is not_found", missing.error === "not_found", missing);

    // Checked here, while INV-112 is still part-paid and INV-109 still unpaid.
    const releasePartPaid = await call("record_handover", { phone: STAFF, invoice_id: "INV-112" });
    check(
      "staff cannot release a part-paid invoice",
      releasePartPaid.error === "not_fully_paid",
      releasePartPaid,
    );
    const releaseUnpaid = await call("record_handover", { phone: STAFF, invoice_id: "INV-109" });
    check("staff cannot release an unpaid invoice", releaseUnpaid.error === "not_fully_paid", releaseUnpaid);

    // ------------------------------------------------------- payment link ---
    section("Payment link");
    const foreign = await call("create_payment_link", { phone: ADA, invoice_ids: ["INV-112"] });
    check("Ada cannot pay someone else's invoice", foreign.error === "not_found", foreign);

    const staffLink = await call("create_payment_link", { phone: STAFF, invoice_ids: ["INV-104"] });
    check("staff cannot raise a payment link", staffLink.error === "not_permitted", staffLink);

    const tooMuch = await call("create_payment_link", {
      phone: ADA,
      invoice_ids: ["INV-109"],
      amount_ngn: 500_000,
    });
    check("paying more than is owed is refused", tooMuch.error === "invalid_amount", tooMuch);

    const tooLittle = await call("create_payment_link", {
      phone: ADA,
      invoice_ids: ["INV-104"],
      amount_ngn: 10_000,
    });
    check("a part payment under ₦50,000 is refused", tooLittle.error === "invalid_amount", tooLittle);

    const link = await call("create_payment_link", { phone: ADA, invoice_ids: ["INV-104", "INV-109"] });
    check("link created for INV-104 + INV-109", link.ok === true, link);
    check("charged the full ₦2,710,000", link.amount_ngn === 2_710_000, link.amount_ngn);
    check("it is not flagged as a part payment", link.is_part_payment === false, link.is_part_payment);
    check("reference looks like ours", /^KG-\d{8}-[A-Z0-9]{6}$/.test(String(link.reference)), link.reference);
    const reference = String(link.reference);

    // --------------------------------------------------- verify, unpaid ----
    section("Verify before paying");
    const early = await call("verify_payment", { phone: ADA, reference });
    check("nothing is applied yet", early.applied === false, early);
    check("status is not success", early.payment_status !== "success", early.payment_status);

    const invented = await call("verify_payment", { phone: ADA, reference: "KG-20261020-FAKE01" });
    check("an invented reference is refused", invented.error === "not_found", invented);

    // A reference must not act as a bearer token for anyone who holds it.
    const nosy = await call("verify_payment", { phone: EMEKA, reference });
    check("another reseller cannot verify Ada's payment", nosy.error === "not_permitted", nosy);
    check("and learns nothing about it", nosy.amount_ngn === undefined, nosy);

    const staffVerify = await call("verify_payment", { phone: STAFF, reference });
    check("staff can verify any payment", staffVerify.ok === true, staffVerify);

    // ------------------------------------------------- verify, paid once ----
    section("Verify after paying");
    await fetch(`http://127.0.0.1:${port}/mock/checkout/${reference}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "outcome=success",
    });

    // Verified from her *second* line, against a link raised from her first —
    // the whole point of account-based ownership.
    const applied = await call("verify_payment", { phone: ADA_SECOND, reference });
    check("payment confirmed", applied.payment_status === "success" && applied.applied === true, applied);
    check(
      "a link raised on one number can be verified from the other",
      applied.applied === true,
      applied.applied,
    );
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

    // ------------------------------------------- the double-apply guard ----
    section("Verifying twice must not pay twice");
    const again = await call("verify_payment", { phone: ADA, reference });
    check("the second verify reports the existing payment", again.already_applied === true, again);
    check("it does not apply anything", again.applied === undefined || again.applied === false, again.applied);

    const afterTwice = await call("get_reseller_balance", { phone: ADA });
    check(
      "the balance is unchanged after verifying twice",
      afterTwice.total_outstanding_ngn === 1_650_000,
      afterTwice.total_outstanding_ngn,
    );

    // Concurrent verifies of the same reference: the race the lock exists for.
    const racePort = port;
    const raceLink = await call("create_payment_link", { phone: EMEKA, invoice_ids: ["INV-112"] });
    const raceRef = String(raceLink.reference);
    await fetch(`http://127.0.0.1:${racePort}/mock/checkout/${raceRef}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "outcome=success",
    });
    const [raceA, raceB] = await Promise.all([
      call("verify_payment", { phone: EMEKA, reference: raceRef }),
      call("verify_payment", { phone: EMEKA, reference: raceRef }),
    ]);
    const appliedCount = [raceA, raceB].filter((result) => result.applied === true).length;
    check("two simultaneous verifies apply the money once", appliedCount === 1, {
      a: raceA.applied,
      b: raceB.applied,
    });
    const emekaAfter = await call("check_invoice_status", { phone: STAFF, invoice_id: "INV-112" });
    check(
      "INV-112 is paid exactly once (₦1,200,000)",
      emekaAfter.invoice?.amount_paid_ngn === 1_200_000,
      emekaAfter.invoice?.amount_paid_ngn,
    );

    const settled = await call("create_payment_link", { phone: ADA, invoice_ids: ["INV-104"] });
    check("a settled invoice cannot be billed again", settled.error === "already_paid", settled);

    // -------------------------------------------------------- part payment --
    section("Part payment, oldest first");
    const part = await call("create_payment_link", {
      phone: ADA,
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
    const partApplied = await call("verify_payment", { phone: ADA, reference: partRef });
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

    // ------------------------------------------------------ failed payment --
    section("Failed payment");
    const failLink = await call("create_payment_link", {
      phone: ADA,
      invoice_ids: ["INV-107"],
      amount_ngn: 650_000,
    });
    const failRef = String(failLink.reference);
    await fetch(`http://127.0.0.1:${port}/mock/checkout/${failRef}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "outcome=failed",
    });
    const failed1 = await call("verify_payment", { phone: ADA, reference: failRef });
    check("a failed payment is reported, not applied", failed1.applied === false, failed1);
    check("status is failed", failed1.payment_status === "failed", failed1.payment_status);
    const stillOwed = await call("check_invoice_status", { phone: ADA, invoice_id: "INV-107" });
    check(
      "INV-107 still owes ₦650,000 after the failure",
      stillOwed.invoice?.outstanding_ngn === 650_000,
      stillOwed.invoice?.outstanding_ngn,
    );

    // ----------------------------------------------------------- handover ---
    section("Handover");
    const resellerRelease = await call("record_handover", { phone: ADA, invoice_id: "INV-109" });
    check("a reseller cannot record a handover", resellerRelease.error === "not_permitted", resellerRelease);

    // INV-107 is part-paid *and* was taken on credit. "You already handed this
    // over" is the more urgent warning, so it must win over "not fully paid".
    const creditRelease = await call("record_handover", { phone: STAFF, invoice_id: "INV-107" });
    check(
      "an already-collected invoice warns about that first",
      creditRelease.error === "already_collected",
      creditRelease,
    );

    const release = await call("record_handover", { phone: STAFF, invoice_id: "INV-109" });
    check("staff release a paid invoice", release.ok === true, release);
    check("it records Tunde", release.collected_by === "Tunde", release.collected_by);
    check("and a Lagos timestamp", /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(release.collected_at)), release.collected_at);

    const twice = await call("record_handover", { phone: STAFF, invoice_id: "INV-109" });
    check("releasing twice is refused", twice.error === "already_collected", twice);

    // --------------------------------------------------------------- flag ---
    section("Flag for the owner");
    const flag = await call("flag_for_owner", {
      phone: ADA,
      invoice_id: "INV-107",
      summary: "Says she paid INV-107 by bank transfer this morning.",
    });
    check("a flag is logged", flag.ok === true, flag);
    const flagsCsv = fs.readFileSync(path.join(dir, "flags.csv"), "utf8");
    check("it reaches the Flags tab", flagsCsv.includes("bank transfer this morning"), flagsCsv);
    check("with the sender's name and role", flagsCsv.includes("Ada Okafor (reseller)"), flagsCsv);

    const flagUnknown = await call("flag_for_owner", {
      phone: "+2349999999999",
      summary: "Unknown number asking about an order.",
    });
    check("an unknown number can still be flagged", flagUnknown.ok === true, flagUnknown);

    // --------------------------------------------------- ledger integrity ---
    section("Ledger integrity");
    const invoicesCsv = fs.readFileSync(path.join(dir, "invoices.csv"), "utf8");
    const inv104 = invoicesCsv.split("\n").find((line) => line.startsWith("INV-104"));
    check("INV-104 is written as fully paid once", inv104?.includes("2400000,2400000") === true, inv104);
    // A payment raised from the second line must file under the primary
    // number, or the balance would split in two.
    const secondLink = await call("create_payment_link", {
      phone: ADA_SECOND,
      invoice_ids: ["INV-107"],
      amount_ngn: 650_000,
    });
    check("the second line can raise a payment link", secondLink.ok === true, secondLink);

    const paymentsCsv = fs.readFileSync(path.join(dir, "payments.csv"), "utf8");
    check(
      "the seed payment rows are untouched",
      paymentsCsv.includes("KG-SEED-0001,ACC-ADA,+2348020000001,INV-101,720000,success"),
    );
    check(
      "it is filed under the account, with the second line kept for audit",
      paymentsCsv.includes(`${secondLink.reference},ACC-ADA,${ADA_SECOND}`),
      paymentsCsv.split("\n").find((line) => line.startsWith(String(secondLink.reference))),
    );
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
      arguments: { phone: EMEKA, invoice_ids: ["INV-113"] },
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
      arguments: { phone: EMEKA, invoice_ids: ["INV-113"] },
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
