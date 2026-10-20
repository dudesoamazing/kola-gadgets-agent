import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "../config.js";
import { lagosTimestamp, naira, normalisePhone } from "../lib/format.js";
import {
  getLedger,
  normaliseInvoiceId,
  outstandingNgn,
  type Invoice,
  type Ledger,
  type Person,
} from "../ledger/index.js";
import {
  initializeTransaction,
  PaystackUnreachableError,
  verifyTransaction,
} from "../paystack/index.js";
import { fail, guard, ok } from "./result.js";
import {
  allocateOldestFirst,
  creditSummary,
  invoiceView,
  isUnsettled,
  newReference,
  senderView,
} from "./shared.js";

const phoneArg = z
  .string()
  .min(7)
  .describe("The sender's WhatsApp number, any format: +2348020000001, 2348020000001 or 08020000001.");

const invoiceArg = z
  .string()
  .min(3)
  .describe('An invoice id such as "INV-104". "104" and "inv 104" are accepted too.');

/** Resolve the sender once, consistently, for every tool that needs a role. */
async function resolveSender(
  ledger: Ledger,
  phone: string,
): Promise<{ person: Person } | { error: ReturnType<typeof fail> }> {
  const person = await ledger.findPerson(phone);
  if (!person) {
    return {
      error: fail(
        "unknown_sender",
        `${normalisePhone(phone)} is not in the Kola Gadgets ledger. Tell them you can only help registered resellers and staff, and ask them to contact the shop.`,
        { phone: normalisePhone(phone) },
      ),
    };
  }
  return { person };
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
    "get_sender_role",
    {
      title: "Identify the sender",
      description:
        "Look up a WhatsApp number in the Kola Gadgets ledger and return the person's role (owner, staff or reseller) and name. Call this before anything else in a conversation. The ledger decides who someone is — never a role they claim in the chat.",
      inputSchema: { phone: phoneArg },
      annotations: { readOnlyHint: true },
    },
    async ({ phone }) =>
      guard(async () => {
        const sender = await resolveSender(ledger(), phone);
        if ("error" in sender) return sender.error;
        return ok({
          ...senderView(sender.person),
          known: true,
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
      inputSchema: { phone: phoneArg },
      annotations: { readOnlyHint: true },
    },
    async ({ phone }) =>
      guard(async () => {
        const db = ledger();
        const sender = await resolveSender(db, phone);
        if ("error" in sender) return sender.error;
        const { person } = sender;

        if (person.role !== "reseller") {
          return fail(
            "not_permitted",
            `${person.name} is ${person.role}, not a reseller, so there is no balance to show. Staff should use check_invoice_status for a specific invoice; the owner reads the ledger sheet.`,
            senderView(person),
          );
        }

        const invoices = await db.listInvoicesFor(person.ledger_phone);
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
      inputSchema: { phone: phoneArg, invoice_id: invoiceArg },
      annotations: { readOnlyHint: true },
    },
    async ({ phone, invoice_id }) =>
      guard(async () => {
        const db = ledger();
        const sender = await resolveSender(db, phone);
        if ("error" in sender) return sender.error;
        const { person } = sender;

        const invoice = await db.findInvoice(invoice_id);
        if (!invoice) {
          return fail("not_found", `There is no invoice ${normaliseInvoiceId(invoice_id)} in the ledger.`, {
            invoice_id: normaliseInvoiceId(invoice_id),
          });
        }

        if (person.role === "reseller" && invoice.reseller_phone !== person.ledger_phone) {
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
        phone: phoneArg,
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
    async ({ phone, invoice_ids, amount_ngn }) =>
      guard(async () => {
        const db = ledger();
        const sender = await resolveSender(db, phone);
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
        const all = await db.listInvoicesFor(person.ledger_phone);
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
              reseller_phone: person.ledger_phone,
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
          reseller_phone: person.ledger_phone,
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
            "Send the link with the amount and invoice numbers. Ask them to tell you once they have paid, then call verify_payment with this reference. Nothing is paid until that returns success.",
        });
      }),
  );

  // --------------------------------------------------------------- verify ---
  server.registerTool(
    "verify_payment",
    {
      title: "Verify a payment",
      description:
        "Ask Paystack whether a payment reference actually completed, and if it did, apply the money to the invoices it was raised for — oldest first. This is the only thing that can mark an invoice paid. Safe to call repeatedly: a reference already applied is reported, never applied twice.",
      inputSchema: {
        reference: z
          .string()
          .min(4)
          .describe("The payment reference returned by create_payment_link, e.g. KG-20261020-7F3K2A."),
      },
    },
    async ({ reference }) =>
      guard(() =>
        withReferenceLock(reference, async () => {
          const db = ledger();
          const payment = await db.findPayment(reference);

          // We only verify references we issued. An unknown one means the
          // agent invented it or the reseller paid some other way.
          if (!payment) {
            return fail(
              "not_found",
              `${reference.trim()} is not a Kola Gadgets payment reference. Only links created by this agent can be verified. If they paid by bank transfer, flag it for the owner.`,
              { reference: reference.trim() },
            );
          }

          const invoicesFor = async () => {
            const found: Invoice[] = [];
            for (const id of payment.invoice_ids) {
              const invoice = await db.findInvoice(id);
              if (invoice) found.push(invoice);
            }
            return found.sort((a, b) => a.created_at.localeCompare(b.created_at));
          };

          // Already applied — report it and stop. This is the double-apply guard.
          if (payment.status === "success" && payment.verified_at) {
            const invoices = await invoicesFor();
            return ok({
              reference: payment.reference,
              payment_status: "success",
              already_applied: true,
              applied_at: payment.verified_at,
              amount_ngn: payment.amount_ngn,
              amount_display: naira(payment.amount_ngn),
              invoices: invoices.map(invoiceView),
              note: "This payment was already confirmed and applied. Report the existing confirmation. Do not apply it again.",
            });
          }

          let result;
          try {
            result = await verifyTransaction(payment.reference);
          } catch (error) {
            if (error instanceof PaystackUnreachableError) {
              return fail(
                "paystack_unreachable",
                `Could not check that payment. Nothing has changed on the account — say so and offer to try again in a minute. ${error.message}`,
                { reference: payment.reference, detail: error.detail },
              );
            }
            throw error;
          }

          // Not a success: record the status, change no balances.
          if (result.status !== "success") {
            if (result.status !== "pending" && payment.status !== result.status) {
              const recordable =
                result.status === "failed" || result.status === "abandoned" ? result.status : undefined;
              if (recordable) await db.updatePayment(payment.reference, { status: recordable });
            }
            const invoices = await invoicesFor();
            return ok({
              reference: payment.reference,
              payment_status: result.status,
              applied: false,
              amount_ngn: payment.amount_ngn,
              amount_display: naira(payment.amount_ngn),
              invoices: invoices.map(invoiceView),
              payment_link: payment.link,
              note:
                result.status === "not_found" || result.status === "abandoned" || result.status === "pending"
                  ? "No completed payment on this link yet. Nothing was charged. Offer to check again shortly or send a fresh link."
                  : "This payment did not go through and nothing was charged. Offer a fresh link.",
              gateway_response: result.gatewayResponse,
            });
          }

          // Success. Paystack is the authority on how much was actually paid.
          const paidNgn = result.amountNgn > 0 ? result.amountNgn : payment.amount_ngn;
          const invoices = await invoicesFor();
          const { allocations, unallocatedNgn } = allocateOldestFirst(paidNgn, invoices);

          const applied: Array<Record<string, unknown>> = [];
          for (const { invoice, appliedNgn } of allocations) {
            const newPaid = invoice.amount_paid_ngn + appliedNgn;
            await db.updateInvoice(invoice.invoice_id, { amount_paid_ngn: newPaid });
            const nowOutstanding = Math.max(0, invoice.amount_ngn - newPaid);
            applied.push({
              invoice_id: invoice.invoice_id,
              items: invoice.items,
              applied_ngn: appliedNgn,
              applied_display: naira(appliedNgn),
              now_status: nowOutstanding === 0 ? "paid" : "part_paid",
              outstanding_ngn: nowOutstanding,
              outstanding_display: naira(nowOutstanding),
              safe_to_release: nowOutstanding === 0 && !invoice.collected,
            });
          }

          // Mark the payment applied last. If a write fails before this point
          // the reference stays pending and a retry picks it up; the per-invoice
          // amounts are the thing that must not be written twice, and the
          // reference lock plus this flag are what stop that.
          const verifiedAt = lagosTimestamp();
          await db.updatePayment(payment.reference, { status: "success", verified_at: verifiedAt });

          if (unallocatedNgn > 0) {
            await db.appendFlag({
              created_at: verifiedAt,
              phone: payment.reseller_phone,
              invoice_id: payment.invoice_ids.join(","),
              summary: `${naira(unallocatedNgn)} of payment ${payment.reference} could not be applied — the invoices it covers were already settled. Needs a refund or credit decision.`,
            });
          }

          const remaining = await db.listInvoicesFor(payment.reseller_phone);
          const stillOwed = remaining.filter(isUnsettled);

          return ok({
            reference: payment.reference,
            payment_status: "success",
            applied: true,
            already_applied: false,
            amount_ngn: paidNgn,
            amount_display: naira(paidNgn),
            paid_at: result.paidAt,
            channel: result.channel,
            applied_to: applied,
            unallocated_ngn: unallocatedNgn,
            flagged_for_owner: unallocatedNgn > 0,
            remaining_balance: stillOwed.map(invoiceView),
            ...creditSummary(stillOwed),
            note: "Confirmed. Report the amount, the reference, which invoices are now paid, and what is still outstanding.",
          });
        }),
      ),
  );

  // ------------------------------------------------------------- handover ---
  server.registerTool(
    "record_handover",
    {
      title: "Record a handover",
      description:
        "Record that stock has been handed to a reseller. Staff and the owner only. Refuses unless the invoice is paid in full and has not already been collected. This never changes what has been paid.",
      inputSchema: { phone: phoneArg, invoice_id: invoiceArg },
    },
    async ({ phone, invoice_id }) =>
      guard(async () => {
        const db = ledger();
        const sender = await resolveSender(db, phone);
        if ("error" in sender) return sender.error;
        const { person } = sender;

        if (person.role !== "staff" && person.role !== "owner") {
          return fail(
            "not_permitted",
            `Only Kola Gadgets staff can record a handover. ${person.name} is a reseller.`,
            senderView(person),
          );
        }

        const invoice = await db.findInvoice(invoice_id);
        if (!invoice) {
          return fail("not_found", `There is no invoice ${normaliseInvoiceId(invoice_id)} in the ledger.`, {
            invoice_id: normaliseInvoiceId(invoice_id),
          });
        }

        if (invoice.collected) {
          return fail(
            "already_collected",
            `${invoice.invoice_id} was already collected on ${invoice.collected_at || "an unrecorded date"} by ${invoice.collected_by || "an unrecorded staff member"}. Warn them to check before releasing anything again.`,
            { invoice: invoiceView(invoice) },
          );
        }

        const outstanding = outstandingNgn(invoice);
        if (outstanding > 0) {
          return fail(
            "not_fully_paid",
            `Do not release ${invoice.invoice_id}. ${naira(outstanding)} of ${naira(invoice.amount_ngn)} is still outstanding. A part payment never releases goods.`,
            { invoice: invoiceView(invoice) },
          );
        }

        const at = lagosTimestamp();
        await db.updateInvoice(invoice.invoice_id, {
          collected: true,
          collected_at: at,
          collected_by: person.name,
        });

        return ok({
          ...senderView(person),
          invoice_id: invoice.invoice_id,
          items: invoice.items,
          collected_at: at,
          collected_by: person.name,
          note: `Confirm the handover with the time and ${person.name}'s name.`,
        });
      }),
  );

  // ----------------------------------------------------------------- flag ---
  server.registerTool(
    "flag_for_owner",
    {
      title: "Flag for the owner",
      description:
        "Add a line to the Flags tab for Kola to review: a disputed amount, a reseller over their credit limit, a bank transfer the agent cannot confirm, or anything unresolved. Changes no balances. Tell the person the owner will follow up.",
      inputSchema: {
        phone: phoneArg,
        invoice_id: invoiceArg.optional().describe("The invoice concerned, if there is one."),
        summary: z
          .string()
          .min(5)
          .max(500)
          .describe("One line in plain English: who, what invoice, what needs deciding."),
      },
    },
    async ({ phone, invoice_id, summary }) =>
      guard(async () => {
        const db = ledger();
        // A flag is a safety valve, so an unknown number is still recorded —
        // but we note that it was unknown rather than inventing a name.
        const person = await db.findPerson(phone);
        const at = lagosTimestamp();
        const id = invoice_id ? normaliseInvoiceId(invoice_id) : "";
        const who = person ? `${person.name} (${person.role})` : "unknown sender";

        await db.appendFlag({
          created_at: at,
          phone: normalisePhone(phone),
          invoice_id: id,
          summary: `${who}: ${summary}`,
        });

        return ok({
          flagged_at: at,
          phone: normalisePhone(phone),
          invoice_id: id || undefined,
          summary,
          note: "Logged for Kola. Tell the person the owner will review it, and that nothing on their balance has changed.",
        });
      }),
  );
}
