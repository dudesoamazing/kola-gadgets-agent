# Kola Gadgets payments agent

A WhatsApp agent for a phone and laptop supplier in Computer Village, Lagos. It ties every payment to a specific invoice, verifies it through Paystack and lets shop staff confirm payment before releasing stock, without anyone needing access to the owner's bank account.

Built on Chord for the TSG Labs build exercise. The design decisions are below. What I'd build next is at the end of [`docs/field-notes.md`](docs/field-notes.md).

```
WhatsApp simulator → Chord teammate (our skill) → this MCP server → Google Sheet (the ledger)
                                                                  → Paystack (test mode)
```

| Part | Where |
| --- | --- |
| The skill | [`skill/kola-gadgets-payments/`](skill/kola-gadgets-payments/) |
| The MCP server | [`src/`](src/) |
| Seed ledger data | [`data/`](data/) |
| Security and identity design | [`docs/security.md`](docs/security.md) |
| Deployment field notes | [`docs/field-notes.md`](docs/field-notes.md) |
| Go-live note for the owner | [`docs/go-live-note.md`](docs/go-live-note.md) |

## How to try it

You can review this in three ways:

1. **Watch (3 min):** The demo video walks through the full payment and pickup flow. The link is in the submission Drive folder.
2. **Try it live (10 min):** The Chord chat link and Reset demo link are in the submission slide deck. Credentials and live links are kept out of this repo because the repo is public.
   - **Test accounts:** Reseller `KG-ADA` (PIN `4461`), backup reseller `KG-EMEKA` (PIN `5529`) and staff `KG-TUNDE` (PIN `2270`).
   - **Suggested path:** Say "how much I owe" → say "send acct dets" → pay with the Paystack test option "Success" → say "sent" → sign in as `KG-TUNDE` and give the pickup code → give the same code again.
   - **If anything is already paid or locked:** Open the Reset demo link. It reseeds the ledger so Ada owes ₦4,360,000 again and clears every lock. The demo also resets automatically every night at 03:00 Lagos time.
3. **Run it yourself (5 min):** Run `npm install` and then `npm run smoke`. No accounts or keys needed.

## The eight tools

| Tool | Who can use it | What it does |
| --- | --- | --- |
| `identify` | anyone with a code and PIN | Checks the credentials against the ledger: owner, staff or reseller |
| `get_reseller_balance` | reseller | Every unpaid or part-paid invoice, with amounts outstanding and the total |
| `check_invoice_status` | staff, owner and the reseller it belongs to | Amount, amount paid, outstanding, collected when and by whom |
| `create_payment_link` | reseller | Validates the invoices are theirs, creates a Paystack link, logs it as pending |
| `verify_payment` | the account it belongs to, plus staff and owner | Asks Paystack what really happened and applies the money, oldest invoice first |
| `get_pickup_codes` | reseller | Their paid, uncollected invoices with each two-word pickup code |
| `record_handover` | staff, owner | Releases goods against a pickup code: names the item, marks it collected, spends the code |
| `flag_for_owner` | anyone | Adds a line to the Flags tab for Kola to look at |

Key rules the code enforces, not just the prompt:

- **Only `verify_payment` can mark an invoice paid.** Nothing else writes `amount_paid_ngn`. No one can talk their way into it not even staff or someone claiming to be staff.
- **Verifying the same reference twice never applies the money twice.** The payment row is the record; once it reads `success` with a timestamp, a repeat call reports the existing confirmation instead. Simultaneous calls are serialised per reference.
- **Roles come from the ledger's People tab.** Never from what someone says in the chat.
- **No code, no goods.** A verified payment that clears an invoice in full mints a unique two-word pickup code (e.g. two words joined by a hyphen); older invoices may still carry 6 digits. Staff release only against it. **No tool ever shows a code to staff** `invoiceView` has no such field and `get_pickup_codes` returns one only to the reseller who paid. Three wrong codes lock handovers from that staff account and flag the owner. Copied from how Computer Village already works so nobody at the counter has to be retrained.
- **Identity is proven, not inferred.** Chord passes no sender identity to a teammate or its tools; no phone number, nothing (confirmed by TSG, 22 Oct). So every person has an owner-issued account code and a 4-digit PIN and **every tool re-checks both on every call**; there is no session, because there is no handle to key one on. An unknown code and a wrong PIN return the same message so the agent can't be used to find out which codes are live. Five wrong PINs lock the account and flag Kola. Only the right PIN learns that an account is locked so locking reveals nothing either. The PIN never leaves the ledger layer and never reaches the model.

