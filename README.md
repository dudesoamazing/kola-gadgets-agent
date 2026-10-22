# Kola Gadgets payments agent

A WhatsApp agent for a phone and laptop supplier in Computer Village, Lagos. It ties every payment to a specific invoice, verifies it through Paystack, and lets shop staff confirm payment before releasing stock — without anyone needing access to the owner's bank account.

Built on Chord for the TSG Labs build exercise. The problem, the design decisions and what was left out are in [`docs/problem-statement.md`](docs/problem-statement.md).

```
WhatsApp simulator → Chord teammate (our skill) → this MCP server → Google Sheet (the ledger)
                                                                  → Paystack (test mode)
```

| Part | Where |
| --- | --- |
| The skill | [`skill/kola-gadgets-payments/`](skill/kola-gadgets-payments/) |
| The MCP server | [`src/`](src/) |
| Seed ledger data | [`data/`](data/) |
| Deployment field notes | [`docs/field-notes.md`](docs/field-notes.md) |
| Go-live note for the owner | [`docs/go-live-note.md`](docs/go-live-note.md) |

## The seven tools

| Tool | Who can use it | What it does |
| --- | --- | --- |
| `identify` | anyone with a code and PIN | Checks the credentials against the ledger: owner, staff or reseller |
| `get_reseller_balance` | reseller | Every unpaid or part-paid invoice, with amounts outstanding and the total |
| `check_invoice_status` | staff, owner, and the reseller it belongs to | Amount, amount paid, outstanding, collected when and by whom |
| `create_payment_link` | reseller | Validates the invoices are theirs, creates a Paystack link, logs it as pending |
| `verify_payment` | the account it belongs to, plus staff and owner | Asks Paystack what really happened and applies the money, oldest invoice first |
| `record_handover` | staff, owner | Marks stock handed over — refuses unless the invoice is paid in full |
| `flag_for_owner` | anyone | Adds a line to the Flags tab for Kola to look at |

Three rules the code enforces, not just the prompt:

- **Only `verify_payment` can mark an invoice paid.** Nothing else writes `amount_paid_ngn`. No one can talk their way into it — not staff, not someone claiming to be staff.
- **Verifying the same reference twice never applies the money twice.** The payment row is the record; once it reads `success` with a timestamp, a repeat call reports the existing confirmation instead. Simultaneous calls are serialised per reference.
- **Roles come from the ledger's People tab.** Never from what someone says in the chat.
- **Identity is proven, not inferred.** Chord passes no sender identity to a teammate or its tools — no phone number, nothing (confirmed by TSG, 22 Oct). So every person has an owner-issued account code and a 4-digit PIN, and **every tool re-checks both on every call**; there is no session, because there is no handle to key one on. An unknown code and a wrong PIN return the same message, so the agent can't be used to find out which codes are live. The PIN never leaves the ledger layer and never reaches the model.

Every tool returns readable JSON with an `ok` flag, and failures come back as codes the skill has wording for (`not_permitted`, `not_found`, `paystack_unreachable`, `not_fully_paid`…) rather than as exceptions. An error Chord can't read is an error the agent will improvise around.

## Running it

Needs Node 20 or newer.

```bash
npm install
cp .env.example .env     # set MCP_BEARER_TOKEN at least
npm run dev              # http://localhost:3000/mcp
```

With no credentials at all it runs on the CSVs in `data/` and a local stand-in for Paystack checkout, so every path works offline. Check what it picked up:

```bash
curl -s localhost:3000/health | jq
```

`status` is `ok` only when the ledger answers and the config is complete; a broken setup returns HTTP 503 and lists the problems.

### Tests

```bash
npm run smoke
```

Boots the server, talks to it with a real MCP client, and walks all seven tools over 91 assertions — including paying twice, racing two verifies against one reference, a failed payment, a reseller asking after someone else's invoice or payment reference, a wrong PIN on every tool, and Paystack being unreachable. It works on a throwaway copy of `data/`, so the seed files stay put. No Chord credits, no Paystack account, no Sheet needed.

To poke at the tools by hand:

```bash
npm run inspector     # then connect to http://localhost:3000/mcp with your bearer token
```

### Connecting the real services

**Google Sheet.** Create a Google Cloud project, enable the Sheets API, make a service account and download its JSON key. Put `client_email` and `private_key` in `.env`, create a sheet, then **share the sheet with the service account's email as an Editor** — it has no access until you do. Then:

```bash
npm run setup:sheet      # creates the four tabs and seeds them from data/
```

Auth is a service-account JWT rather than OAuth on purpose: Chord's `oauth` tool type needs dynamic client registration and Google doesn't support it, so the sheet is reached from this server with its own credentials instead.

**Paystack.** Put the `sk_test_…` key in `PAYSTACK_SECRET_KEY` and set `PAYSTACK_MODE=live`. The server refuses to report healthy on an `sk_live` key.

Two things worth knowing, both learned the hard way against the real test API and written up in the field notes: Paystack **rejects reserved-TLD emails**, so the seed ledger uses `example.com` rather than `.test` — put `.test` back and every payment link fails. And there is **no test-mode amount cap**; ₦50,000,000 initializes fine, so `PAYSTACK_MODE=mock` is an offline convenience only, not a workaround for large invoices.

### Deploying

`render.yaml` deploys it as a free Render web service. Set the secrets in the dashboard, not in the file. Any host works as long as it gives you public HTTPS: Chord blocks private and loopback addresses, so there's no tunnelling around it.

Register it in Chord as a custom tool with transport **Streamable HTTP**, URL `https://<host>/mcp`, auth type **bearer**, and the token from `MCP_BEARER_TOKEN`. Free tiers sleep, and a cold start can time out Chord's first call — keep it warm or expect one dud message.

## How AI tools were used

Claude Code wrote most of this server from `CLAUDE.md`, which I wrote first: the problem, the roles, the seven tools and the rules they had to enforce. I made the design calls — what counts as proof of payment, oldest-invoice-first, who can mark what — and had Claude build to them, then pushed back where the first pass was too loose. Cursor for smaller edits. The skill is mine; the tone and the payment-intent rules are the part I didn't want a model guessing at.

One example of the back-and-forth being worth it: the first smoke test failed on "staff cannot release a part-paid invoice" because the invoice I picked had already gone out on credit, so the agent warned about the handover instead of the balance. The code was right and my test was wrong. That precedence — *you already gave this away* beats *this isn't paid yet* — is now asserted on purpose.
