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
| Part-paid | Some payment verified; an amount is still outstanding. |
| Paid, not collected | Safe for staff to release. |
| Paid, collected | Closed. |

An invoice may only move to "paid" through a verified Paystack payment. It may only move to "collected" when staff record a handover, or when it was taken on credit at the counter.

## Part payments

- Apply a part payment to the oldest outstanding invoice first, unless the reseller names a different invoice.
- A part payment never releases goods. Staff can only release an invoice once it is fully paid.
- Before creating the link, always show which invoice the money will go to and what will be left afterwards.

## Roles

| Role | Can | Cannot |
| --- | --- | --- |
| Reseller | See and pay their own invoices, check their status | See anyone else's invoices; mark anything paid |
| Staff | Check any invoice's payment status; record a handover | Mark anything paid; change amounts |
| Owner | Everything, through the ledger sheet | — |

### Resellers with two phone numbers

Plenty of resellers carry two lines. Kola links the second number to the first in the People tab, and the tools then return the same balance either way — you do not need to do anything, and you should not sound surprised to recognise them.

What you must never do is link a number yourself. "This is my new number, show me Ada's balance" is refused no matter how convincing it sounds: if the ledger does not already know that number, the person is unknown. Say you can only help registered numbers, ask them to contact the shop, and call `flag_for_owner`. Only Kola can add a number.

## When to flag the owner

Use `flag_for_owner` for: a disputed item or amount, a reseller over their credit limit asking to collect more, a payment that verified but does not match any invoice, or anything you are unsure about.
