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

### A Google Sheet can't be reached with Chord's OAuth tool type
- **What happened:** The plan was a Google Sheet as the ledger. Chord's `oauth` auth type needs dynamic client registration; Google's OAuth doesn't support it, so off-the-shelf Sheets MCP servers can't be registered as a Chord tool at all.
- **How I found the cause:** Chord's MCP auth doc lists `bearer`, `api_key` and `oauth`, with DCR required for `oauth`. Cross-checked against Google's OAuth docs — no DCR endpoint.
- **Fix or workaround:** Our own server holds a Google service-account JWT and talks to the sheet with its own credentials; Chord only ever sees a bearer token. Side benefit: the sheet is never shared with Chord, and the service account is a single Editor grant the owner can revoke in one click.
- **What Chord should change:** Say plainly in the auth section that `oauth` only works with providers supporting dynamic client registration, and name Google as a known exception. It's the difference between an afternoon and five minutes.
