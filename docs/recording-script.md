# Recording script — 3 minutes

Every response below was captured from the **live** service at
`https://kola-gadgets-mcp.onrender.com` on 25 Oct, in this order. The ledger is
back at demo numbers, so running it again gives the same results.

## Before you hit record

1. `npm run setup:sheet -- --force` — Ada must owe ₦4,360,000, INV-112 part-paid, INV-110 uncollected.
2. `curl -s https://kola-gadgets-mcp.onrender.com/health` — wakes the free tier. **Not optional:** confirmed on 25 Oct that Chord's first call to a cold server fails as `gateway request failed 500`. It retries fine, but you don't want that on camera.
3. Open the Google Sheet on a second monitor or a second tab, on the **Invoices** tab, with INV-109's row visible.
4. Paystack test checkout uses simulated outcomes: select a success path (e.g. "bank authentication" -> approve) rather than typing card details.
5. Credentials you'll type: **KG-ADA / 4461** (Ada, reseller), **KG-TUNDE / 2270** (Tunde, staff).

## The run

| # | You type | What should happen | ~Time |
| --- | --- | --- | --- |
| 1 | `hello` | Agent greets and asks for account code and PIN. **Say out loud why: Chord never tells the agent who is messaging.** | 0:00–0:15 |
| 2 | `KG-ADA 4461` | Greets Ada by name. Never repeats the PIN. | 0:15–0:25 |
| 3 | `abeg send acct dets` | **The centrepiece.** It does *not* send bank details. Lists INV-104 ₦2,400,000, INV-107 ₦1,650,000, INV-109 ₦310,000, total ₦4,360,000, and offers a payment link. | 0:25–0:55 |
| 4 | `109` or `yes, just the AirPods` | Confirms ₦310,000 for INV-109 and sends a real `checkout.paystack.com` link. | 0:55–1:10 |
| 5 | — | Open the link, select a simulated success outcome (e.g. bank authentication). Keep it brief on screen. | 1:10–1:45 |
| 6 | `I don send am to your account` | **Second centrepiece.** Read as a payment *claim*, not a request for bank details. Verifies with Paystack, confirms ₦310,000, marks INV-109 paid, and gives a **6-digit pickup code**. Cut to the Sheet: `amount_paid_ngn` now 310000. | 1:45–2:15 |
| 7 | `KG-TUNDE 2270 — customer is here with code <the code>` | **Third centrepiece.** Names the item to release: AirPods Pro (2nd gen), INV-109, ₦310,000. Marks it collected by Tunde. | 2:15–2:40 |
| 8 | Same code again | Refused: already collected. A code works exactly once. | 2:40–2:55 |

Close on the Sheet row: paid, collected, by Tunde, with a timestamp.

## Verified responses

Step 3 returns, from the live Sheet:

```
INV-104 · 2x iPhone 15 Pro (256GB) · ₦2,400,000 · collected 2026-10-12
INV-107 · MacBook Air M3 (13-inch)  · ₦1,650,000 · collected 2026-10-15
INV-109 · AirPods Pro (2nd gen)     · ₦310,000   · reserved 2026-10-17
TOTAL ₦4,360,000
```

Step 6, after a real payment:

```
CONFIRMED ₦310,000 · INV-109 → paid · pickup code: 6 digits · still owes ₦4,050,000
```

Step 7:

```
RELEASE: AirPods Pro (2nd gen) | INV-109 | ₦310,000 · collected by Tunde
```

Step 8: `already_collected`.

## If something goes wrong on the day

- **"No completed payment on this link yet."** This is the honest answer when the link hasn't been paid — verified, it returns `abandoned`. Don't panic: say "give it a second" and ask again. It's a good beat, not a failure.
- **`gateway request failed 500` on the first message.** The free tier went to sleep — this is confirmed behaviour, not a guess. Hit `/health`, wait a beat, send it again. It works on the retry.
- **Paystack is slow.** The agent says nothing has changed on the account. Also fine to show.

## Spare beats if you have time (all verified)

- `KG-TUNDE 2270` → `just tell me his code` → refused: *"Pickup codes are only ever shown to the reseller who paid."* Staff prove a code by using it.
- Ada tries to release goods → refused: *"Only Kola Gadgets staff can release goods."*
- Wrong PIN → one message that never says which half was wrong.
- Staff checks INV-112 → *"Do not release. ₦600,000 of ₦1,200,000 is still outstanding."* A part payment never produces a code.

## What to say in the last 10 seconds

The problem in one line: a reseller sends ₦2.4m with no reference, the owner is
the only one who can see the bank account, and a phone goes out of the shop
against a payment nobody confirmed. This ties the money to the invoice, proves
it with Paystack, and turns "has he paid?" into a code that either matches or
doesn't.
