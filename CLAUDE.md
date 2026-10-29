# Kola Gadgets payments agent: TSG Labs take-home

Context for Claude Code. Read this first, then `docs/brief.md` for the official exercise.

## Who and what

- **Marvin Ogah**, product designer (8 years, mostly fintech). Writes React/React Native, uses Cursor and Claude Code. Applying to TSG Labs for **Product Management** first, **Growth** or **Technical Product Management** second.
- **The exercise:** build a Chord agent that does one useful job for a real business on WhatsApp, end to end. Must include a skill we wrote, a custom tool that calls an external system and a full simulator conversation where the tool takes a real action. Budget ~6 hours. Full brief: `docs/brief.md` (confidential, never commit it).
- **Marvin wants to understand the fundamentals** behind decisions, not just get code. Explain the why in plain English, briefly.

## Timeline

| When | What |
| --- | --- |
| 19 Oct | Brief received from Emmanuel (support@tsglabs.com) |
| 20 Oct | Sent questions on sender identity and the built-in Paystack connector |
| 20 to 21 Oct | Account setup and building outside Chord; Paystack and the Google Sheet wired up and proven |
| **22 Oct** | **TSG replied: Chord never passes the sender's phone number to a teammate or its tools and the simulator has one profile per agent.** Identity rebuilt on account code + PIN |
| 22 to 25 Oct | Marvin travelling (speaking at DevFest Akure) |
| **25 Oct** | GitHub remote created and pushed (`dudesoamazing/kola-gadgets-agent`); Render deployment live with public HTTPS and 64-char bearer token |
| **27 Oct** | **Credits and simulator access actually arrived** (TSG's 22 Oct email said they were added but they weren't visible until 27 Oct). Simulator connected, paths 1 and 2 tested. The 5-day window runs to about 1 Nov |
| **27 Oct** | Paths 3 to 6 tested. Found: tool results don't persist across turns (lost reference), collected-on-credit invoices misread, Ada's details shown to Tunde. All fixed |
| **28 Oct** | Agent fabricated payment confirmations and pickup codes twice (05:56, 10:39) with no `verify_payment` call; cause of the second was an example code in a tool description. **Final recording taken at 10:19** (genuine, ledger-verified). Field notes cut to Chord-only, go-live note rewritten, README troubleshooting and `docs/security.md` added. Five-wrong-PIN lockout built |
| **29 Oct** | Sign-in fixes: agent reported PIN mismatches without calling `identify`, then guessed attempt counts. Server now counts attempts. **Submit** |

## The problem

**Kola Gadgets** (made up) is a phone and laptop supplier in Computer Village, Lagos, selling to resellers. Resellers pick up stock on credit or pay first and collect later, often in split payments across their own customers. Transfers arrive without references and only the owner can see his bank account so payments go unmatched, resellers get chased for items already paid for and staff can't confirm payment before handing over stock when the owner is away.

The agent sits on the supplier's WhatsApp line. It ties every payment to specific invoices through a Paystack link, verifies it and lets staff confirm payment before release, without access to the owner's bank account.

This is a real problem Marvin has lived as a reseller. Keep that story at the centre of the submission.

## Design decisions (already agreed)

- **Three roles, proven by an account code and a 4-digit PIN, never by what someone claims.** Chord gives us nothing about the sender so the agent asks and the server checks on every call:
  - Reseller: see and pay their own invoices only.
  - Staff: check any invoice's payment status, record a handover. **Can never mark anything paid.**
  - Owner: everything, through the Google Sheet.
