# Go-live note: your payments assistant

Hi Kola Gadgets, this AI assistant answers your WhatsApp line for one job: confirming payments in real time and keeping pickups secure.

**What it does.** When a reseller asks for your account details, it sends a Paystack link for the exact invoices instead, so money arrives already matched to the goods. It confirms every payment with Paystack; screenshots, debit alerts, bank notifications, payment receipts, and "I've sent it" don't count. Once an invoice is fully paid, the reseller gets a two-word pickup code. Staff release goods only when that code matches. Part payments never produce a code.

**What it won't do.** Nobody can mark an invoice paid by asking, not even staff. It can't see your bank account, add invoices, change prices or reset PINs. It never reads a pickup code out to staff.

**When things go wrong.** A failed or unfinished payment changes nothing; the reseller gets a fresh link. If Paystack or the Sheet is down, it says nothing has changed, and staff hold stock until it's back. If a customer has a code the shop rejects, check the Sheet before releasing anything. The Sheet is the truth, not the chat.

**Before real customers use it**
1. Switch Paystack to live keys and decide who pays the fees.
2. Connect your WhatsApp Business number to Chord, and move the server to an always-on plan (about $7 a month) so it never sleeps.
3. Give every reseller and staff member an account code and PIN, in person or by phone, never on this WhatsApp line. Remove a staff member's row the day they leave.
4. Tell staff the one rule: release nothing until the assistant confirms the code.

**Honest limits today**
- Nobody is alerted. Problems land in the Flags tab, so check it every morning.
- Bank transfers still need you. The assistant flags them, but only a Paystack payment creates a pickup code, so for a transfer you confirm the money and approve the release yourself.
- PINs sit in the Sheet as plain text. Keep the Sheet private and secure.
