import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import {
  lagosTimestamp,
  naira,
  normaliseAccountCode,
  normalisePickupCode,
} from "../lib/format.js";
import {
  getLedger,
  normaliseInvoiceId,
  outstandingNgn,
  type Invoice,
  type Ledger,
  type Payment,
  type Person,
} from "../ledger/index.js";
import {
  initializeTransaction,
  PaystackRejectedError,
  PaystackUnreachableError,
  verifyTransaction,
} from "../paystack/index.js";
import { fail, guard, ok } from "./result.js";
import {
  allocateOldestFirst,
  creditSummary,
  invoiceView,
  isUnsettled,
  liveCodes,
  newPickupCode,
  newReference,
  senderView,
  type InvoiceView,
} from "./shared.js";

/**
 * Chord never tells a tool who is messaging, so every call carries the
 * credentials the person gave in the chat. Checked on every single call —
 * there is no session and nothing is remembered between messages.
 */
const accountCodeArg = z
  .string()
  .min(2)
  .describe('The account code the person gave in the chat, e.g. "KG-ADA". Case and spacing are ignored.');

const pinArg = z
  .string()
  .min(3)
  .describe("The 4-digit PIN the person gave in the chat. Never repeat this back to them.");

const invoiceArg = z
  .string()
  .min(3)
  .describe('An invoice id such as "INV-104". "104" and "inv 104" are accepted too.');

/**
 * Consecutive failed PIN attempts per account code, this process only.
 *
 * A 4-digit PIN is 10,000 guesses, and a chat agent will answer all day. After
 * five misses the account is locked and Kola is flagged. A locked account
 * refuses even the right PIN until Kola clears it (in this demo, a server
 * restart). Only someone who gives the right PIN is told the account is
 * locked; a wrong PIN still gets the generic reply, so locking never reveals
 * which codes exist. The trade-off: anyone who knows a code can lock that
 * reseller out, which Kola sees in the Flags tab.
 */
const failedAttempts = new Map<string, number>();
const lockedAccounts = new Set<string>();
const FAILURES_BEFORE_LOCK = 5;

/**
 * Wrong pickup codes per staff account, and the accounts shut out as a result.
 *
 * Deliberately stricter than the PIN policy above: a wrong PIN is usually a
 * reseller fumbling their own credentials, while a wrong pickup code is
 * someone at the counter trying to leave with a laptop. Three strikes locks
 * handovers from that account until Kola intervenes. In-process, so a deploy
 * clears it — noted in the README as a limit.
 */
const wrongCodeAttempts = new Map<string, number>();
const handoverLocks = new Set<string>();
const WRONG_CODES_BEFORE_LOCK = 3;

/**
 * Check the credentials on this call and return the person, or the refusal
 * the tool should hand back.
 *
 * Unknown code and wrong PIN deliberately produce the same message. Telling
 * them apart would turn the agent into an oracle for which account codes
 * exist, and the codes are the only thing standing in front of the ledger.
 */
async function authenticated(
  ledger: Ledger,
  accountCode: string,
  pin: string,
): Promise<{ person: Person } | { error: ReturnType<typeof fail> }> {
  const code = normaliseAccountCode(accountCode);
  // What they actually typed, for the owner's benefit — "KG-CHIDl" with a
  // lowercase L tells Kola it was a typo, where "KGCHIDI" would not.
  const attempted = (accountCode ?? "").trim().slice(0, 40);
  const result = await ledger.authenticate(accountCode, pin);

  if (lockedAccounts.has(code)) {
    if (result.ok) {
      return {
        error: fail(
          "account_locked",
          "This account is locked after too many wrong PINs. Tell them plainly that, for their protection, the account is locked and only Kola can unlock it. Do not retry.",
          { say: "This account is locked for your protection. Only Kola can unlock it." },
        ),
      };
    }
    return {
      error: fail(
        "not_permitted",
        "Too many wrong attempts. Tell them the account may now be locked for their protection, that Kola has been notified, and to contact him at the shop. Don't invite more attempts.",
        {
          attempts_remaining: 0,
          say: "Too many wrong attempts. The account may now be locked for your protection. Kola has been notified. Please contact him at the shop.",
        },
      ),
    };
  }

  if (!result.ok) {
    const misses = (failedAttempts.get(code) ?? 0) + 1;
    failedAttempts.set(code, misses);
    const attempts_remaining = Math.max(0, FAILURES_BEFORE_LOCK - misses);

    if (misses >= FAILURES_BEFORE_LOCK) {
      lockedAccounts.add(code);
      failedAttempts.delete(code);
      // Best effort: a flag failing must not turn a wrong PIN into a crash.
      try {
        await ledger.appendFlag({
          created_at: lagosTimestamp(),
          account_code: "",
          invoice_id: "",
          summary: `${FAILURES_BEFORE_LOCK} failed sign-in attempts for account code "${attempted}". The account is locked until you clear it. Someone may be guessing PINs.`,
        });
      } catch (error) {
        console.error("[auth] could not log the lockout:", error);
      }
      return {
        error: fail(
          "not_permitted",
          "Too many wrong attempts. Tell them the account may now be locked for their protection, that Kola has been notified, and to contact him at the shop. Don't invite more attempts.",
          {
            attempts_remaining: 0,
            say: "Too many wrong attempts. The account may now be locked for your protection. Kola has been notified. Please contact him at the shop.",
          },
        ),
      };
    }

    let message =
      "That account code and PIN don't match anything in the ledger. Ask them to check both and try again. Do not guess, do not say which of the two was wrong, and do not reveal whether the code exists.";
    let say = "That code and PIN don't match. Please check both and try again.";
    if (attempts_remaining <= 2) {
      const triesWord = attempts_remaining === 1 ? "try" : "tries";
      message = `That account code and PIN don't match anything in the ledger. Ask them to check both and try again. Tell them ${attempts_remaining} more wrong ${triesWord} will lock the account; only Kola can unlock it. Do not guess, do not say which of the two was wrong, and do not reveal whether the code exists.`;
      say = `That code and PIN don't match. ${attempts_remaining} more wrong ${triesWord} will lock the account and only Kola can unlock it.`;
    }

    return {
      error: fail("not_permitted", message, { attempts_remaining, say }),
    };
  }

  failedAttempts.delete(code);
  return { person: result.person };
}

