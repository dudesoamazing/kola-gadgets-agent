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
| `npm run smoke` | Boots the server, drives all seven tools over real MCP HTTP — 86 assertions |
| `npm run typecheck` | `tsconfig.json` (src + scripts) |
| `npm run build` / `start` | `tsconfig.build.json` → `dist/index.js` (src only, so output isn't nested) |
| `npm run setup:sheet` | Creates and seeds the ledger tabs; `--force` to replace |
| `npm run inspector` | MCP Inspector against localhost |

### Decisions made during the build

- **Two ledger backends behind one interface.** `LEDGER_BACKEND=csv` reads `data/*.csv`, `sheets` reads the real Sheet. Defaults to sheets when `GOOGLE_SHEET_ID` is set. All parsing and business logic lives in `TableLedger`, so the two can't drift. The CSV backend is for dev and the smoke test only — writes are last-one-wins.
- **`PAYSTACK_MODE=mock`** serves a local two-button checkout page instead of calling Paystack, so the flow runs offline. It is no longer a fallback for large amounts — test mode has no cap — and it must not be what the recording shows. A mock only tests your own assumptions: mine said verify-unknown-reference was a 404, and the real API says 400.
- **`enableJsonResponse: true` on the transport.** The SDK defaults to SSE; nothing here streams, and JSON is readable with curl. Chord accepts either. Logged in field notes.
- **Only `verify_payment` writes `amount_paid_ngn`.** No other code path touches it — the "staff can never mark anything paid" rule is structural, not prompt-level.
- **Double-apply guarded twice:** the Payments row reading `success` with a timestamp short-circuits a repeat verify, and a per-reference in-process lock serialises concurrent calls. Single instance only — scaling out would need the lock in the sheet or a real queue.
- **Phone numbers normalised to `+234…`** on every comparison, since we still don't know what shape Chord sends.
- **Resellers can have two numbers**, via `account_id`. Found this gap because the go-live note promised it and the code compared phone numbers. First pass used a `primary_phone` pointer; replaced with the agreed account model, which is cleaner and puts the identity in one column.
- **Invoice ids normalised on the digits**, so "104", "inv 104" and "INV-104" all resolve.

### Accounts, not phone numbers (agreed 20 Oct — built)

Ownership is compared on `account_id`, never on a phone number, so one reseller can carry two phones.

- **People tab** has `account_id` (e.g. `ACC-ADA`). One row per phone; several rows share an account. A row with a blank `account_id` gets `ACC-<phone>` of its own, so a mistyped cell isolates that number instead of lumping it in with someone else's invoices.
- **Invoices tab** uses `account_id` in place of `reseller_phone`.
- **Payments tab** has `account_id`, and keeps `reseller_phone` as the number that raised the link — audit only, never access.
- **`get_sender_role` returns `account_id`.** A second row may leave name or email blank; both fall back to another row on the same account, since Paystack needs an email.
- **`verify_payment` takes the sender's `phone`** and refuses a reference from another account. Without that, a reference acted as a bearer token for anyone holding it.
- **Seed data:** Ada has `+2348020000011` on `ACC-ADA`. `+2349999999999` is deliberately left out, for testing the "I'm Ada, new number" flow.
- **Skill:** the unknown-number rule is in SKILL.md under "Who you are talking to", with examples in `references/examples.md` and the account rules in `references/business.md`.
- **Tested:** the second line sees the same balance, a link raised on one number is verified from the other, another reseller is refused the reference, and staff can verify any payment.

### Tools (names must match the skill)

| Tool | Input | Does |
| --- | --- | --- |
| `get_sender_role` | `phone` | Look up People → `owner` / `staff` / `reseller` / `unknown`, plus name |
| `get_reseller_balance` | `phone` | Unpaid and part-paid invoices for that reseller, with outstanding amounts and total |
| `check_invoice_status` | `phone`, `invoice_id` | Status, amount paid/outstanding, collected/when/by whom. Resellers only see their own |
| `create_payment_link` | `phone`, `invoice_ids[]`, `amount_ngn?` | Resellers only. Validate invoices belong to them and amount ≤ outstanding (≥ ₦50,000 if part); call Paystack initialize with our own reference and invoice IDs in metadata; log the pending row **after** Paystack returns a link; return link + reference |
| `verify_payment` | `phone`, `reference` | Only references we issued — an unknown one returns `not_found` — and only for the sender's own account unless they are staff or the owner. Call Paystack verify. On `success`, apply to invoices (oldest first) **once** — reports the existing confirmation if already applied. Any unallocatable remainder is flagged for the owner |
| `record_handover` | `phone`, `invoice_id` | Staff and owner. Refuse unless fully paid and not collected — `already_collected` takes precedence over `not_fully_paid`, because "you already gave this away" is the more urgent warning. Set collected, time, staff name |
| `flag_for_owner` | `phone`, `invoice_id?`, `summary` | Append to Flags tab |

Every tool returns plain, model-readable JSON, and clear errors (`not_found`, `not_permitted`, `paystack_unreachable`…) rather than throwing — the skill tells the agent how to word each failure.

### Paystack (test mode)

- `POST https://api.paystack.co/transaction/initialize` with `email`, `amount` (**kobo** — ₦2,400,000 = 240000000), `reference`, `metadata` → returns `authorization_url`.
- `GET https://api.paystack.co/transaction/verify/:reference` → `data.status`: `success`, `failed`, `abandoned`, etc.
- Header: `Authorization: Bearer sk_test_…`. Paystack requires an email: use the one in People.
- **No test-mode amount cap** (checked 20 Oct): ₦2,400,000, ₦4,360,000 and ₦50,000,000 all initialize fine. The risk is retired; `PAYSTACK_MODE=mock` stays only as an offline convenience.
- **Paystack rejects reserved-TLD emails.** `ada@resellers.test` and `ada@kolagadgets.example` fail with `"email" must be a valid email`; `example.com` and real domains pass. The seed ledger uses `example.com` — do not put `.test` back.
- **`verify` on an unknown reference is HTTP 400 with `code: transaction_not_found`, not 404.** Matching only on 404 turned an unopened link into "couldn't reach the payment system". An initialized-but-unpaid link returns `abandoned`, which is different and correct.
- Two failure shapes, deliberately distinct: Paystack **down or slow** → `paystack_unreachable`, "try again in a minute". Paystack **saying no** (bad email, bad key, 4xx validation) → `bad_input`, flagged for the owner, no retry offered, because retrying never helps. Either way no pending row is written, so the Payments tab never holds a reference that doesn't exist.

### Ledger (Google Sheet)

Seed data in `data/*.csv`. `npm run setup:sheet` creates the four tabs and fills them — it's also the fastest check that the service account can reach the Sheet (a 403 means it was never shared). Share the Sheet with the service account email as an Editor. Tabs:

- **People:** phone, name, role, email, account_id
- **Invoices:** invoice_id, account_id, items, amount_ngn, amount_paid_ngn, created_at, collected, collected_at, collected_by
- **Payments:** reference, account_id, reseller_phone, invoice_ids, amount_ngn, status, link, created_at, verified_at
- **Flags:** created_at, phone, invoice_id, summary

Status is derived, not stored: paid = amount_paid ≥ amount.

Ownership is by account — see "Accounts, not phone numbers" above.

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
- [x] Paystack test account + secret key — in `.env` (never committed), `PAYSTACK_MODE=live`
- [ ] Google Cloud project, Sheets API, service account key; create and share the Sheet
- [~] GitHub repo — local git repo initialised, first commit made on `main`. Remote still to create: `gh` is not installed on this machine, so it needs doing from the GitHub web UI or after `brew install gh`
- [x] Build MCP server (`src/`), tested locally — `npm run smoke` drives all seven tools over real MCP HTTP, 86 assertions
- [x] README drafted (`README.md`) — how to run, the seven tools, how AI tools were used
- [ ] Deploy to public HTTPS (`render.yaml` ready); check `/health` reports `ok` on the Sheets backend
- [ ] Sign up to Chord; explore Tools panel and skill upload (no credits needed)
- [x] Multiple phones per reseller account — `account_id` on People, Invoices and Payments; see "Accounts, not phone numbers"
- [x] `verify_payment` takes the sender's `phone` and refuses a reference from another account; staff and the owner may verify any
- [x] Real Paystack test mode proven end to end (20 Oct): tool created a live `checkout.paystack.com` link for ₦2,710,000; a test-card charge then verified, applied to INV-109, marked it paid and safe to release; a second verify reported the existing payment without re-applying; another reseller was refused the reference; staff release worked and refused twice. Two real bugs found and fixed — see field notes
- [x] Problem statement and go-live note drafted (`docs/`) — revisit after Chord testing. Go-live note now tells Kola how to link a second number
- [ ] 26 Oct: send Chord email
- [ ] Register MCP server, upload skill, test every path in the simulator
- [ ] Record, finish field notes, submit

## Writing style

Plain English, short sentences, specific numbers. Marvin's voice: warm, direct, no corporate filler.
