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
