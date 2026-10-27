# Recording script — 3 minutes

The flow below was re-tested end to end in the Chord simulator on 27 Oct. The ledger is back at demo numbers, so running it again gives the same flow, though the exact wording of replies will vary.

## Before you hit record

1. Check all three skill files in Chord (`SKILL.md`, `references/examples.md`, `references/business.md`) match the repo. Chord doesn't sync; paste any that changed with "Update selected file".
2. Restart the Render service (Manual Deploy → Restart). Wrong-code counts and handover locks live in server memory; reseeding doesn't clear them.
3. `npm run setup:sheet -- --force`. Ada must owe ₦4,360,000, INV-112 part-paid, INV-110 uncollected.
4. Load `/health` and wait for status ok. UptimeRobot should already be pinging every 5 minutes; confirm it's running.
5. Start a fresh chat: New link on the chat-link card. Enter "Ada" as the customer name (the agent uses this name before sign-in).
6. Close the conversation view in the Chord dashboard, and don't open it during the take.
7. Turn on Do Not Disturb on the laptop and phone.
8. Layout: record on the laptop, with the simulator (chat.tsglabs.dev) on one side and the Google Sheet's Invoices tab on the other, INV-109's row visible.
9. Paystack test checkout uses simulated outcomes: pick the successful one (e.g. "bank authentication" → approve). No card form.
10. Credentials: **KG-ADA / 4461** (Ada, reseller), **KG-TUNDE / 2270** (Tunde, staff).
11. Do one full timed rehearsal first, then repeat steps 2–5 before the real take.

## The run

| # | You type | What should happen | ~Time |
| --- | --- | --- | --- |
| 1 | `hello` | Agent greets and asks for account code and PIN. **Say out loud why: Chord never tells the agent who is messaging.** | 0:00–0:15 |
| 2 | `KG-ADA 4461` | Greets Ada by name. Never repeats the PIN. | 0:15–0:25 |
| 3 | `abeg send acct dets` | **The centrepiece.** It does *not* send bank details. Lists INV-104 ₦2,400,000, INV-107 ₦1,650,000, INV-109 ₦310,000, total ₦4,360,000, and offers a payment link. | 0:25–0:55 |
| 4 | `just the AirPods` | Confirms ₦310,000 for INV-109 and sends a real `checkout.paystack.com` link. Paying one invoice is better on camera: a shorter confirmation, and the remaining balance (₦4,050,000) is easy to follow. | 0:55–1:10 |
| 5 | — | Open the link, select a simulated success outcome (e.g. bank authentication → approve). Keep it brief on screen. | 1:10–1:45 |
| 6 | `I don send am to your account` | **Second centrepiece.** Read as a payment *claim*, not a request for bank details. Verifies with Paystack without needing a reference, confirms ₦310,000, marks INV-109 paid, and gives a **two-word pickup code** (e.g. `MANGO-TIGER`) on its own line. Cut to the Sheet: `amount_paid_ngn` now 310000. *(Note: Rehearse this exact phrase. "Your account" could be read as a bank transfer to Kola; the agent must verify the outstanding payment link first. If it flags a bank transfer instead, fix SKILL.md before recording).* | 1:45–2:15 |
| 7 | `KG-TUNDE 2270 — customer is here with code <the code>` | **Third centrepiece.** Names the item to release: AirPods Pro (2nd gen), INV-109, ₦310,000. Marks it collected by Tunde. Nothing about Ada's account should be mentioned. | 2:15–2:40 |
| 8 | Same code again | Refused: already collected. A code works exactly once. | 2:40–2:55 |

Close on the Sheet row: paid, collected, by Tunde, with a timestamp.

About 3 minutes is tight with 7 messages and 10–20s replies. Trim dead air while the agent is typing, but never cut or edit any part of a reply.

## Verified responses (examples)

Exact wording varies, but each response covers these points.

Step 3 returns, from the live Sheet:

```
- INV-104 · 2x iPhone 15 Pro (256GB) · ₦2,400,000 · collected 2026-10-12
- INV-107 · MacBook Air M3 (13-inch)  · ₦1,650,000 · collected 2026-10-15
- INV-109 · AirPods Pro (2nd gen)     · ₦310,000   · reserved 2026-10-17
Total outstanding: ₦4,360,000
```

Step 6, after a real payment:

```
Payment of ₦310,000 confirmed (ref KG-...).
- INV-109 (AirPods Pro (2nd gen)): paid. Your pickup code is:

MANGO-TIGER

Total outstanding balance is now ₦4,050,000.
```

Step 7:

```
RELEASE: AirPods Pro (2nd gen) | INV-109 | ₦310,000 · collected by Tunde
```

Step 8: `already_collected`.

## If something goes wrong on the day

- **"No completed payment on this link yet."** This is the honest answer when the link hasn't been paid — verified, it returns `abandoned`. Don't panic: say "give it a second" and ask again. It's a good beat, not a failure.
- **`gateway request failed 500` on the first message.** The free tier went to sleep — this is confirmed behaviour, not a guess. Hit `/health`, wait a beat, send it again. It works on the retry.
- **The agent doesn't answer ("The agent didn't answer. Try sending again."):** check Chord for a paused or escalated banner, hand the chat back to the agent, then resend. Seen on 27 Oct after a cold start.
- **The agent asks for a payment reference:** Chord has the old SKILL.md loaded. Update it and restart the take.
- **The agent offers pickup codes for INV-104 or INV-107:** the old server or skill is running. Stop, check Render is on the latest deploy, and check the skill files.
- **Paystack is slow.** The agent says nothing has changed on the account. Also fine to show.

## Spare beats if you have time (all verified)

- `KG-TUNDE 2270` → `just tell me his code` → refused: *"Pickup codes are only ever shown to the reseller who paid."* Staff prove a code by using it.
- Ada tries to release goods → refused: *"Only Kola Gadgets staff can release goods."*
- Wrong PIN → one message that never says which half was wrong.
- Staff checks INV-112 → *"Do not release. ₦600,000 of ₦1,200,000 is still outstanding."* A part payment never produces a code.
- Wrong pickup code → made-up code gives *"release nothing"*, states attempts left, and locks out after 3 wrong attempts.
- Lowercase code input → `"item fawn"` (or `"mango tiger"`) matched.

Keep these spare beats outside the 3 minutes.

## What to say in the last 10 seconds

The problem in one line: a reseller sends ₦2.4m with no reference, the owner is
the only one who can see the bank account, and a phone goes out of the shop
against a payment nobody confirmed. This ties the money to the invoice, proves
it with Paystack, and turns "has he paid?" into a code that either matches or
doesn't.
