# Go-live note: your payments assistant

Kola, this answers your WhatsApp line for one job: keeping payments and pickups straight.

**What it does**

- When a reseller asks for your account details, it sends a payment link for those exact invoices instead — so money arrives matched to the goods.
- It confirms payments directly with Paystack. Screenshots and "I've sent it" do not count.
- Your staff can ask "has INV-112 been paid?" and get a straight answer while you're away.
- **Once an invoice is fully paid, the reseller gets a two-word pickup code.** Staff release goods only when that code matches. No code, no goods. Part payments go to the oldest invoice first and never produce a code, so half-paid stock cannot leave.
- It asks for an account code and PIN first, because WhatsApp does not tell it who is messaging.

**What it won't do**

- Nobody can mark an item paid by asking — not a reseller, not staff, not the assistant. Only a verified Paystack payment can.
- It cannot see your bank account, log new pickups, change prices, or reset PINs. Disputes come to you.
- It never reads a pickup code out to staff.

**Managing identity and PINs**

- Each reseller and staff member gets an **account code** (not secret, like a username) and a **PIN** (secret, like a password) in the People tab.
- **Give PINs out of band:** in person at the shop, or by phone call or SMS. Never over the assistant's WhatsApp line.
- **Forgotten PIN:** the person contacts you directly. Once you confirm it is them, issue a new PIN in the Sheet. The assistant cannot reset PINs.
- **Staff departures:** when a staff member leaves, remove their row from the People tab the same day so they cannot release stock.
- **Riders and customers:** dispatch riders and end-buyers need no account. They only need the pickup code the reseller forwards to them.
- **Keep the Sheet private:** do not share its link, and never give staff access to the People tab.

**Before real customers use it**

1. Switch Paystack to live keys, confirm your settlement account, and decide who covers transaction fees.
2. Connect your WhatsApp Business number to Chord.
3. Add your people in the People tab and share their credentials privately.
4. Tell your staff the golden rule: **release nothing until the assistant confirms the code.** Not for regulars, not for anyone in a hurry.
5. Check the Flags tab daily for anything that needs your decision.
6. If Paystack or the Sheet is temporarily down, the assistant reports no balance change; staff hold stock until it is back.

**Two things to watch.** Three wrong pickup codes locks that staff member's account and flags you. Stock is only released when the server confirms a code; if a customer claims a code the shop rejects, check the Sheet. And keep the tool server on an always-on host ($7/month) so it never sleeps between messages.