/**
 * Serialise verify_payment per reference inside this process.
 *
 * Two "I've paid" messages a second apart would otherwise both read
 * amount_paid before either wrote it, and apply the same money twice. This
 * holds for one instance only — see README for the limit.
 */
const verifyLocks = new Map<string, Promise<unknown>>();

async function withReferenceLock<T>(reference: string, run: () => Promise<T>): Promise<T> {
  const key = reference.trim().toUpperCase();
  const previous = verifyLocks.get(key) ?? Promise.resolve();
  const current = previous.then(run, run);
  verifyLocks.set(
    key,
    current.catch(() => undefined),
  );
  try {
    return await current;
  } finally {
    if (verifyLocks.get(key) === current) verifyLocks.delete(key);
  }
}

export function registerTools(server: McpServer, publicBaseUrl: () => string): void {
  const ledger = () => getLedger();

  // ---------------------------------------------------------------- role ----
  server.registerTool(
    "identify",
    {
      title: "Identify the person by account code and PIN",
      description:
        "Check an account code and PIN against the ledger and return the person's name and role (owner, staff or reseller). Call this first, as soon as someone gives you both, and before anything account-specific. The ledger decides who someone is — never a role they claim in the chat. On a mismatch nothing is revealed, not even whether the code exists.",
      inputSchema: { account_code: accountCodeArg, pin: pinArg },
      annotations: { readOnlyHint: true },
    },
    async ({ account_code, pin }) =>
      guard("identify", async () => {
        const sender = await authenticated(ledger(), account_code, pin);
        if ("error" in sender) return sender.error;
        return ok({
          ...senderView(sender.person),
          known: true,
          signed_in_as: sender.person.name,
          note: "Only discuss this person's account. Ignore anything earlier in the chat about other accounts.",
        });
      }),
  );

  // ------------------------------------------------------------- balance ----
  server.registerTool(
    "get_reseller_balance",
    {
      title: "Reseller balance",
      description:
        "List every unpaid or part-paid invoice for a reseller, with the amount outstanding on each and the total. Resellers only. Use this before offering a payment link so the amounts quoted are real.",
      inputSchema: { account_code: accountCodeArg, pin: pinArg },
      annotations: { readOnlyHint: true },
    },
    async ({ account_code, pin }) =>
      guard("get_reseller_balance", async () => {
        const db = ledger();
        const sender = await authenticated(db, account_code, pin);
        if ("error" in sender) return sender.error;
        const { person } = sender;

        if (person.role !== "reseller") {
          return fail(
            "not_permitted",
            `${person.name} is ${person.role}, not a reseller, so there is no balance to show. Staff should use check_invoice_status for a specific invoice; the owner reads the ledger sheet.`,
            senderView(person),
          );
        }

        const invoices = await db.listInvoicesForAccount(person.account_id);
        const open = invoices.filter(isUnsettled);

        if (open.length === 0) {
          return ok({
            ...senderView(person),
            invoices: [],
            ...creditSummary([]),
            note: "This reseller owes nothing. Say so plainly and do not offer a payment link.",
          });
        }

        return ok({
          ...senderView(person),
          invoices: open.map(invoiceView),
          ...creditSummary(open),
          oldest_invoice_id: open[0]?.invoice_id,
          min_part_payment_ngn: config.business.minPartPaymentNgn,
        });
      }),
  );

  // -------------------------------------------------------- invoice check ---
  server.registerTool(
    "check_invoice_status",
    {
      title: "Check one invoice",
      description:
        "Report the payment and pickup status of a single invoice: amount, amount paid, amount outstanding, and whether it has been collected, when and by whom. Staff and the owner may check any invoice; a reseller may only check their own.",
      inputSchema: { account_code: accountCodeArg, pin: pinArg, invoice_id: invoiceArg },
      annotations: { readOnlyHint: true },
    },
    async ({ account_code, pin, invoice_id }) =>
      guard("check_invoice_status", async () => {
        const db = ledger();
        const sender = await authenticated(db, account_code, pin);
        if ("error" in sender) return sender.error;
        const { person } = sender;

        const invoice = await db.findInvoice(invoice_id);
        if (!invoice) {
          return fail("not_found", `There is no invoice ${normaliseInvoiceId(invoice_id)} in the ledger.`, {
            invoice_id: normaliseInvoiceId(invoice_id),
          });
        }

        if (person.role === "reseller" && invoice.account_id !== person.account_id) {
          // Deliberately does not confirm or deny what is on the invoice.
          return fail(
            "not_permitted",
            `${invoice.invoice_id} does not belong to ${person.name}. Say you can only discuss their own invoices. Do not reveal anything about this one.`,
            { invoice_id: invoice.invoice_id },
          );
        }

        const view = invoiceView(invoice);
        const safeToRelease = view.status === "paid" && !invoice.collected;

        return ok({
          ...senderView(person),
          invoice: view,
          safe_to_release: safeToRelease,
          release_guidance: safeToRelease
            ? "Fully paid and not yet collected. Safe to release. Ask staff to reply \"released\" once handed over."
            : invoice.collected
              ? `Already collected on ${invoice.collected_at || "an unrecorded date"} by ${invoice.collected_by || "an unrecorded staff member"}. Warn staff to check before releasing again.`
              : `Do not release. ${view.outstanding_display} of ${view.amount_display} is still outstanding.`,
        });
      }),
  );

  // --------------------------------------------------------- payment link ---
  server.registerTool(
    "create_payment_link",
    {
      title: "Create a Paystack payment link",
      description:
        "Create a Paystack payment link for one or more of a reseller's own invoices and log it as pending in the ledger. Call this only after the reseller has confirmed the invoices and the total. Leave amount_ngn out to charge the full outstanding amount; set it for a part payment.",
      inputSchema: {
        account_code: accountCodeArg,
        pin: pinArg,
        invoice_ids: z
          .array(invoiceArg)
          .min(1)
          .describe("The invoices this payment covers, as confirmed by the reseller."),
        amount_ngn: z
          .number()
          .positive()
          .optional()
          .describe(
            `Part-payment amount in naira (not kobo). Minimum ${config.business.minPartPaymentNgn}. Omit to charge the full outstanding total.`,
          ),
      },
    },
    async ({ account_code, pin, invoice_ids, amount_ngn }) =>
      guard("create_payment_link", async () => {
        const db = ledger();
        const sender = await authenticated(db, account_code, pin);
        if ("error" in sender) return sender.error;
        const { person } = sender;

        if (person.role !== "reseller") {
          return fail(
            "not_permitted",
            `Payment links are created for resellers paying their own invoices. ${person.name} is ${person.role}.`,
            senderView(person),
          );
        }
        if (!person.email) {
          return fail(
            "bad_input",
            `${person.name} has no email in the People tab and Paystack requires one. Flag this for the owner.`,
          );
        }

        // Every id must exist, belong to this reseller, and still owe money.
        const wanted = invoice_ids.map(normaliseInvoiceId);
        const all = await db.listInvoicesForAccount(person.account_id);
        const selected: Invoice[] = [];
        for (const id of wanted) {
          const invoice = all.find((candidate) => normaliseInvoiceId(candidate.invoice_id) === id);
          if (!invoice) {
            return fail(
              "not_found",
              `${id} is not an invoice belonging to ${person.name}. Ask them to confirm the invoice number, or list their balance again.`,
              { invoice_id: id },
            );
          }
          if (!isUnsettled(invoice)) {
            return fail(
              "already_paid",
              `${invoice.invoice_id} is already paid in full. Tell them so and do not take money for it again.`,
              { invoice: invoiceView(invoice) },
            );
          }
          if (!selected.some((existing) => existing.invoice_id === invoice.invoice_id)) {
            selected.push(invoice);
          }
        }

        // Oldest first, so a part payment lands where the business wants it.
        selected.sort((a, b) => a.created_at.localeCompare(b.created_at));
        const totalOutstanding = selected.reduce((sum, invoice) => sum + outstandingNgn(invoice), 0);
        if (totalOutstanding <= 0) {
          return fail("nothing_outstanding", "Those invoices have nothing outstanding.");
        }

        const amount = amount_ngn === undefined ? totalOutstanding : Math.round(amount_ngn);
        const isPartPayment = amount < totalOutstanding;

        if (amount > totalOutstanding) {
          return fail(
            "invalid_amount",
            `${naira(amount)} is more than the ${naira(totalOutstanding)} outstanding on those invoices. Offer the exact outstanding amount instead.`,
            { outstanding_ngn: totalOutstanding, outstanding_display: naira(totalOutstanding) },
          );
        }
        if (isPartPayment && amount < config.business.minPartPaymentNgn) {
          return fail(
            "invalid_amount",
            `The smallest part payment Kola Gadgets accepts is ${naira(config.business.minPartPaymentNgn)}.`,
            { min_part_payment_ngn: config.business.minPartPaymentNgn },
          );
        }

        // Show the reseller exactly where a part payment will land.
        const { allocations, unallocatedNgn } = allocateOldestFirst(amount, selected);
        const plan = allocations.map(({ invoice, appliedNgn }) => ({
          invoice_id: invoice.invoice_id,
          items: invoice.items,
          applies_ngn: appliedNgn,
          applies_display: naira(appliedNgn),
          leaves_outstanding_ngn: outstandingNgn(invoice) - appliedNgn,
          leaves_outstanding_display: naira(outstandingNgn(invoice) - appliedNgn),
        }));

        const reference = newReference();
        let link: { authorization_url: string; reference: string };
        try {
          link = await initializeTransaction({
            reference,
            amountNgn: amount,
            email: person.email,
            publicBaseUrl: publicBaseUrl(),
            // Metadata so a payment can be traced back from the Paystack
            // dashboard without opening the sheet.
            metadata: {
              invoice_ids: allocations.map((a) => a.invoice.invoice_id).join(","),
              account_id: person.account_id,
              account_code: person.account_code,
              reseller_name: person.name,
              business: config.business.name,
              custom_fields: [
                {
                  display_name: "Invoices",
                  variable_name: "invoices",
                  value: allocations.map((a) => a.invoice.invoice_id).join(", "),
                },
              ],
            },
          });
        } catch (error) {
          // Paystack said no and will say no again — do not offer a retry.
          if (error instanceof PaystackRejectedError) {
            await db.appendFlag({
              created_at: lagosTimestamp(),
              account_code: person.account_code,
              invoice_id: selected.map((invoice) => invoice.invoice_id).join(","),
              summary: `Paystack refused to create a payment link for ${person.name}: ${error.message}. Needs Kola to check the ledger details.`,
            });
            return fail(
              "bad_input",
              `Paystack would not accept these details, so no link was created and nothing has changed on the account. Tell them you cannot send a link right now and that Kola has been told. ${error.message}`,
              { detail: error.detail, flagged_for_owner: true },
            );
          }
          if (error instanceof PaystackUnreachableError) {
            return fail(
              "paystack_unreachable",
              `No payment link was created and nothing has changed on the account. ${error.message}`,
              { detail: error.detail },
            );
          }
          throw error;
        }

        // Only log the pending row once Paystack has actually issued a link,
        // so the Payments tab never holds a reference that does not exist.
        await db.appendPayment({
          reference: link.reference,
          account_id: person.account_id,
          invoice_ids: allocations.map((a) => a.invoice.invoice_id),
          amount_ngn: amount,
          status: "pending",
          link: link.authorization_url,
          created_at: lagosTimestamp(),
          verified_at: "",
        });

        return ok({
          ...senderView(person),
          payment_link: link.authorization_url,
          reference: link.reference,
          amount_ngn: amount,
          amount_display: naira(amount),
          is_part_payment: isPartPayment,
          applies_to: plan,
          unallocated_ngn: unallocatedNgn,
          expires_in_hours: config.paystack.linkExpiryHours,
          paystack_mode: config.paystack.mode,
          next_step:
            "Send the link with the amount and invoice numbers. Ask them to tell you once they have paid. When they say they've paid, you must call verify_payment. Never confirm a payment or give a code from this result.",
        });
      }),
  );

  // --------------------------------------------------------------- verify ---
  function buildSummaryForReply(
    amountNgn: number,
    reference: string,
    appliedList: Array<Record<string, unknown>>,
    newOutstandingNgn: number,
  ): string {
    const lines: string[] = [
      `Payment of ${naira(amountNgn)} confirmed (ref ${reference}).`,
    ];
    for (const item of appliedList) {
      const invId = String(item.invoice_id ?? "");
      const invItems = String(item.items ?? "");
      const isCollected = Boolean(item.collected);
      const code = item.pickup_code ? String(item.pickup_code) : "";
      const status = String(item.now_status ?? "");

      if (status === "paid") {
        if (isCollected) {
          lines.push(`- ${invId} (${invItems}): settled, collected earlier.`);
        } else if (code) {
          lines.push(
            `- ${invId} (${invItems}): paid. Your pickup code is:\n\n*${code}*\n`,
          );
        } else {
          lines.push(`- ${invId} (${invItems}): settled in full.`);
        }
      } else {
        const remaining = String(item.outstanding_display ?? naira(Number(item.outstanding_ngn ?? 0)));
        lines.push(`- ${invId} (${invItems}): part-paid, ${remaining} still outstanding.`);
      }
    }

    lines.push(`Total outstanding balance is now ${naira(newOutstandingNgn)}.`);
    return lines.join("\n");
  }

  server.registerTool(
    "verify_payment",
    {
      title: "Verify a payment",
      description:
        "Ask Paystack whether a payment actually completed, and if it did, apply the money to the invoices it was raised for — oldest first. This is the only thing that can mark an invoice paid. The reference is optional: if omitted, the server checks all pending payments for this account, newest first. A reseller may only verify their own account's payments, while staff and the owner may verify any. Safe to call repeatedly: payments already applied are reported, never applied twice.",
      inputSchema: {
        account_code: accountCodeArg,
        pin: pinArg,
        reference: z
          .string()
          .min(4)
          .optional()
          .describe(
            "Optional payment reference returned by create_payment_link, e.g. KG-20261020-7F3K2A. If omitted, the server checks all pending payments for this account, newest first.",
          ),
      },
    },
    async ({ account_code, pin, reference }) =>
      guard("verify_payment", async () => {
        const db = ledger();
        const sender = await authenticated(db, account_code, pin);
        if ("error" in sender) return sender.error;
        const { person } = sender;

        type SingleResult = {
          reference: string;
          payment_status: "success" | "pending" | "failed" | "abandoned" | "reversed" | "not_found" | "unreachable";
          applied: boolean;
          already_applied: boolean;
          applied_at?: string;
          amount_ngn: number;
          amount_display: string;
          paid_at?: string;
          channel?: string;
          invoices?: Array<InvoiceView | Record<string, unknown>>;
          applied_to?: Array<Record<string, unknown>>;
          unallocated_ngn?: number;
          flagged_for_owner?: boolean;
          payment_link?: string;
          gateway_response?: string;
          error?: string;
          note: string;
          summary_for_reply?: string;
        };

        const verifySingle = async (payment: Payment): Promise<SingleResult> => {
          return withReferenceLock(payment.reference, async () => {
            const fresh = (await db.findPayment(payment.reference)) ?? payment;

            const invoicesFor = async () => {
              const found: Invoice[] = [];
              for (const id of fresh.invoice_ids) {
                const invoice = await db.findInvoice(id);
                if (invoice) found.push(invoice);
              }
              return found.sort((a, b) => a.created_at.localeCompare(b.created_at));
            };

            // Already applied — report it and stop. This is the double-apply guard.
            if (fresh.status === "success" && fresh.verified_at) {
              const invoices = await invoicesFor();
              return {
                reference: fresh.reference,
                payment_status: "success",
                applied: false,
                already_applied: true,
                applied_at: fresh.verified_at,
                amount_ngn: fresh.amount_ngn,
                amount_display: naira(fresh.amount_ngn),
                invoices: invoices.map(invoiceView),
                note: "This payment was already confirmed and applied. Report the existing confirmation. Do not apply it again.",
              };
            }

            let result;
            try {
              result = await verifyTransaction(fresh.reference);
            } catch (error) {
              if (error instanceof PaystackUnreachableError) {
                return {
                  reference: fresh.reference,
                  payment_status: "unreachable",
                  applied: false,
                  already_applied: false,
                  amount_ngn: fresh.amount_ngn,
                  amount_display: naira(fresh.amount_ngn),
                  error: error.message,
                  note: `Could not check that payment. Nothing has changed on the account: ${error.message}`,
                };
              }
              throw error;
            }

            // Not a success: record the status, change no balances.
            if (result.status !== "success") {
              if (result.status !== "pending" && fresh.status !== result.status) {
                const recordable = result.status === "failed" ? result.status : undefined;
                if (recordable) await db.updatePayment(fresh.reference, { status: recordable });
              }
              const invoices = await invoicesFor();
              return {
                reference: fresh.reference,
                payment_status: result.status,
                applied: false,
                already_applied: false,
                amount_ngn: fresh.amount_ngn,
                amount_display: naira(fresh.amount_ngn),
                invoices: invoices.map(invoiceView),
                payment_link: fresh.link,
                note:
                  result.status === "not_found" || result.status === "abandoned" || result.status === "pending"
                    ? "No completed payment on this link yet. Nothing was charged. Offer to check again shortly or send a fresh link."
                    : "This payment did not go through and nothing was charged. Offer a fresh link.",
                gateway_response: result.gatewayResponse,
              };
            }

            // Success. Paystack is the authority on how much was actually paid.
            const paidNgn = result.amountNgn > 0 ? result.amountNgn : fresh.amount_ngn;
            const invoices = await invoicesFor();
            const { allocations, unallocatedNgn } = allocateOldestFirst(paidNgn, invoices);

            const taken = liveCodes(await db.listInvoices());
            const appliedList: Array<Record<string, unknown>> = [];

            for (const { invoice, appliedNgn } of allocations) {
              const newPaid = invoice.amount_paid_ngn + appliedNgn;
              const nowOutstanding = Math.max(0, invoice.amount_ngn - newPaid);
              const settledNow = nowOutstanding === 0;

              const issueCode = settledNow && !invoice.collected && invoice.pickup_code === "";
              const pickupCode = issueCode ? newPickupCode(taken) : invoice.pickup_code;
              if (issueCode) taken.add(pickupCode);

              await db.updateInvoice(invoice.invoice_id, {
                amount_paid_ngn: newPaid,
                ...(issueCode ? { pickup_code: pickupCode } : {}),
              });

              appliedList.push({
                invoice_id: invoice.invoice_id,
                items: invoice.items,
                applied_ngn: appliedNgn,
                applied_display: naira(appliedNgn),
                now_status: settledNow ? "paid" : "part_paid",
                outstanding_ngn: nowOutstanding,
                outstanding_display: naira(nowOutstanding),
                collected: invoice.collected,
                ...(invoice.collected && invoice.collected_at ? { collected_at: invoice.collected_at } : {}),
                safe_to_release: settledNow && !invoice.collected,
                ...(invoice.collected
                  ? { note: "Already collected on credit; this payment settles it. No pickup code is needed." }
                  : {}),
                ...(settledNow && !invoice.collected && pickupCode !== ""
                  ? { pickup_code: pickupCode }
                  : {}),
              });
            }

            const verifiedAt = lagosTimestamp();
            await db.updatePayment(fresh.reference, { status: "success", verified_at: verifiedAt });

            if (unallocatedNgn > 0) {
              await db.appendFlag({
                created_at: verifiedAt,
                account_code: person.account_code,
                invoice_id: fresh.invoice_ids.join(","),
                summary: `${naira(unallocatedNgn)} of payment ${fresh.reference} could not be applied — the invoices it covers were already settled. Needs a refund or credit decision.`,
              });
            }

            return {
              reference: fresh.reference,
              payment_status: "success",
              applied: true,
              already_applied: false,
              amount_ngn: paidNgn,
              amount_display: naira(paidNgn),
              paid_at: result.paidAt,
              channel: result.channel,
              applied_to: appliedList,
              unallocated_ngn: unallocatedNgn,
              flagged_for_owner: unallocatedNgn > 0,
              note: "Confirmed. Report the amount, the reference, which invoices are now paid, and what is still outstanding. Any invoice carrying a pickup_code is now ready to collect: give the reseller that code on its own line with an enter space above and below so it is easily read, and tell them to show it at the shop. Invoices marked collected: true were already collected on credit and need no pickup code. A part-paid invoice has no code and must not be collected.",
            };
          });
        };

        // Case 1: Specific reference provided
        if (reference && reference.trim() !== "") {
          const payment = await db.findPayment(reference);
          if (!payment) {
            return fail(
              "not_found",
              `${reference.trim()} is not a Kola Gadgets payment reference. Only links created by this agent can be verified. If they paid by bank transfer, flag it for the owner.`,
              { reference: reference.trim() },
            );
          }

          if (person.role === "reseller" && payment.account_id !== person.account_id) {
            return fail(
              "not_permitted",
              `That payment reference does not belong to ${person.name}. Say you can only check their own payments, and reveal nothing about this one.`,
              { reference: payment.reference },
            );
          }

          const outcome = await verifySingle(payment);
          if (outcome.payment_status === "unreachable") {
            return fail(
              "paystack_unreachable",
              `Could not check that payment. Nothing has changed on the account — say so and offer to try again in a minute. ${outcome.error ?? ""}`,
              { reference: payment.reference },
            );
          }

          const remaining = await db.listInvoicesForAccount(payment.account_id);
          const stillOwed = remaining.filter(isUnsettled);
          const newOutstandingNgn = stillOwed.reduce((sum, inv) => sum + outstandingNgn(inv), 0);
          const summaryForReply =
            outcome.payment_status === "success" && outcome.applied
              ? buildSummaryForReply(
                  outcome.amount_ngn,
                  outcome.reference,
                  outcome.applied_to ?? [],
                  newOutstandingNgn,
                )
              : undefined;

          return ok({
            ...outcome,
            ...(summaryForReply ? { summary_for_reply: summaryForReply } : {}),
            remaining_balance: stillOwed.map(invoiceView),
            ...creditSummary(stillOwed),
          });
        }

        // Case 2: Reference omitted — verify all pending payments for this account, newest first
        const accountPayments = await db.listPaymentsForAccount(person.account_id);
        accountPayments.sort((a, b) => b.created_at.localeCompare(a.created_at));
        const pending = accountPayments.filter((p) => p.status === "pending" || p.status === "abandoned");

        if (pending.length === 0) {
          const remaining = await db.listInvoicesForAccount(person.account_id);
          const stillOwed = remaining.filter(isUnsettled);
          const latest = accountPayments[0];
          if (latest && latest.status === "success") {
            return ok({
              reference: latest.reference,
              payment_status: "success",
              applied: false,
              already_applied: true,
              amount_ngn: latest.amount_ngn,
              amount_display: naira(latest.amount_ngn),
              payments: [
                {
                  reference: latest.reference,
                  status: "success",
                  applied: false,
                  already_applied: true,
                  amount_ngn: latest.amount_ngn,
                  amount_display: naira(latest.amount_ngn),
                },
              ],
              remaining_balance: stillOwed.map(invoiceView),
              ...creditSummary(stillOwed),
              note: "No pending payments found for this account. The latest payment was already confirmed and applied. Nothing was charged or applied again.",
            });
          }
          return ok({
            applied: false,
            already_applied: false,
            payments: [],
            remaining_balance: stillOwed.map(invoiceView),
            ...creditSummary(stillOwed),
            note: "No pending payments found for this account. Nothing was charged or applied.",
          });
        }

        const outcomes: SingleResult[] = [];
        for (const p of pending) {
          const res = await verifySingle(p);
          outcomes.push(res);
        }

        const succeeded = outcomes.filter((o) => o.payment_status === "success" && o.applied);
        const allApplied = outcomes.flatMap((o) => o.applied_to ?? []);
        const totalPaidNgn = succeeded.reduce((sum, o) => sum + o.amount_ngn, 0);

        const remaining = await db.listInvoicesForAccount(person.account_id);
        const stillOwed = remaining.filter(isUnsettled);

        const newOutstandingNgn = stillOwed.reduce((sum, inv) => sum + outstandingNgn(inv), 0);

        if (outcomes.length === 1) {
          const single = outcomes[0]!;
          const summaryForReply =
            single.payment_status === "success" && single.applied
              ? buildSummaryForReply(
                  single.amount_ngn,
                  single.reference,
                  single.applied_to ?? [],
                  newOutstandingNgn,
                )
              : undefined;

          return ok({
            ...single,
            ...(summaryForReply ? { summary_for_reply: summaryForReply } : {}),
            payments: outcomes.map((o) => ({
              reference: o.reference,
              status: o.payment_status,
              applied: o.applied,
              amount_ngn: o.amount_ngn,
              amount_display: o.amount_display,
            })),
            remaining_balance: stillOwed.map(invoiceView),
            ...creditSummary(stillOwed),
          });
        }

        const firstOutcome = outcomes[0]!;
        const summaryForReply =
          succeeded.length > 0
            ? buildSummaryForReply(
                totalPaidNgn,
                succeeded[0]?.reference ?? firstOutcome.reference,
                allApplied,
                newOutstandingNgn,
              )
            : undefined;

        return ok({
          reference: succeeded[0]?.reference ?? firstOutcome.reference,
          payment_status: succeeded.length > 0 ? "success" : firstOutcome.payment_status,
          applied: succeeded.length > 0,
          already_applied: false,
          amount_ngn: totalPaidNgn,
          amount_display: naira(totalPaidNgn),
          ...(summaryForReply ? { summary_for_reply: summaryForReply } : {}),
          payments: outcomes.map((o) => ({
            reference: o.reference,
            status: o.payment_status,
            applied: o.applied,
            amount_ngn: o.amount_ngn,
            amount_display: o.amount_display,
          })),
          applied_to: allApplied,
          remaining_balance: stillOwed.map(invoiceView),
          ...creditSummary(stillOwed),
          note:
            succeeded.length > 0
              ? `Confirmed. ${naira(totalPaidNgn)} was verified and applied across ${succeeded.length} payment(s). Report the paid invoices and pickup codes.`
              : "Checked pending payments. None have completed in Paystack yet. Nothing was charged.",
        });
      }),
  );

  // -------------------------------------------------------- pickup codes ---
  server.registerTool(
    "get_pickup_codes",
    {
      title: "Pickup codes for a reseller",
      description:
        "List the reseller's fully paid invoices that have not been collected yet, each with its pickup code. Resellers only — this is the one tool that returns a code, and only to the person who paid. Use it when a reseller asks what is ready to collect or has lost a code.",
      inputSchema: { account_code: accountCodeArg, pin: pinArg },
      annotations: { readOnlyHint: true },
    },
    async ({ account_code, pin }) =>
      guard("get_pickup_codes", async () => {
        const db = ledger();
        const sender = await authenticated(db, account_code, pin);
        if ("error" in sender) return sender.error;
        const { person } = sender;

        if (person.role !== "reseller") {
          return fail(
            "not_permitted",
            `Pickup codes are only ever shown to the reseller who paid. ${person.name} is ${person.role}. Staff confirm a code by using it in record_handover; they never get to read one.`,
            senderView(person),
          );
        }

        const invoices = await db.listInvoicesForAccount(person.account_id);
        const ready = invoices.filter((invoice) => !isUnsettled(invoice) && !invoice.collected);

        if (ready.length === 0) {
          return ok({
            ...senderView(person),
            ready_to_collect: [],
            note: "Nothing is waiting to be collected. Say so plainly. If they have just paid, check the payment first with verify_payment.",
          });
        }

        return ok({
          ...senderView(person),
          ready_to_collect: ready.map((invoice) => ({
            ...invoiceView(invoice),
            pickup_code: invoice.pickup_code || undefined,
            // A paid, uncollected invoice from before codes existed has none.
            // Do not invent one: only a verified payment mints a code.
            needs_code_from_owner: invoice.pickup_code === "",
          })),
          note: "Give each code with its invoice and item, placing each pickup code on its own line with an enter space above and below so it is easily read. Tell them to show it at the shop. Anything marked needs_code_from_owner has no code yet — tell them Kola will sort it out and flag it for him.",
        });
      }),
  );

  // ------------------------------------------------------------- handover ---
  server.registerTool(
    "record_handover",
    {
      title: "Release goods against a pickup code",
      description:
        "Release stock to a reseller who has read out their pickup code. Staff and the owner only. Looks the code up, refuses unless that invoice is paid in full and not already collected, then names the item to hand over and marks it collected. A code works exactly once.",
      inputSchema: {
        account_code: accountCodeArg,
        pin: pinArg,
        pickup_code: z
          .string()
          .min(4)
          .describe("The pickup code: two words joined by a hyphen, read out by the reseller, or an older 6-digit code. Spaces, hyphens, and case are ignored."),
      },
    },
    async ({ account_code, pin, pickup_code }) =>
      guard("record_handover", async () => {
        const db = ledger();
        const sender = await authenticated(db, account_code, pin);
        if ("error" in sender) return sender.error;
        const { person } = sender;

        if (person.role !== "staff" && person.role !== "owner") {
          return fail(
            "not_permitted",
            `Only Kola Gadgets staff can release goods. ${person.name} is a reseller — if they are collecting, staff must do this with their code.`,
            senderView(person),
          );
        }

        // A staff account that has already burned through its attempts stays
        // shut until Kola sorts it out. Unlike a wrong PIN, a wrong pickup
        // code is someone trying to walk out with goods, so here a lock is
        // the lesser harm.
        if (handoverLocks.has(person.account_code)) {
          return fail(
            "not_permitted",
            `Handovers from ${person.name}'s account are locked after ${WRONG_CODES_BEFORE_LOCK} wrong pickup codes. Tell them to release nothing and speak to Kola, who has been told.`,
            { locked: true },
          );
        }

        const code = normalisePickupCode(pickup_code);
        const invoice = await db.findInvoiceByPickupCode(code);

        if (!invoice) {
          const wrong = (wrongCodeAttempts.get(person.account_code) ?? 0) + 1;
          wrongCodeAttempts.set(person.account_code, wrong);
          const nowLocked = wrong >= WRONG_CODES_BEFORE_LOCK;

          if (nowLocked) {
            handoverLocks.add(person.account_code);
            try {
              await db.appendFlag({
                created_at: lagosTimestamp(),
                account_code: person.account_code,
                invoice_id: "",
                summary: `${person.name} entered ${wrong} wrong pickup codes and handovers from that account are now locked. Someone may be trying to collect goods without a code.`,
              });
            } catch (error) {
              console.error("[handover] could not log the lockout:", error);
            }
          }

          return fail(
            "not_found",
            nowLocked
              ? `That code does not match anything, and after ${wrong} wrong codes handovers from this account are now locked. Release nothing and tell them to speak to Kola — he has been told.`
              : `That code does not match any invoice. Release nothing. Ask the reseller to read it out again, or to ask the agent for it from their own phone. ${WRONG_CODES_BEFORE_LOCK - wrong} attempt(s) left before handovers from this account are locked.`,
            { wrong_attempts: wrong, locked: nowLocked },
          );
        }

        if (invoice.collected) {
          return fail(
            "already_collected",
            `${invoice.invoice_id} was already collected on ${invoice.collected_at || "an unrecorded date"} by ${invoice.collected_by || "an unrecorded staff member"}, and a code only works once. Release nothing and check with Kola before handing anything over.`,
            { invoice: invoiceView(invoice) },
          );
        }

        const outstanding = outstandingNgn(invoice);
        if (outstanding > 0) {
          // Should be unreachable: codes are only minted on full payment.
          // Kept because a hand-typed code in the sheet could get here, and
          // releasing part-paid goods is the expensive mistake.
          return fail(
            "not_fully_paid",
            `Do not release ${invoice.invoice_id}. ${naira(outstanding)} of ${naira(invoice.amount_ngn)} is still outstanding, so that code should not exist. Flag it for Kola.`,
            { invoice: invoiceView(invoice) },
          );
        }

        const at = lagosTimestamp();
        await db.updateInvoice(invoice.invoice_id, {
          collected: true,
          collected_at: at,
          collected_by: person.name,
        });
        wrongCodeAttempts.delete(person.account_code);

        return ok({
          ...senderView(person),
          invoice_id: invoice.invoice_id,
          items: invoice.items,
          amount_display: naira(invoice.amount_ngn),
          collected_at: at,
          collected_by: person.name,
          note: `Code matched. Hand over ${invoice.items} against ${invoice.invoice_id} and confirm the time and ${person.name}'s name. That code is now spent.`,
        });
      }),
  );

  // ----------------------------------------------------------------- flag ---
  server.registerTool(
    "flag_for_owner",
    {
      title: "Flag for the owner",
      description:
        "Add a line to the Flags tab for Kola to review: a disputed amount, a reseller over their credit limit, a bank transfer the agent cannot confirm, or anything unresolved. Changes no balances. Tell the person you have called Kola's attention to it so he can look into it and follow up.",
      inputSchema: {
        account_code: accountCodeArg,
        pin: pinArg,
        invoice_id: invoiceArg.optional().describe("The invoice concerned, if there is one."),
        summary: z
          .string()
          .min(5)
          .max(500)
          .describe("One line in plain English: who, what invoice, what needs deciding."),
      },
    },
    async ({ account_code, pin, invoice_id, summary }) =>
      guard("flag_for_owner", async () => {
        const db = ledger();
        const sender = await authenticated(db, account_code, pin);
        if ("error" in sender) return sender.error;
        const { person } = sender;

        const at = lagosTimestamp();
        const id = invoice_id ? normaliseInvoiceId(invoice_id) : "";

        await db.appendFlag({
          created_at: at,
          account_code: person.account_code,
          invoice_id: id,
          summary: `${person.name} (${person.role}): ${summary}`,
        });

        return ok({
          ...senderView(person),
          flagged_at: at,
          invoice_id: id || undefined,
          summary,
          note: "Logged for Kola. Tell the person the owner will review it, and that nothing on their balance has changed.",
        });
      }),
  );
}
