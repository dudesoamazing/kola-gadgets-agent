# Deployment field notes

The most important deliverable. Log as it happens — don't tidy problems away. Final submission: 2–3 strongest notes, each specific.

Template for each note:

### [Short title]
- **What happened** (and any error message):
- **How I found the cause:**
- **Fix or workaround:**
- **What Chord should change** (product, docs or API):

---

## Running log

### Sender identity isn't documented
- **What happened:** The design depends on knowing who is messaging (reseller vs staff). Neither the skills, MCP or build-a-teammate docs say whether the sender's WhatsApp number reaches the agent or its MCP tools.
- **How I found it:** Read Build a teammate, Skill files, MCP connections and Teammates docs on 20 Oct.
- **Fix or workaround:** Asked TSG on 20 Oct. Awaiting reply.
- **What Chord should change:** Document which conversation context (sender id, channel, thread id) the model and tools receive, with an example.

### Custom tools are MCP-only, and that isn't stated where builders look first
- **What happened:** The brief lists a Google Sheet as a valid tool target, but Chord can only call custom tools through a public MCP server. The Sheet needs a server in front of it.
- **How I found it:** MCP connections doc; Teammates doc lists built-in connector types (bookings, menu, paystack, notion, linear, github) — no Sheets or generic HTTP tool.
- **Fix or workaround:** Building a small MCP server that wraps the Sheet and Paystack.
- **What Chord should change:** A "how do I add a custom tool?" page that says MCP is the only path, with a minimal Streamable HTTP server template.

### The MCP SDK answers in SSE by default, and nothing says what Chord wants
- **What happened:** Built the server with `StreamableHTTPServerTransport` and the first `curl` of `tools/list` came back as `event: message\ndata: {…}` with `content-type: text/event-stream`, not JSON. Nothing was broken — it just wasn't what I expected to hand to Chord.
- **How I found the cause:** Read the transport's own type definitions in `node_modules`. There's an `enableJsonResponse` option, documented there as *"Default is false (SSE streams are preferred)"*. The Chord docs say Chord POSTs JSON and accepts JSON **or** SSE, so either would work, but they don't say which it handles better.
- **Fix or workaround:** Set `enableJsonResponse: true`. The server is stateless — one request, one response — so there is nothing to stream, and a plain JSON body is readable with `curl` and can't trip a client that handles `text/event-stream` badly. Verified: `content-type: application/json`.
- **What Chord should change:** State in the MCP connections doc which response style Chord prefers, and show the one line that switches it. "Accepts either" leaves a builder guessing on a choice that's awkward to change after the tool is registered.

### Paystack rejects `.test` email addresses, so every payment link failed
- **What happened:** First real call to Paystack with the test key, and `POST /transaction/initialize` returned `{"status": false, "message": "\"email\" must be a valid email", "code": "invalid_params"}`. The email was `ada@resellers.test` — made-up seed data, exactly as the brief asks for. Not one payment link could be created.
- **How I found the cause:** The amount was the suspect, since Kola's invoices run to ₦2.4m and I'd been warned test mode might cap them. So I probed the two variables separately: same call at ₦310,000 failed the same way, and a ₦50,000,000 call with a different email succeeded. That isolated it to the email. Then I tried four domains: `ada@resellers.test` ✗, `ada@kolagadgets.example` ✗, `ada@example.com` ✓, `ada.okafor@gmail.com` ✓. Paystack rejects reserved TLDs (`.test`, `.example`), which are precisely the ones you're supposed to use for fake data.
- **Fix or workaround:** Moved the seed ledger to `example.com` addresses, which are still obviously fake and still IANA-reserved, but pass Paystack's validator. Separately, the code now distinguishes "Paystack said no" from "Paystack is down": a validation error returns `bad_input`, flags it for the owner and does **not** tell the reseller to try again, because retrying a bad email fails identically forever. Before, both paths returned `paystack_unreachable` — "try again in a minute" for a problem that would never resolve.
- **Bonus finding, the good kind:** there is no test-mode amount cap at initialize. ₦2,400,000, ₦4,360,000 and ₦50,000,000 all returned an authorization URL. That retires the risk I'd built the whole mock-checkout fallback for.
- **What should change:** Paystack's test-mode docs should say the email is validated against real TLDs, because the one thing every developer puts in seed data is a fake domain. The error says `"email" must be a valid email` about an address that is perfectly well-formed — `"email" domain must be a real TLD" `would have saved an hour.

