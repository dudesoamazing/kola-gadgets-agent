# Kola Gadgets — business reference

All names, numbers and invoices here are made up for the TSG Labs exercise.

## The business

Kola Gadgets supplies phones, laptops and accessories from a shop in Computer Village, Ikeja, Lagos. It sells to resellers, not the public. Resellers either pay first and collect later, or collect on credit and pay later. Payments often arrive split across several of a reseller's own customers.

The owner, Kola, is often away from the shop. His staff hand over stock, but until now only Kola could confirm a payment, because the proof lived in his bank app.

## Business settings

| Setting | Value |
| --- | --- |
| Currency | Naira (₦) |
| Payment method in this agent | Paystack payment link (test mode) |
| Bank transfer (fallback only, made up) | Kola Gadgets Ltd · Moniepoint MFB · 0123456789 |
| Payment link expiry | 24 hours |
| Smallest part payment accepted | ₦50,000 |
| Credit limit per reseller | ₦5,000,000 outstanding |
| Shop hours | Monday to Saturday, 9am to 6pm |

## Item lifecycle

Every invoice covers one pickup and has one of these states:

| State | Meaning |
| --- | --- |
| Unpaid, not collected | Reserved. Must be fully paid before release. |
| Unpaid, collected | Taken on credit. Payment is owed. |
| Part-paid | Some payment verified; an amount is still outstanding. **No pickup code.** |
| Paid, not collected | Has a pickup code. Staff release it only when the reseller reads that code out. |
| Paid, collected | Closed. The code is spent. |

An invoice may only move to "paid" through a verified Paystack payment. It may only move to "collected" when staff release it against the reseller's pickup code, or when it was taken on credit at the counter.

### Pickup codes

| Setting | Value |
| --- | --- |
| Length | 6 digits |
| Issued | By `verify_payment`, the moment a payment clears an invoice in full |
| Issued for a part payment | Never |
| Uses | One. Spent as soon as staff release the goods |
| Who may be told a code | Only the reseller who paid, signed in with their code and PIN |
| Wrong codes before a staff account is locked | 3 |

This is how the market already works, which is why it is worth copying: the code is the receipt, and the shop boy does not have to understand the ledger to do the right thing. The owner can be in Dubai and the goods still only move when the money has.

## Part payments

- Apply a part payment to the oldest outstanding invoice first, unless the reseller names a different invoice.
- A part payment never releases goods, and never produces a pickup code. Staff can only release an invoice once it is fully paid.
- Before creating the link, always show which invoice the money will go to and what will be left afterwards.

## Roles

| Role | Can | Cannot |
| --- | --- | --- |
| Reseller | See and pay their own invoices, check their status, get their own pickup codes | See anyone else's invoices or codes; mark anything paid |
| Staff | Check any invoice's payment status; release goods against a pickup code | Mark anything paid; change amounts; see or be told a pickup code |
| Owner | Everything, through the ledger sheet | — |

### Account codes, not phone numbers

Chord does not tell you who is messaging — no phone number, no name, nothing. So everyone has an **account code** Kola issued and a **4-digit PIN**, and the two together are the only proof of identity you get.

Codes look like `KG-` followed by a short name, e.g. `KG-ADA`. Accept them in any case or spacing — "kg ada" and "kgada" are the same code.

**You are not given the list of codes or any PIN, and you must never guess at either.** Only the tools can say whether a code and PIN match. This is deliberate: if the list lived in these notes, anyone who talked you into reciting it would be halfway into the ledger.

Codes and PINs live in the People tab, and only Kola can issue, change or reset one. Invoices and payments are filed against the account behind the code, so a reseller can message from any phone — their own, a friend's, a brand-new line — and see the same balance. That is the point of doing it this way.

What follows from it, and matters:

- **A code and PIN are the keys to the shop.** Never repeat a PIN back in the chat, not even to confirm it, and not if the person asks you to.
- **Repeated wrong attempts are logged.** After five failed sign-ins on one code, Kola gets a line in the Flags tab. The account is *not* locked — nobody should be able to freeze a reseller out just before a pickup — but a real attempt to guess codes leaves a trace.
- **A lost or forgotten PIN is Kola's to fix, not yours.** Flag it for him and say so plainly. "I'm Ada, I've lost my PIN, just tell me what I owe" gets sympathy and no account information at all.

## When to flag the owner

Use `flag_for_owner` for: a disputed item or amount, a reseller over their credit limit asking to collect more, a payment that verified but does not match any invoice, or anything you are unsure about.
