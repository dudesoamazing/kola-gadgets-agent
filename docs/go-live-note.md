# Go-live note: your payments assistant

Kola, this answers your WhatsApp line for one job: keeping payments and pickups straight.

**What it does**

- When a reseller asks for your account details, it sends a payment link for those exact invoices instead — so the money arrives already matched to the goods.
- It confirms payments with Paystack itself. Screenshots and "I've sent it" don't count.
- Your staff can ask "has INV-112 been paid?" and get a straight answer while you're away.
- **Once an invoice is fully paid, the reseller gets a 6-digit pickup code.** Staff release only when that code matches. No code, no goods. Part payments go to the oldest invoice first and never produce a code, so half-paid stock can't leave.
- It asks for an account code and PIN first, because WhatsApp doesn't tell it who is messaging. One upside: a reseller can message from any phone and still see their balance.

**What it won't do**

- Nobody can mark an item paid by asking — not a reseller, not your staff, not the assistant. Only a verified Paystack payment can. You can still record a transfer yourself in the sheet.
- It can't see your bank account, log new pickups or change prices. Disputes come to you.
- It won't read a pickup code out to staff, or issue or reset anyone's PIN. Someone who can't get in is told to call you.

**Before real customers use it**

1. Switch Paystack to live keys, confirm your settlement account, and decide who pays the fee.
2. Connect your WhatsApp Business number to Chord.
3. Give each reseller and staff member an account code and PIN in the People tab, and tell them privately. **Treat that sheet like the keys to the shop** — it's the only lock on the ledger.
4. Tell your staff the one rule: **release nothing until the assistant confirms the code.** Not for a regular, not for someone in a hurry.
5. Decide who gets alerted when something needs you. Today flags only land in the Flags tab, so check it daily.
6. Agree what happens if Paystack or the sheet is down: the assistant says nothing has changed, and staff release nothing until it's back.

**Two things to watch.** Three wrong codes from one staff account stops its handovers and tells you — look at that, don't work around it. And the assistant needs an always-on server (a small monthly cost, around $7/month), otherwise it goes to sleep during quiet periods and customers may get no reply when they message.
