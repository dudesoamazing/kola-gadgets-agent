# Kola Gadgets payments agent — TSG Labs take-home

Context for Claude Code. Read this first, then `docs/brief.md` for the official exercise.

## Who and what

- **Marvin Ogah** — product designer (8 years, mostly fintech). Writes React/React Native, uses Cursor and Claude Code. Applying to TSG Labs for **Product Management** first, **Technical Product Management** second.
- **The exercise:** build a Chord agent that does one useful job for a real business on WhatsApp, end to end. Must include a skill we wrote, a custom tool that calls an external system, and a full simulator conversation where the tool takes a real action. Budget ~6 hours. Full brief: `docs/brief.md` (confidential — never commit it).
- **Marvin wants to understand the fundamentals** behind decisions, not just get code. Explain the why in plain English, briefly.

## Timeline

| When | What |
| --- | --- |
| 19 Oct | Brief received from Emmanuel (support@tsglabs.com) |
| 20 Oct | Sent questions on sender identity and the built-in Paystack connector — **awaiting reply** |
| 20–21 Oct | Account setup and building outside Chord |
| 22–25 Oct | Marvin travelling (speaking at DevFest Akure) — drafting writing only |
| Mon 26 Oct | Send Chord account email → credits arrive → **5-day clock starts** |
| ~31 Oct | Submit |

Nothing that needs Chord credits should happen before 26 Oct. Everything else should.

## The problem

**Kola Gadgets** (made up) is a phone and laptop supplier in Computer Village, Lagos, selling to resellers. Resellers pick up stock on credit or pay first and collect later, often in split payments across their own customers. Transfers arrive without references and only the owner can see his bank account, so payments go unmatched, resellers get chased for items already paid for, and staff can't confirm payment before handing over stock when the owner is away.

The agent sits on the supplier's WhatsApp line. It ties every payment to specific invoices through a Paystack link, verifies it, and lets staff confirm payment before release — without access to the owner's bank account.

This is a real problem Marvin has lived as a reseller. Keep that story at the centre of the submission.

## Design decisions (already agreed)

- **Three roles, identified by phone number from the ledger, never by what someone claims.** A reseller may have a second number linked to their first in the People tab; everything else about identity follows from the ledger:
  - Reseller — see and pay their own invoices only.
  - Staff — check any invoice's payment status, record a handover. **Can never mark anything paid.**
  - Owner — everything, through the Google Sheet.
- **People have accounts; accounts have phones.** Resellers often message from more than one number — a real complaint from suppliers, who lose track of one conversation split across two chats. Invoices belong to a reseller **account**, not a phone, so either number sees the same balance and invoices. The ledger, not the chat, is the record: WhatsApp keeps separate threads per number, and that's fine. **Only the owner links a number**, by adding a row in the Sheet. The agent never accepts "this is my new number" from chat — an unknown number claiming to be an existing reseller gets no account details and is flagged for the owner.
- **Only a verified Paystack payment marks an invoice paid.** Screenshots and "I've paid" are not proof.
- **Payment-intent recognition is the centrepiece.** "acct dets", "account number", "where do I send the money?" → intercept with a payment link instead of bank details. Context decides, not keywords ("I sent it to your account" is a payment claim, not a request). Details in the skill.
- **Automatic with the reseller's confirmation.** The agent confirms invoices and total, sends the link on "yes". Owner approval only for exceptions (disputes, over credit limit, insists on bank transfer).
- **Part payments go to the oldest invoice first** unless the reseller names one. A part payment never releases goods.
- **Verifying the same reference twice must never apply a payment twice.**
- **Deliberately out of scope:** matching plain bank transfers, logging new pickups, disputes beyond flagging, automatic reminders.

## Architecture

```
WhatsApp simulator → Chord teammate (skill) → our MCP server → Google Sheet (ledger)
                                                            → Paystack test API
```

### What Chord's docs say (api.chordhq.xyz/docs)