### "Transaction reference not found" is HTTP 400, not 404
- **What happened:** `GET /transaction/verify/:reference` on a reference Paystack has never seen returns **HTTP 400** with `code: "transaction_not_found"`, not the 404 you'd expect. My client treated only 404 as "no payment yet" and everything else as unreachable, so an unopened payment link would have told the reseller "I couldn't reach the payment system" instead of "no completed payment on that link yet."
- **How I found the cause:** Probing with the real key before trusting the code. I called verify on a reference whose initialize had failed, and printed the status code alongside the body — `HTTP 400` with a body that clearly meant *not found*. It would never have shown up in mock mode, because I'd written the mock to match my assumption rather than Paystack.
- **Fix or workaround:** Match on the HTTP status **or** `code: "transaction_not_found"` **or** the message text. Confirmed against the live test API: an initialized-but-unpaid link now returns `abandoned` (correct — Paystack does know it), and a reference Paystack never received returns `not_found`. Both produce the same honest sentence to the reseller, and neither touches a balance.
- **What should change:** Either return 404, or document the 400. More generally: a status-code table for the error codes would stop every integrator guessing. The lesson I'd keep for Chord too — a mock you wrote yourself only tests your assumptions, so probe the real API before the mock hardens them.

### Google Workspace's own MCP servers can't connect, because Chord's OAuth has no field for a client ID
- **What happened** (20–21 Oct): The ledger is a Google Sheet, so the obvious route was an existing Sheets MCP server. None of them could be registered in Chord. Community servers mostly run locally, which Chord blocks. Google's own **Sheets MCP server** (`https://sheetsmcp.googleapis.com/mcp/v1`) is hosted publicly and speaks Streamable HTTP, so it passes Chord's transport rules — but it authenticates with OAuth using a **pre-registered client ID and secret**.
- **How I found the cause:** Chord's MCP connections doc: the `oauth` flow "requires … dynamic client registration", registers a public client automatically, and "providers requiring a pre-registered client ID/secret … need an integration beyond these APIs; there are no request fields for those settings." Google's Sheets MCP doc asks for an OAuth client ID and secret created in advance and doesn't mention dynamic registration. The other auth types don't help either: Google API keys only reach public data, and a static bearer would be a Google access token that expires in about an hour.
- **Fix or workaround:** Built our own MCP server. It holds a Google service-account credential and reaches the Sheet itself; Chord only ever sees a long-lived bearer token. This turned out to be the better design anyway: Google's server exposes raw cell tools (`update_values`, `update_formulas`), which would let the agent write to *any* cell — including the amount paid. Ours exposes business actions only, so "only a verified Paystack payment marks an invoice paid" is enforced by the tools, not just the prompt.
- **What Chord should change:** Accept a pre-registered OAuth **client ID and secret** (plus custom scopes) when registering an MCP server, alongside dynamic registration. That would unlock Google Workspace's MCP servers — Sheets, and the rest of the family — which many small businesses already run on. Until then, state in the auth section that `oauth` only works with providers that support dynamic client registration, and name Google as an example that doesn't.
---

## Setup issues outside Chord

Not Chord problems, so not candidates for the final field notes. Kept here for the README's troubleshooting section and for anyone setting this up again.

### Google blocked service-account keys on a project inside an organisation
- **What happened** (21 Oct): Creating a JSON key for the service account failed with "Service account key creation is disabled — an Organization Policy that blocks service accounts key creation has been enforced on your organization" (`iam.disableServiceAccountKeyCreation`).
- **How I found the cause:** Google's troubleshooting docs: the policy is enforced by default on organisations created on or after 3 May 2024. The project had been created inside an organisation rather than under my personal account.
- **Fix or workaround:** Created a fresh project under my personal Gmail with Location set to "No organization". Key creation worked there. (Alternatives: override the policy for one project as an Organization Policy Administrator, or avoid keys entirely with an Apps Script bridge.)
- **For the README:** "If key creation is disabled, create the project with no organisation, or ask your organisation admin to override `iam.disableServiceAccountKeyCreation` for this project only."

### Enabled "Sheets MCP API" instead of "Google Sheets API"
- **What happened** (21 Oct): `npm run setup:sheet` failed with "Google Sheets API has not been used in project 194528009587 before or it is disabled", even though I'd enabled a Sheets API.
- **How I found the cause:** Matched the service account's email (`…@dotted-transit-244009.iam.gserviceaccount.com`) to the project in the error, then checked the enabled APIs in that project. The one enabled was **Sheets MCP API** — a different product with a near-identical name in the API Library search results.
- **Fix or workaround:** Enabled **Google Sheets API** in the project the service account belongs to, waited a minute, and reran the script.
- **For the README:** "Enable **Google Sheets API** — not 'Sheets MCP API' — in the same project as your service account. The error message's link opens the right project."
- **Related:** checked whether Chord could connect to Google's Sheets MCP server directly — it can't; see "Google Workspace's own MCP servers can't connect" above.