- **Tool results say what happened so the model doesn't guess.** After Ada paid for three invoices, two of which she had already collected on credit, an early version of `verify_payment` returned those two as paid with no pickup code and no reason. The agent read the missing code as a fault and asked Kola to issue codes for them, which would have released an iPhone order and a MacBook (₦4,050,000) a second time. Results now mark invoices collected earlier, with a note and include a `summary_for_reply` the agent can use as written.

Every tool returns readable JSON with an `ok` flag and failures come back as codes the skill has wording for (`not_permitted`, `not_found`, `paystack_unreachable`, `not_fully_paid`…) rather than as exceptions. An error Chord can't read is an error the agent will improvise around.

## Security and identity

Full architectural details, threat analysis and production tooling are documented in [`docs/security.md`](docs/security.md). In brief:

- **How identity works today:** Every tool call carries an account code (`KG-ADA`) and a 4-digit PIN. The server checks them against the ledger on every call (using constant-time comparison) and never trusts an earlier sign-in. Saying "I'm staff" or "I'm Ada" in the chat changes nothing. A wrong code or PIN reveals nothing, not even whether the code exists. 5 failed attempts flag the owner (they don't lock the account yet).
- **Why code + PIN:** Chord does not pass the sender's WhatsApp number to the agent or to MCP tools (confirmed by TSG on 22 Oct) so phone-based identity was impossible.
- **The model cannot release goods:** Release happens strictly on the server via `record_handover`, against a one-time pickup code minted by a verified Paystack payment and shown only to the reseller who paid. In testing, the server refused codes the model made up (28 Oct; see field notes).
- **Known limits, stated honestly:**
  1. *Plain-text PINs in demo:* The demo Google Sheet stores PINs in plain text and they are visible in the People tab in the recording. In production they would be stored as a salted slow hash (scrypt) combined with a server-side secret (a pepper held only in the host's environment variables, never in the Sheet). A 4-digit PIN has only 10,000 values (0000 to 9999) so a plain hash can be reversed in under a second; the pepper is what protects it.
  2. *Leaked PIN blast radius:* A leaked PIN lets someone act as that reseller, including retrieving their pickup codes for paid items.
  3. *Chat history exposure:* PINs are typed into the chat so they also sit in the chat history, in Chord and in the model's context. Hashing the Sheet doesn't fix that. The real fix is binding each account to the sender's WhatsApp number once Chord passes it, with the PIN as a second factor.
- **Next steps for production:**
  - An owner unlock tool. Locks live in server memory today so clearing one means restarting the server.
  - Owner-only administrative tools to replace hand-editing the Sheet: proposed `add-account` (shows a new PIN once, stores only the hash) and `reset-pin` (same). Described in [`docs/security.md`](docs/security.md).
  - Hashed and peppered PINs as above.
  - Pickup codes that expire if unused (e.g. after 7 days).

## Running it

Needs Node 20 or newer.

```bash
npm install
cp .env.example .env     # set MCP_BEARER_TOKEN at least
npm run dev              # http://localhost:3000/mcp
```

With no credentials at all it runs on the CSVs in `data/` and a local stand-in for Paystack checkout so every path works offline. Check what it picked up:

```bash
curl -s localhost:3000/health | jq
```

`status` is `ok` only when the ledger answers and the config is complete; a broken setup returns HTTP 503 and lists the problems.

### Tests

```bash
npm run smoke
```

Boots the server, talks to it with a real MCP client and walks all eight tools over 110 assertions (including paying twice, racing two verifies against one reference, a failed payment, a reseller asking after someone else's invoice or payment reference, a wrong PIN on every tool, a part payment getting no pickup code, a reused code, a staff account locked out after three wrong codes and Paystack being unreachable). It works on a throwaway copy of `data/` so the seed files stay put. No Chord credits, no Paystack account, no Sheet needed.

To poke at the tools by hand:

```bash
npm run inspector     # then connect to http://localhost:3000/mcp with your bearer token
```

### Connecting the real services

**Google Sheet.** Create a Google Cloud project, enable the Sheets API, make a service account and download its JSON key. Put `client_email` and `private_key` in `.env`, create a sheet, then **share the sheet with the service account's email as an Editor**. It has no access until you do. Then:

```bash
npm run setup:sheet      # creates the four tabs and seeds them from data/
```

Auth is a service-account JWT rather than OAuth on purpose: Chord's `oauth` tool type needs dynamic client registration and Google doesn't support it so the sheet is reached from this server with its own credentials instead.

**Paystack.** Put the `sk_test_…` key in `PAYSTACK_SECRET_KEY` and set `PAYSTACK_MODE=live`. The server refuses to report healthy on an `sk_live` key.

Two things worth knowing, both learned the hard way against the real test API and written up in the field notes: Paystack **rejects reserved-TLD emails** so the seed ledger uses `example.com` rather than `.test` (put `.test` back and every payment link fails). And there is **no test-mode amount cap**; ₦50,000,000 initializes fine so `PAYSTACK_MODE=mock` is an offline convenience only, not a workaround for large invoices.

### Deploying

`render.yaml` deploys it as a free Render web service. Set the secrets in the dashboard, not in the file. Any host works as long as it gives you public HTTPS: Chord blocks private and loopback addresses so there's no tunnelling around it.

Register it in Chord as a custom tool with transport **Streamable HTTP**, URL `https://<host>/mcp`, auth type **bearer** and the token from `MCP_BEARER_TOKEN`. 

**Health endpoints:**
- `GET /live`: returns 200 `{"status":"ok"}` immediately without external calls, used by Render to confirm the process is up.
- `GET /health`: deep check that tests the ledger and configuration (cached for 60 seconds), used by the uptime monitor.

**Keeping the server awake:** Free-tier hosting (like Render) spins down after 15 minutes of inactivity, causing a cold start of up to ~50 seconds that can time out Chord's tool calls and coincided with a silent escalation to a human in testing. During testing, this is mitigated with an external pinger (e.g. UptimeRobot pinging `https://kola-gadgets-mcp.onrender.com/health` every 5 minutes). For production, the service should run on a paid, always-on instance so customers never hit cold starts.

## Troubleshooting

**Service-account key creation is disabled.** Google blocks keys by default in projects that belong to an organisation. Create the project with Location set to "No organization" or ask an organisation admin to allow keys for this one project. See [`docs/security.md`](docs/security.md) for how the key is handled.

**"Google Sheets API has not been used in project…" after enabling it.** The API Library lists "Sheets MCP API" right next to "Google Sheets API". They are different products. Enable Google Sheets API in the project named in the error, which is the one your service account belongs to.

**Paystack rejects the email as invalid.** Test mode refuses reserved domains such as `.test` and `.example`. The seed data uses `example.com` for this reason.

**Verifying an unknown reference returns HTTP 400.** Paystack reports "transaction not found" as a 400 rather than a 404. The client checks the `transaction_not_found` code instead of the status.

**The test checkout shows outcome buttons instead of a card form.** Choose the success option to complete a test payment.

**Render returns 502 although the logs show the server started.** The server must listen on `0.0.0.0`. It already does.

**The Render deploy times out after 15 minutes with no error.** Check `GOOGLE_PRIVATE_KEY`. Hosting dashboards keep any quotes you paste as part of the value so a key copied from `.env` with its quotes fails to parse and `/health` never turns healthy. Paste it without the outer quotes. The server strips them as a fallback.

## How AI tools were used

Claude Code wrote the core of this server after I set up `CLAUDE.md`, which covers the problem, the roles, the tools and the rules they had to enforce. I made the design calls: what counts as proof of payment, oldest-invoice-first, who can mark what. Claude built to them and I pushed back where the first pass was too loose. Gemini in Antigravity handled quick edits, smaller fixes and running smoke tests. The skill is mine; the tone and the payment-intent rules are the part I didn't want AI guessing at.

One example of why double checking everything was super important: the first draft of the skill’s generated identity marker examples included a working account code and PIN, which would have put a live credential in front of the model. I caught it and replaced it with a placeholder and added a test that fails if a non-placeholder is returned.