- **Skills:** a folder with `SKILL.md` (frontmatter `name`, `description`) plus reference files (`.md .txt .json .yaml .yml .csv`). Max 64 files, 256 KiB per package; 64,000 characters across included entrypoints. Upload as ZIP or folder under Teammates → Create a teammate. Draft → publish; only published, included skills affect replies.
- **Custom tools must be an MCP server.** Public HTTPS, **Streamable HTTP** transport (Chord POSTs JSON, accepts JSON or SSE). Private/loopback addresses are blocked. A Google Sheet or plain REST API can't be plugged in directly — the MCP server translates.
- **MCP auth:** `bearer` → sent as `Authorization: Bearer …`; `api_key` → sent as `X-API-Key`; or `oauth` (needs dynamic client registration — Google's OAuth doesn't support it, which is why off-the-shelf Sheets MCP servers don't fit).
- `enabled_tools` restricts tools by exact name; empty means all.
- **Health probe returns HTTP 200 even when it fails** — read `status`, not the HTTP code.
- **Built-in connector tool types:** `bookings`, `menu`, `paystack`, `notion`, `linear`, `github`. The built-in Paystack connector doesn't count as our custom tool; what it can do is undocumented (asked TSG).
- **Unknown:** whether the sender's phone number reaches the agent or MCP tools, and whether the simulator can send as multiple numbers. **This decides the role design.** Asked TSG on 20 Oct.

## MCP server — built

Node + TypeScript, `@modelcontextprotocol/sdk` over Streamable HTTP (stateless), `zod` for input schemas, `googleapis` for Sheets. Bearer token checked on every `/mcp` request; the server refuses to start without `MCP_BEARER_TOKEN`.

```
src/
  index.ts            express app — bearer auth, /health, stateless /mcp
  server.ts           MCP server factory
  config.ts           env loading, startup config checks
  lib/format.ts       naira, kobo, Lagos timestamps, phone normalisation
  ledger/             People/Invoices/Payments/Flags behind one interface
    store.ts          the narrow TableStore both backends implement
    sheets-store.ts   Google Sheets via service-account JWT
    csv-store.ts      local data/*.csv
    ledger.ts         parsing, status rules, oldest-first ordering
  paystack/           initialize + verify, plus mock.ts stand-in
  tools/index.ts      the seven tools
scripts/smoke.ts      end-to-end test, no credentials needed
scripts/setup-sheet.ts  creates and seeds the four tabs
```

| Command | Does |
| --- | --- |
| `npm run dev` | Local server on :3000, hot reload |
| `npm run smoke` | Boots the server, drives all seven tools over real MCP HTTP — 70 assertions |
| `npm run typecheck` | `tsconfig.json` (src + scripts) |
| `npm run build` / `start` | `tsconfig.build.json` → `dist/index.js` (src only, so output isn't nested) |
| `npm run setup:sheet` | Creates and seeds the ledger tabs; `--force` to replace |
| `npm run inspector` | MCP Inspector against localhost |

### Decisions made during the build

- **Two ledger backends behind one interface.** `LEDGER_BACKEND=csv` reads `data/*.csv`, `sheets` reads the real Sheet. Defaults to sheets when `GOOGLE_SHEET_ID` is set. All parsing and business logic lives in `TableLedger`, so the two can't drift. The CSV backend is for dev and the smoke test only — writes are last-one-wins.
- **`PAYSTACK_MODE=mock`** serves a local two-button checkout page instead of calling Paystack. Lets the whole flow run with no Paystack account, and is the fallback if test mode caps amounts.
- **`enableJsonResponse: true` on the transport.** The SDK defaults to SSE; nothing here streams, and JSON is readable with curl. Chord accepts either. Logged in field notes.
- **Only `verify_payment` writes `amount_paid_ngn`.** No other code path touches it — the "staff can never mark anything paid" rule is structural, not prompt-level.
- **Double-apply guarded twice:** the Payments row reading `success` with a timestamp short-circuits a repeat verify, and a per-reference in-process lock serialises concurrent calls. Single instance only — scaling out would need the lock in the sheet or a real queue.
- **Phone numbers normalised to `+234…`** on every comparison, since we still don't know what shape Chord sends.
- **Resellers can have two numbers.** A People row with `primary_phone` set is a second line; the tools look invoices up by `person.ledger_phone` (primary if set, else the number they messaged from), and payments file under the primary so the balance can't split in two. Only the owner can link a number, by editing the sheet — the agent never accepts "this is my new number". Found this because the go-live note promised it and the code didn't do it.
- **Invoice ids normalised on the digits**, so "104", "inv 104" and "INV-104" all resolve.

### Next change: multiple phones per reseller (agreed 20 Oct — not built yet)

- **People tab:** add `account_id` (e.g. `ACC-ADA`). One row per phone; several rows can share an `account_id`. Name and role are the same on every row of an account.
- **Invoices tab:** replace `reseller_phone` with `account_id`.
- **Payments tab:** add `account_id`; keep `reseller_phone` as the number that created the link, for audit.
- **Every ownership check compares accounts:** resolve the sender's phone → `account_id` first, then compare. Never compare phones directly.
- **`get_sender_role`** also returns `account_id`.
- **Unknown number claiming an existing name** ("I'm Ada, new number"): reply that Kola needs to add the number before you can help with that account, then `flag_for_owner` with the number and the name given. Never reveal anything about the named account.
- **Seed data:** give Ada a second number, `+2348020000011`, on `ACC-ADA`. Keep one unknown number for testing the claim flow.
- **Skill:** add the unknown-number rule to "Who you are talking to", and an example to `references/examples.md`.
- **Update** `setup:sheet`, the CSV backend and the smoke test: Ada's second number sees the same balance; a link created from one number can be verified from the other.

### Tools (names must match the skill)

| Tool | Input | Does |
| --- | --- | --- |
| `get_sender_role` | `phone` | Look up People → `owner` / `staff` / `reseller` / `unknown`, plus name |
| `get_reseller_balance` | `phone` | Unpaid and part-paid invoices for that reseller, with outstanding amounts and total |
| `check_invoice_status` | `phone`, `invoice_id` | Status, amount paid/outstanding, collected/when/by whom. Resellers only see their own |
| `create_payment_link` | `phone`, `invoice_ids[]`, `amount_ngn?` | Resellers only. Validate invoices belong to them and amount ≤ outstanding (≥ ₦50,000 if part); call Paystack initialize with our own reference and invoice IDs in metadata; log the pending row **after** Paystack returns a link; return link + reference |
| `verify_payment` | `reference` | Any sender, but only references we issued — an unknown one returns `not_found`. Call Paystack verify. On `success`, apply to invoices (oldest first) **once** — reports the existing confirmation if already applied. Any unallocatable remainder is flagged for the owner |
| `record_handover` | `phone`, `invoice_id` | Staff and owner. Refuse unless fully paid and not collected — `already_collected` takes precedence over `not_fully_paid`, because "you already gave this away" is the more urgent warning. Set collected, time, staff name |
| `flag_for_owner` | `phone`, `invoice_id?`, `summary` | Append to Flags tab |

Every tool returns plain, model-readable JSON, and clear errors (`not_found`, `not_permitted`, `paystack_unreachable`…) rather than throwing — the skill tells the agent how to word each failure.

### Paystack (test mode)

- `POST https://api.paystack.co/transaction/initialize` with `email`, `amount` (**kobo** — ₦2,400,000 = 240000000), `reference`, `metadata` → returns `authorization_url`.
- `GET https://api.paystack.co/transaction/verify/:reference` → `data.status`: `success`, `failed`, `abandoned`, etc.
- Header: `Authorization: Bearer sk_test_…`. Paystack requires an email: use the one in People.
- Check test-mode amount limits early — our amounts are large. `PAYSTACK_MODE=mock` is the fallback if they're refused.
- A refused initialize (bad key, amount over the cap) and an unreachable Paystack both surface as `paystack_unreachable` with Paystack's own words in `detail`. No pending row is written, so the Payments tab never holds a reference that doesn't exist.

### Ledger (Google Sheet)

Seed data in `data/*.csv`. `npm run setup:sheet` creates the four tabs and fills them — it's also the fastest check that the service account can reach the Sheet (a 403 means it was never shared). Share the Sheet with the service account email as an Editor. Tabs:

- **People:** phone, name, role, email, primary_phone (blank unless this is a reseller's second line, in which case it holds the number their invoices are filed under)
- **Invoices:** invoice_id, reseller_phone, items, amount_ngn, amount_paid_ngn, created_at, collected, collected_at, collected_by
- **Payments:** reference, reseller_phone, invoice_ids, amount_ngn, status, link, created_at, verified_at
- **Flags:** created_at, phone, invoice_id, summary

Status is derived, not stored: paid = amount_paid ≥ amount.

Changing to account-based ownership — see "Next change" above.

### Hosting

Render or Railway, public HTTPS. `render.yaml` is ready — free web service, health check on `/health`, secrets set in the dashboard (`sync: false`). Free tiers sleep, so a cold start can make Chord time out on the first call. Keep it awake or log it as a field note.

Register in Chord as: transport **Streamable HTTP**, URL `https://<host>/mcp`, auth **bearer**, token from `MCP_BEARER_TOKEN`.

Our `/health` returns **503** when the ledger or config is broken and lists the problems — the opposite of Chord's probe, which returns 200 either way. Don't confuse the two when debugging.

### Secrets

`.env` only (see `.env.example`). Never commit keys or the service-account JSON.

## Deliverables (from the brief)

1. Role preference + problem statement → `docs/problem-statement.md`
2. Working agent left live on Chord
3. Repo with skill files, tool code and a short README (include how AI tools were used) → `README.md` drafted
4. 3-minute screen recording — centrepiece: "send acct dets" → payment link; "I don send am to your account" read correctly as a payment claim; staff release check
5. **Deployment field notes — the most important part** → `docs/field-notes.md`. Log every problem as it happens: what happened, error, how the cause was found, fix/workaround, what Chord should change.
6. Go-live note, half a page max, for a non-technical owner → `docs/go-live-note.md`

Scoring: Integration 25%, Field notes 25%, Problem choice 20%, Customer thinking 15%, Communication 15%. PM weights problem choice + customer thinking; Technical PM weights payment integration + the go-live note.

## Tasks

- [x] Problem and conversation design
- [x] Skill drafted (`skill/kola-gadgets-payments/`)
- [x] Seed ledger data (`data/`)
- [ ] Paystack test account + secret key
- [ ] Google Cloud project, Sheets API, service account key; create and share the Sheet
- [ ] GitHub repo (private until submission)
- [x] Build MCP server (`src/`), tested locally — `npm run smoke` drives all seven tools over real MCP HTTP, 70 assertions
- [x] README drafted (`README.md`) — how to run, the seven tools, how AI tools were used
- [ ] Deploy to public HTTPS (`render.yaml` ready); check `/health` reports `ok` on the Sheets backend
- [ ] Sign up to Chord; explore Tools panel and skill upload (no credits needed)
- [ ] Multiple phones per reseller account (see "Next change")
- [ ] `verify_payment`: add the sender's `phone` and only allow the reseller who owns the payment (by account), staff or the owner — today any sender with a reference can see that payment, which breaks "resellers only see their own"
- [ ] Use real Paystack test mode (`PAYSTACK_MODE` off mock) for the submission and recording — integration is 25% of the score; keep mock only as the fallback if test mode refuses large amounts
- [x] Problem statement and go-live note drafted (`docs/`) — revisit after Chord testing
- [ ] 26 Oct: send Chord email
- [ ] Register MCP server, upload skill, test every path in the simulator
- [ ] Record, finish field notes, submit

## Writing style

Plain English, short sentences, specific numbers. Marvin's voice: warm, direct, no corporate filler.
