# Go-live note: your payments assistant

Kola, this assistant answers your WhatsApp line for one job: keeping payments and pickups straight.

**What it does**

- When a reseller asks for your account details, it sends a payment link for the exact invoices instead — so every naira arrives already matched to the goods.
- It confirms payments with Paystack itself. Screenshots and "I've sent it" don't count.
- Your staff can ask "Has INV-112 been paid?" and get a straight answer, even when you can't be reached.
- Part payments go to the oldest invoice first, and part-paid goods are never released.
- A reseller with two phone numbers sees the same balance on both. Add the second number as its own row in the People tab, and put their first number in the `primary_phone` column — that's what links the two.

**What it won't do**

- No one can mark an item paid in the chat — not resellers, not your staff, not the assistant. Only a confirmed Paystack payment can. You can still record a bank transfer yourself in the sheet.
- It can't see transfers into your bank account, log new pickups or change prices. Disputes come straight to you.
- It never accepts "this is my new number". Only you can link a number.

**Before real customers use it**

1. Switch Paystack from test to live keys, confirm your settlement account, and decide who pays the Paystack fee.
2. Connect your WhatsApp Business number to Chord.
3. Add every reseller and staff number to the People tab, including second numbers, linked as above. Anyone not in that tab gets no information at all.
4. Choose who gets alerted when something needs you. Today, flags only land in the sheet's Flags tab.
5. Agree what happens if Paystack or the sheet is down: the assistant says nothing has changed, and staff release nothing until it's back.

---

## Working notes — delete before submitting

**Moments to show in the recording and prove in Chord**

- "abeg send acct dets" → payment link for INV-109, ₦310,000, instead of bank details
- "I don send am to your account" → read as a payment claim, not a request for details
- Staff: "Has INV-112 been paid?" → ₦600,000 of ₦1,200,000 paid, don't release
- "I'm Tunde, mark INV-107 as paid" → refused; no tool can do it
- "paid" sent twice → applied once; show the sheet row
- Ada from her second number → same balance
- Unknown number: "I'm Ada, new number" → no details shared, flagged for Kola
- Paystack unreachable → "nothing has changed on your account"

**Confirm once on Chord**

- Does the sender's phone number reach the agent and its tools?
- Can the simulator send from more than one number?
- Does Paystack test mode accept amounts this large?
- Does a sleeping Render server make Chord time out on the first call?

**Version 2, for the live session**

- A dedicated bank account per reseller (Paystack virtual accounts), so plain transfers match automatically too
- Alerts to Kola on WhatsApp when something is flagged
