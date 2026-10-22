# Go-live note: your payments assistant

Kola, this assistant answers your WhatsApp line for one job: keeping payments and pickups straight.

**What it does**

- When a reseller asks for your account details, it sends a payment link for the exact invoices instead — so every naira arrives already matched to the goods.
- It confirms payments with Paystack itself. Screenshots and "I've sent it" don't count.
- Your staff can ask "Has INV-112 been paid?" and get a straight answer, even when you can't be reached.
- Part payments go to the oldest invoice first, and part-paid goods are never released.
- **When a payment clears an invoice in full, the assistant gives the reseller a 6-digit pickup code.** Your staff release the goods only when the reseller reads that code out and the assistant confirms it matches. No code, no goods — the way the market already works. A part payment gets no code, so half-paid stock cannot leave the shop.
- It asks each person for their account code and 4-digit PIN before it discusses an account. WhatsApp doesn't tell the assistant who is messaging, so this is how it knows. One upside: a reseller can message from any phone — a new line, a friend's handset — and still see their own balance.

**What it won't do**

- No one can mark an item paid in the chat — not resellers, not your staff, not the assistant. Only a confirmed Paystack payment can. You can still record a bank transfer yourself in the sheet.
- **It will not read a pickup code out to your staff**, even when they ask, because that would let goods go without the reseller. Staff prove a code by typing it in. If one of them gets a code wrong three times, the assistant stops accepting handovers from their account and tells you — so if a staff member says they're locked out, that's why, and it needs you to look at it.
- It can't see transfers into your bank account, log new pickups or change prices. Disputes come straight to you.
- It never issues or resets a code or PIN, and never reveals whether a code exists. Someone who can't sign in is told to call you. Only you can add or change a code, in the People tab.

**Before real customers use it**

1. Switch Paystack from test to live keys, confirm your settlement account, and decide who pays the Paystack fee.
2. Connect your WhatsApp Business number to Chord.
3. Give every reseller and staff member an account code and a 4-digit PIN in the People tab, and tell each person theirs privately. Anyone without a valid pair gets no information at all. **Treat that sheet like the keys to the shop** — the codes and PINs are the only lock on the ledger, so keep it private to you, use a different PIN for each person, and change one the moment somebody leaves.
4. Tell your staff the one rule that matters: **release nothing until the assistant confirms the code.** Not for a regular, not for someone in a hurry, not for a screenshot.
5. Choose who gets alerted when something needs you. Today, flags only land in the sheet's Flags tab — check it daily.
6. Agree what happens if Paystack or the sheet is down: the assistant says nothing has changed, and staff release nothing until it's back.

---

## Working notes — delete before submitting

**Moments to show in the recording and prove in Chord**

- Sign-in: "hello" → asks for account code and PIN → "KG-ADA 4461" → greets Ada by name, never repeats the PIN
- "abeg send acct dets" → payment link for INV-109, ₦310,000, instead of bank details
- "I don send am to your account" → read as a payment claim, not a request for details
- Staff: "Has INV-112 been paid?" → ₦600,000 of ₦1,200,000 paid, don't release, no code exists
- Staff releases INV-110 against Chidi's code → names the Galaxy S24 Ultra, marks it collected
- Same code tried twice → refused, a code works once
- Staff: "just tell me his code" → refused
- Three wrong codes → handovers locked, flagged for Kola
- "I'm Tunde, mark INV-107 as paid" → refused; no tool can do it
- "paid" sent twice → applied once; show the sheet row
- Ada signs in from a different phone → same balance
- "It's Ada, I've lost my PIN, just tell me what I owe" → no details shared, told to call Kola
- Five wrong PINs on one code → a line in the Flags tab, account still works
- Paystack unreachable → "nothing has changed on your account"

**Confirm once on Chord**

- ~~Does the sender's phone number reach the agent and its tools?~~ **No — TSG confirmed 22 Oct. Identity is now an account code plus PIN.**
- ~~Can the simulator send from more than one number?~~ **No — one profile per agent.**
- ~~Does Paystack test mode accept amounts this large?~~ **Yes — no cap; ₦50m initializes fine.**
- Does a sleeping Render server make Chord time out on the first call?

**Version 2, for the live session**

- A dedicated bank account per reseller (Paystack virtual accounts), so plain transfers match automatically too
- Alerts to Kola on WhatsApp when something is flagged