- **Identity is proven, not inferred.** Chord tells the agent nothing about who is messaging (confirmed 22 Oct) so everyone has an account code Kola issued plus a 4-digit PIN and both go to every tool on every call. A happy side effect of losing phone identity: a reseller can message from any phone and still see their own balance, which is what suppliers actually wanted. Only Kola can issue or reset a code. The agent never accepts "it's me, I've lost my PIN".
- **Only a verified Paystack payment marks an invoice paid.** Screenshots and "I've paid" are not proof.
- **Pickup codes: no code, no goods.** Copied from how Computer Village already works, which is why it needs no explaining to staff. A verified payment that clears an invoice in full mints a unique two-word code (two words from a list of about 2,000); the reseller reads it out at the counter and staff release against it. A part payment never produces one. **No tool ever shows a code to staff** (they prove a code by using it, not by being told it) and three wrong codes lock handovers from that staff account and flag the owner. The real value: the shop boy doesn't need to understand the ledger to do the right thing and the owner can be in Dubai while the goods still only move when the money has.
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
- **Custom tools must be an MCP server.** Public HTTPS, **Streamable HTTP** transport (Chord POSTs JSON, accepts JSON or SSE). Private/loopback addresses are blocked. A Google Sheet or plain REST API can't be plugged in directly; the MCP server translates.
- **MCP auth:** `bearer` → sent as `Authorization: Bearer …`; `api_key` → sent as `X-API-Key`; or `oauth` (needs dynamic client registration; Google's OAuth doesn't support it, which is why off-the-shelf Sheets MCP servers don't fit).
- `enabled_tools` restricts tools by exact name; empty means all.
- **Health probe returns HTTP 200 even when it fails**: read `status`, not the HTTP code.
- **Built-in connector tool types:** `bookings`, `menu`, `paystack`, `notion`, `linear`, `github`. The built-in Paystack connector doesn't count as our custom tool; what it can do is undocumented (asked TSG).
- **Answered 22 Oct:** Chord does **not** pass the sender's phone number to the teammate or its MCP tools and the WhatsApp simulator has one profile per agent. There is no sender identity at all so roles cannot be inferred. They have to be proven in the chat. See "Identity" below.

## MCP server (built)

Node + TypeScript, `@modelcontextprotocol/sdk` over Streamable HTTP (stateless), `zod` for input schemas, `googleapis` for Sheets. Bearer token checked on every `/mcp` request; the server refuses to start without `MCP_BEARER_TOKEN`.

```
src/
  index.ts            express app: bearer auth, /health, stateless /mcp
  server.ts           MCP server factory
  config.ts           env loading, startup config checks
  lib/format.ts       naira, kobo, Lagos timestamps, account-code/PIN/phone normalisation
  ledger/             People/Invoices/Payments/Flags behind one interface
    store.ts          the narrow TableStore both backends implement
    sheets-store.ts   Google Sheets via service-account JWT
    csv-store.ts      local data/*.csv
    ledger.ts         parsing, status rules, oldest-first ordering
  paystack/           initialize + verify, plus mock.ts stand-in
  tools/index.ts      the eight tools
scripts/smoke.ts      end-to-end test, no credentials needed
scripts/setup-sheet.ts  creates and seeds the four tabs
```

| Command | Does |
| --- | --- |
| `npm run dev` | Local server on :3000, hot reload |
| `npm run smoke` | Boots the server, drives all eight tools over real MCP HTTP, 152 assertions |
| `npm run typecheck` | `tsconfig.json` (src + scripts) |
| `npm run build` / `start` | `tsconfig.build.json` → `dist/index.js` (src only so output isn't nested) |
| `npm run setup:sheet` | Creates and seeds the ledger tabs; `--force` to replace |
| `npm run inspector` | MCP Inspector against localhost |

### Decisions made during the build

- **Two ledger backends behind one interface.** `LEDGER_BACKEND=csv` reads `data/*.csv`, `sheets` reads the real Sheet. Defaults to sheets when `GOOGLE_SHEET_ID` is set. All parsing and business logic lives in `TableLedger` so the two can't drift. The CSV backend is for dev and the smoke test only. Writes are last-one-wins.
- **`PAYSTACK_MODE=mock`** serves a local two-button checkout page instead of calling Paystack so the flow runs offline. It is no longer a fallback for large amounts (test mode has no cap) and it must not be what the recording shows. A mock only tests your own assumptions: mine said verify-unknown-reference was a 404 and the real API says 400.
- **`enableJsonResponse: true` on the transport.** The SDK defaults to SSE; nothing here streams and JSON is readable with curl. Chord accepts either. Logged in field notes.
- **Only `verify_payment` writes `amount_paid_ngn`.** No other code path touches it. The "staff can never mark anything paid" rule is structural, not prompt-level.
- **Double-apply guarded twice:** the Payments row reading `success` with a timestamp short-circuits a repeat verify and a per-reference in-process lock serialises concurrent calls. Single instance only. Scaling out would need the lock in the sheet or a real queue.
- **Account codes normalised on letters and digits** so "kg ada", "KG-ADA" and "kgada" all match. PINs normalised on digits so "4 4 6 1" works. The canonical code the agent says out loud is the one Kola wrote in the sheet, not the squashed comparison key. The smoke test caught the agent calling her account "KGADA".
- **The PIN never leaves the ledger layer.** `Ledger.authenticate(code, pin)` compares it internally and returns the person or a reason; there is no getter for a PIN anywhere and `senderView` carries neither PIN nor phone. Anything the model can see, it can repeat into the chat.
- **Invoice ids normalised on the digits** so "104", "inv 104" and "INV-104" all resolve.
- **The skill writes WhatsApp formatting, not Markdown.** Chord sends replies to the channel verbatim so `**bold**` arrives as asterisks and `[text](url)` arrives as an untappable string. Single-asterisk bold, bare URLs on their own line. Found in the first simulator run.
- **Explicit `0.0.0.0` binding on `app.listen`.** Render's reverse proxy routes traffic to container IPv4 (`10.x.x.x`); without specifying `0.0.0.0`, Node defaults to IPv6 `::` on Linux containers, returning 502 Bad Gateway to the load balancer.
- **Surrounding quotes stripped on env vars and private keys; 5s timeout on health check.** Dashboard inputs often retain quotes copied from `.env`; health check bounds external Google Sheets API calls to 5s and logs failures to `console.error`.

### Identity: account code + PIN (rebuilt 22 Oct, built)

TSG confirmed Chord passes **no sender identity at all** to a teammate or its MCP tools and the simulator has one profile per agent. Phone-based roles were therefore impossible. Identity is now proven in the chat.

- **People tab** holds `account_code` (e.g. `KG-ADA`) and a 4-digit `pin`, both issued by Kola. `phone` stays as a contact detail for him to ring people, never as identity.
- **Every tool takes `account_code` + `pin`** and re-checks them. There is no session and nothing is cached between calls: Chord gives us no stable handle to key a session on so re-checking is the only honest option.
- **`identify` replaces `get_sender_role`.** Same job, different question: not "who is this number?" but "what can this person prove?"
- **A mismatch is one message, always the same one.** Unknown code and wrong PIN are deliberately indistinguishable; otherwise the agent becomes a way to enumerate which account codes are live. Asserted in the smoke test by comparing the two messages.
- **Five wrong PINs lock the account and flag the owner** (decided 28 Oct; this replaced "flag but never lock"). A locked account refuses even the right PIN on every tool. **Only the right PIN is told the account is locked**: a wrong PIN on a locked account gets the same generic reply as an unknown code so locking never reveals which codes exist. Accepted trade-off: anyone who knows a code can lock that reseller out and Kola sees it in Flags. The flag records the code as typed. Locks and counters are in-process so a deploy or restart clears them; an owner unlock tool is on the roadmap.
- **The server counts attempts, never the model.** The model can't see earlier tool results so any count it states is a guess. The server returns the remaining attempts and the wording to use.
- **`account_id` stays the ledger key** for Invoices and Payments, one-to-one with `account_code`. Slightly redundant, kept so the Invoices and Payments tabs never carry a credential. Worth collapsing into one column if it ever causes confusion.
- **Dropped as meaningless:** `Payments.reseller_phone` and `Flags.phone`. Flags now records `account_code`.
- **No live credential appears in the skill.** Caught this on review: the first draft of `examples.md` showed "KG-ADA 4461" and the skill is uploaded to Chord so the model would have been carrying a working code and PIN it could be talked into handing over. Examples now write PINs as "4 digits" and `business.md` deliberately does not list the account codes.
- **Tested:** wrong PIN refused on every tool, identical message for unknown code and bad PIN, no PIN in any tool output or ledger row, spacing and case ignored, five misses lock the account, the right PIN is then refused with `account_locked`, a wrong PIN on a locked account looks like an unknown code and other accounts are unaffected.

### Pickup codes (added 23 Oct, built)

- **Invoices tab** has `pickup_code`. Blank until a verified payment settles the invoice in full.
- **Minted in `verify_payment` only** and only when that payment takes the invoice to zero outstanding. Generated with `crypto.randomInt`. This is the only thing between a stranger at the counter and a ₦2.4m laptop so it must not be predictable from an earlier code. Codes are also checked against every code still live so two resellers can never hold the same one.
- **Never reissued.** An invoice that already has a code keeps it so verifying twice cannot mint a second code for the same goods. Asserted in the smoke test.
- **`invoiceView` deliberately has no `pickup_code` field.** Staff read invoice status through that shape and a code staff can read is a code that releases goods without the reseller present. `get_pickup_codes` is the only place a code comes out.
- **Three wrong codes locks handovers from that staff account** and flags the owner. Stricter than the PIN policy (3 strikes, not 5): a wrong pickup code is someone at the counter trying to leave with a laptop. One staff account locking must not shut the shop: asserted that Tunde still works after Bisi is locked. In-process so a deploy clears it.
- **A code is spent on use.** The row keeps it for the audit trail; re-use is refused on the `collected` flag, which also means `already_collected` is what staff hear if someone tries a code twice.
- **Seed data:** INV-110 (Chidi, paid, uncollected) carries `418637` so the staff release demo runs without taking a payment first.
- **No example code anywhere the model can read**: not in the skill (examples write `[code from the tool]`) and not in tool or parameter descriptions. A smoke test fails if a WORD-WORD pattern appears in either. See "Rules learned in Chord testing".

### Tools (names must match the skill): eight

| Tool | Input | Does |
| --- | --- | --- |
| `identify` | `account_code`, `pin` | Check the credentials against People → `owner` / `staff` / `reseller`, plus name and `account_id`. A mismatch returns `not_permitted` and reveals nothing, not even whether the code exists |
| `get_reseller_balance` | `account_code`, `pin` | Unpaid and part-paid invoices for that reseller, with outstanding amounts and total |
| `check_invoice_status` | `account_code`, `pin`, `invoice_id` | Status, amount paid/outstanding, collected/when/by whom. Resellers only see their own |
| `create_payment_link` | `account_code`, `pin`, `invoice_ids[]`, `amount_ngn?` | Resellers only. Validate invoices belong to them and amount ≤ outstanding (≥ ₦50,000 if part); call Paystack initialize with our own reference and invoice IDs in metadata; log the pending row **after** Paystack returns a link; return link + reference |
| `verify_payment` | `account_code`, `pin`, `reference?` | **Reference is optional**: without one, the server checks this account's pending payments, newest first (the model loses references between turns). Returns `collected` and a note for invoices already collected on credit, plus a ready `summary_for_reply`. Only references we issued (an unknown one returns `not_found`) and only for the sender's own account unless they are staff or the owner. Call Paystack verify. On `success`, apply to invoices (oldest first) **once** and reports the existing confirmation if already applied. Any unallocatable remainder is flagged for the owner |
| `get_pickup_codes` | `account_code`, `pin` | Resellers only. Their paid, uncollected invoices with each pickup code. The only tool that returns a code and only to the account that paid |
| `record_handover` | `account_code`, `pin`, `pickup_code` | Staff and owner. Look the invoice up by code; refuse unless paid in full and uncollected; name the item to release; set collected, time, staff name. The code is then spent. A wrong code releases nothing and counts towards the 3-strike lock |
| `flag_for_owner` | `account_code`, `pin`, `invoice_id?`, `summary` | Append to Flags tab. Needs valid credentials like everything else so an unidentified person can no longer be flagged. Tell them to contact the shop instead |

Every tool returns plain, model-readable JSON and clear errors (`not_found`, `not_permitted`, `paystack_unreachable`…) rather than throwing; the skill tells the agent how to word each failure.

### Paystack (test mode)

- `POST https://api.paystack.co/transaction/initialize` with `email`, `amount` (**kobo**: ₦2,400,000 = 240000000), `reference`, `metadata` → returns `authorization_url`.
- `GET https://api.paystack.co/transaction/verify/:reference` → `data.status`: `success`, `failed`, `abandoned`, etc.
- Header: `Authorization: Bearer sk_test_…`. Paystack requires an email: use the one in People.
- **No test-mode amount cap** (checked 20 Oct): ₦2,400,000, ₦4,360,000 and ₦50,000,000 all initialize fine. The risk is retired; `PAYSTACK_MODE=mock` stays only as an offline convenience.
- **Paystack rejects reserved-TLD emails.** `ada@resellers.test` and `ada@kolagadgets.example` fail with `"email" must be a valid email`; `example.com` and real domains pass. The seed ledger uses `example.com`. Do not put `.test` back.
- **`verify` on an unknown reference is HTTP 400 with `code: transaction_not_found`, not 404.** Matching only on 404 turned an unopened link into "couldn't reach the payment system". An initialized-but-unpaid link returns `abandoned`, which is different and correct.
- **The test checkout now shows simulated outcomes** (Success, Bank Authentication, Declined) instead of a card form. Pick Success. Proven end to end in the browser and in the final recording.
- Two failure shapes, deliberately distinct: Paystack **down or slow** → `paystack_unreachable`, "try again in a minute". Paystack **saying no** (bad email, bad key, 4xx validation) → `bad_input`, flagged for the owner, no retry offered, because retrying never helps. Either way no pending row is written so the Payments tab never holds a reference that doesn't exist.

### Ledger (Google Sheet)

Live: Sheet **kolagadgets**, reached by the `ledger-bot@` service account (ids in `.env`, never committed).

Seed data in `data/*.csv`. `npm run setup:sheet` creates the four tabs and fills them. It's also the fastest check that the service account can reach the Sheet (a 403 means it was never shared). Share the Sheet with the service account email as an Editor.

`setup:sheet -- --force` clears and re-seeds, which is how to put the ledger back to pristine demo numbers after testing. Do this before recording: Ada must owe ₦4,360,000 across INV-104, INV-107 and INV-109 and INV-112 must be part-paid at ₦600,000 of ₦1,200,000.

Tabs:

- **People:** account_code, pin, name, role, email, account_id, phone (contact only, never identity)
- **Invoices:** invoice_id, account_id, pickup_code, items, amount_ngn, amount_paid_ngn, created_at, collected, collected_at, collected_by
- **Payments:** reference, account_id, invoice_ids, amount_ngn, status, link, created_at, verified_at
- **Flags:** created_at, account_code, invoice_id, summary

Status is derived, not stored: paid = amount_paid ≥ amount.

Ownership is by account. See "Identity: account code + PIN" above. Codes and PINs are the only credentials in the system so the Sheet is as sensitive as a password file: keep it private to Kola and the service account.

### Hosting (live)

**`https://kola-gadgets-mcp.onrender.com`**: free Render web service from `render.yaml`, health check on `/health`, secrets in the dashboard (`sync: false`).

**Confirmed 25 Oct:** the free tier sleeps after ~15 minutes and Chord's first call to a cold server fails as **`gateway request failed 500`**. A retry works. **UptimeRobot pings `/health` every 5 minutes during testing** so the server shouldn't sleep. A cold start on 27 Oct coincided with the chat being escalated to a human with no reason given; if the agent stops answering, check Chord for a paused banner and hand the chat back. Written up in the field notes. The useful part is that Chord's error is identical whether the server 500'd, timed out or was asleep.

Register in Chord as: transport **Streamable HTTP**, URL `https://kola-gadgets-mcp.onrender.com/mcp`, auth **bearer**, token from the Render dashboard's `MCP_BEARER_TOKEN`, a 64-char random hex, swapped in on 25 Oct. The first deploy went out with `kola-local-dev-token`, a guessable dev placeholder guarding a public URL that can issue payment links and release stock. Don't put a dev token on a production service.

Two deployment problems, both real and both fixed (see field notes):

- **Bind to `0.0.0.0`,** not the default. Render's proxy can't route to a service listening on localhost and it fails silently: the build succeeds and nothing answers.
- **No quotes around values in the Render dashboard.** A local `.env` parser strips them; `process.env` in a container does not so a quoted `GOOGLE_PRIVATE_KEY` reached OpenSSL with `"` as its first character and threw `DECODER routines::unsupported`. `config.ts` now strips surrounding quotes from every variable as belt and braces but don't paste them.

**Verified live (25 Oct)** with the production token: `/health` ok on the Sheets backend, all eight tools over `tools/list`, 401 with no token *and* with the old one, `identify` and balances reading the real Sheet, a wrong PIN refused, staff refused a pickup code and `create_payment_link` returning a real `checkout.paystack.com` link, which also proves Render's egress to Paystack works. Ledger reset to demo numbers afterwards.

Our `/health` returns **503** when the ledger or config is broken and lists the problems, the opposite of Chord's probe, which returns 200 either way. Don't confuse the two when debugging.

### Secrets

`.env` only (see `.env.example`). Never commit keys or the service-account JSON.

## Rules learned in Chord testing (27 to 29 Oct)

Each of these came from a real failure in the simulator. Don't undo them.

- **The model's words are not evidence.** It has confirmed payments, issued pickup codes and reported PIN mismatches without calling a tool. Anything that moves money or stock is checked on the server and the skill says: never state a confirmation, balance, code or mismatch unless a tool returned it in this turn.
- **Tool descriptions are prompt.** They go to the model every turn. An example value there ("e.g. MANGO-TIGER") was copied into a fake confirmation. Describe formats, never give example codes, PINs or references.
- **Tool results don't carry over between turns.** Never require the model to remember an ID from an earlier tool call. Keep state in the ledger and let tools look it up (hence the optional reference on `verify_payment`).
- **Say explicitly what happened in every tool result.** A missing field gets misread as a fault: a paid invoice with no pickup code (collected earlier on credit) led to a false flag asking Kola to issue codes for goods already released. Return explicit states, a note and `summary_for_reply`.
- **The server counts and decides; the model only relays.** Attempt counts, locks and remaining tries come from the server.
- **A bare PIN reuses the code given earlier in the chat.** Always call `identify` on every attempt.
- **No promises before sign-in.** `flag_for_owner` needs a signed-in account so the agent must not offer to "call Kola's attention" before then. Kola is flagged automatically when an account locks.
- **One chat can hold more than one person.** When a different account signs in, nothing about the previous person is mentioned or carried over.
- **WhatsApp formatting only.** Single-asterisk bold, bare URLs, no Markdown links or headers.

## Working process

- **Chord doesn't sync skill files.** After any change under `skill/`, list the changed files so Marvin can paste each into Chord with "Update selected file".
- **Before a simulator test:** push and wait for Render to show Live, paste changed skill files, reseed with `npm run setup:sheet -- --force`, start a new chat link.
- **Verify with the server log, not the chat.** Every tool call logs one line (time, tool, duration, ok or error). One action in the chat should mean one line in the log.
- **Smoke tests run on Marvin's Mac.** `node_modules` is built for macOS so a Linux run needs a separate `npm ci` copy.

## Deliverables (from the brief)

1. Role preference + problem statement → `docs/problem-statement.md` (gitignored; sent with the submission, not kept in the repo)
2. Working agent left live on Chord
3. Repo with skill files, tool code and a short README (include how AI tools were used) → `README.md` drafted
4. 3-minute screen recording. Centrepiece: "send acct dets" → payment link; "I don send am to your account" read correctly as a payment claim; staff release check
5. **Deployment field notes, the most important part** → `docs/field-notes.md`. **Chord findings only**: three full notes (fabricated confirmations, tool results lost between turns, no sender identity), then shorter findings ranked by impact. Problems outside Chord go in the README's Troubleshooting section or `docs/security.md`, not here.
6. Go-live note, half a page max, for a non-technical owner → `docs/go-live-note.md` (rewritten 28 Oct; includes failure handling and honest limits)
7. Security and identity design → `docs/security.md` (threat model, lockout, plain-text PIN limit, hashing plan, secrets handling)

Live session prep: `docs/live-session.md`, gitignored, not part of the submission. The original long field notes, the TSG blocker email and the recording script are archived outside the repo in `/Volumes/Paradise/kola-gadgets-archive/`.

Scoring: Integration 25%, Field notes 25%, Problem choice 20%, Customer thinking 15%, Communication 15%. PM weights problem choice + customer thinking; Technical PM weights payment integration + the go-live note.

## Tasks

- [x] Problem and conversation design
- [x] Skill drafted (`skill/kola-gadgets-payments/`)
- [x] Seed ledger data (`data/`)
- [x] Paystack test account + secret key, in `.env` (never committed), `PAYSTACK_MODE=live`
- [x] Google Cloud project, Sheets API, service account key; Sheet "kolagadgets" created and shared. Verified 21 Oct end to end on `LEDGER_BACKEND=sheets`: `/health` ok, a real Paystack link wrote a pending row, verify applied ₦310,000 to INV-109 and marked it paid, a repeat verify did not re-apply, staff release wrote collected/by/at. Sheet reset to seed data afterwards with `setup:sheet -- --force`
- [x] GitHub repo pushed to https://github.com/dudesoamazing/kola-gadgets-agent (`main`)
- [x] Build MCP server (`src/`), tested locally. `npm run smoke` drives all eight tools over real MCP HTTP, 110 assertions
- [x] README drafted (`README.md`): how to run, the eight tools, how AI tools were used
- [x] Deploy to public HTTPS: live on Render (`https://kola-gadgets-mcp.onrender.com`); verified from outside end to end on 25 Oct: `/health` ok on the Sheets backend, all eight tools, bearer auth enforced, real Sheet reads and a real Paystack link created from Render. Production token swapped off the dev placeholder
- [x] Sign up to Chord; explore Tools panel and skill upload (completed)
- [x] Multiple phones per reseller account: solved outright by dropping phone identity on 22 Oct; a code works from any device
- [x] `verify_payment` refuses a reference from another account; staff and the owner may verify any
- [x] **Identity rebuilt on account code + PIN (22 Oct)** after TSG confirmed Chord passes no sender identity: `identify` replaces `get_sender_role`, every tool takes `account_code` + `pin` and re-checks on every call, PIN never echoed, five misses flag the owner. Skill, seed data, smoke tests and field notes updated
- [x] Real Paystack test mode proven end to end (20 Oct): tool created a live `checkout.paystack.com` link for ₦2,710,000; a test-card charge then verified, applied to INV-109, marked it paid and safe to release; a second verify reported the existing payment without re-applying; another reseller was refused the reference; staff release worked and refused twice. Two real bugs found and fixed (see field notes)
- [x] Problem statement and go-live note drafted (`docs/`), revisited after Chord testing. Go-live note covers issuing codes and PINs
- [x] **Pickup codes (23 Oct):** `pickup_code` on Invoices, minted by `verify_payment` only on full settlement, `get_pickup_codes` for resellers, `record_handover` works from the code, 3 wrong codes locks that staff account. Skill, examples, seed data, smoke tests and go-live note updated
- [x] **Unbroken click-through proven on real Paystack test mode (25 Oct):** `create_payment_link` on production issued `checkout.paystack.com/f35kw562fpz24nn`, Marvin opened and paid it with the test card in a browser, `verify_payment` returned `success` (channel `card`), applied ₦310,000, marked INV-109 paid and minted pickup code; a repeat verify did not re-apply; staff released against the code and were refused the second time. Recording script now archived outside the repo
- [x] Chord credits received 27 Oct; MCP server registered and tools discovered
- [x] Test every path in the simulator (27 to 28 Oct): sign-in, balance, payment link, payment and verify, lost code, staff release, reused and wrong codes
- [x] Recording: 10:19 take on 28 Oct, ledger-verified (INV-109, code RACKET-POT, released by Tunde). Before submitting: blur the PIN column on the People tab, trim the empty opening, add captions
- [x] Field notes, go-live note, README and `docs/security.md` rewritten (28 Oct)
- [x] Five-wrong-PIN lockout (28 Oct)
- [~] Sign-in fixes (29 Oct): server-side attempt counting, bare-PIN handling, no flag offers before sign-in
- [ ] Make the repo public (history already checked clean), upload the video and captions to Google Drive, reply to Emmanuel with the Drive link and roles (Product Management, then Technical PM)
- [ ] After submitting: pause UptimeRobot, leave the agent live on Chord

## Writing style

Plain English, short sentences, specific numbers. Marvin's voice: warm, direct, no corporate filler. He writes as a product designer with a product-heavy background so tie findings to what happens to Kola, his staff and his resellers.

For every doc in the repo:
- **No em dashes or en dashes.** Use a full stop, comma, colon or parentheses. Write ranges as "2 to 3".
- **No comma before a conjunction** (and or but so nor yet).
- Don't quote a real PIN or pickup code anywhere except the seed data.
