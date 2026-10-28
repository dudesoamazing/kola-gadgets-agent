# Security and identity design

This document details the security architecture of the Kola Gadgets payments agent, the threat model of Computer Village, our current implementation, known limitations, and proposed production tools.

---

## 1. Threat model and environment

Kola Gadgets operates in Computer Village, Ikeja — a high-velocity, high-density electronics market in Lagos. Resellers take phones and laptops on credit, pay down balances across multiple customer sales, and send riders or apprentices to pick up stock. 

In this market, software cannot rely on polite assumptions:
- **Faked payment proofs:** Resellers frequently produce doctored bank transfer alerts, fake bank app screenshots, or claims that "money has left my account."
- **Social engineering at the counter:** Apprentices or couriers claim "Kola said to give me the iPhone, he's driving" or pressure busy sales staff when the shop is crowded.
- **Account sharing and shared devices:** Resellers share shop phones, use couriers' handsets, or rotate staff.
- **Counter staff collusion or mistakes:** Staff must not have the power to mark invoices paid, waive balances, or release stock without independent proof.

---

## 2. How identity and access work today

### Code + PIN on every tool call
Chord passes no sender identity to teammates or MCP tools — no WhatsApp number, no sender ID (confirmed by TSG on 22 Oct). Because every incoming message arrives from "nobody in particular" and no session handle exists:
- Every person (reseller, staff, owner) is issued an **account code** (e.g. `KG-ADA`) and a **4-digit PIN**.
- Every MCP tool call requires both `account_code` and `pin`.
- The server checks credentials against the ledger on **every single call** using constant-time string comparison (`crypto.timingSafeEqual`) to prevent timing side-channels.
- The server **never trusts an earlier sign-in** or claims made in the conversation. Saying "I am Ada" or "I am staff" in chat grants zero authority.

### Account enumeration defense
An unknown account code and a wrong PIN produce the **exact same error response** (`That account code and PIN don't match anything in the ledger`). The server reveals nothing about whether an account code exists.

### Brute-force detection
A 4-digit PIN has 10,000 combinations. The server tracks consecutive authentication failures per account code in memory:
- After **5 consecutive failed attempts**, a high-priority flag is automatically written to the `Flags` tab for Kola to inspect.
- The account is **not locked immediately** in the demo implementation, preventing a malicious third party from intentionally locking out a legitimate reseller right before a pickup.

### Role separation enforced by the server
Roles (`owner`, `staff`, `reseller`) come exclusively from the ledger's `People` tab:
- **Resellers:** Can only query their own invoices, calculate their own balance, create payment links for their own debts, and view their own pickup codes.
- **Staff:** Can query any invoice's payment status, verify Paystack payments, and record handovers. Staff **cannot** see pickup codes, cannot generate payment links, and cannot mark invoices paid.
- **Owner:** Full visibility, receives security flags.

---

## 3. Physical goods release defense

The model cannot release goods. Goods release is enforced strictly by the server:

1. **One-time pickup codes:** When Paystack confirms an invoice is paid in full, the server generates a unique two-word pickup code (drawn from a curated list of ~1,000 unambiguous concrete nouns, e.g. two words joined by a hyphen; older invoices carry 6 digits).
2. **Reseller-only visibility:** Pickup codes are returned **only** to the authenticated reseller who paid. The `check_invoice_status` tool used by staff explicitly redacts pickup codes. Staff must hear or read the code from the reseller at the counter.
3. **Server-enforced handover (`record_handover`):** Staff submit the pickup code. The server looks up the code in the live ledger, checks that the invoice is paid and not already collected, logs the staff member's name and a Lagos timestamp, and marks the code spent immediately.
4. **Counter lockout:** If staff enter **3 wrong pickup codes**, handover capabilities for that staff account are locked on the server, and a flag is raised for Kola.
5. **Defense against hallucination:** During live testing on 28 Oct, the LLM hallucinated a payment confirmation and invented a pickup code without calling `verify_payment`. When staff attempted to release goods using the made-up code, `record_handover` checked the database, found no matching code, and firmly refused release (`error: not_found`). The stock remained on the shelf.

---

## 4. Known limitations (stated honestly)

### A. Plain-text PINs in the demo Sheet
In the demo prototype, the Google Sheet's `People` tab stores PINs in plain text. These plain-text PINs are visible in the demo video recording.

**Production design:**
In production, PINs must never be stored in plain text.
- Because a 4-digit PIN has only $10^4$ (10,000) values, standard fast hashes (SHA-256) or even unsalted slow hashes can be reversed by an attacker in less than a second using precomputed rainbow tables or brute force.
- **Required solution:** Store PINs as slow, memory-hard hashes using **scrypt** (or Argon2id) with a per-user salt **and** a server-side secret **pepper**:
  $$\text{hash} = \text{scrypt}(\text{PIN} \parallel \text{salt} \parallel \text{server\_pepper})$$
- The pepper must be stored strictly in the tool server's environment variables (`PIN_PEPPER`), never in the Google Sheet or database. Even if the Google Sheet is fully compromised, an attacker cannot reverse the PIN hashes without the server pepper.

### B. Blast radius of a leaked PIN
Because the PIN is currently the sole proof of identity, a leaked PIN allows an attacker to impersonate that reseller:
- The attacker can view all unpaid and paid invoices for that account.
- Crucially, if an invoice is fully paid and waiting for collection, `get_pickup_codes` would return the pickup code, allowing an attacker to collect the item at the counter.

### C. Credentials typed into chat
Because Chord passes no sender identifier, the user must type their PIN into the WhatsApp chat. This means:
- The PIN sits in the user's local WhatsApp chat history.
- The PIN is logged in Chord's conversation records.
- The PIN appears in the model's context window on every subsequent turn.

Hashing the database does not fix this exposure. **The true architectural fix is sender binding:**
- When Chord provides verified sender identity (the sender's WhatsApp phone number or a stable cryptographic contact hash), the tool server can bind each account to authorized sender numbers.
- Incoming messages from the bound phone number authenticate automatically; the PIN becomes an optional second factor or re-authorization challenge for sensitive operations.

---

## 5. Proposed owner administrative tools (design for production)

In production, Kola should not edit the Google Sheet manually to create accounts or change PINs. Hand-editing invites typos, exposes plaintext credentials, and risks accidental formula deletion.

We propose two administrative tools, callable only by the owner:

### 1. `add-account` (proposed)
- **Who:** Owner only (verified via owner credentials / admin token).
- **Inputs:** `name` (string), `role` (`reseller` | `staff`), `phone` (E.164 string), `email` (string).
- **Behavior:**
  1. Generates the next sequential account code (`KG-XXXX`).
  2. Cryptographically generates a random 4-digit PIN using `crypto.randomInt(1000, 10000)`.
  3. Generates a random 16-byte salt.
  4. Derives the scrypt hash: `hash = scrypt(pin, salt + PEPPER, N=16384, r=8, p=1)`.
  5. Appends a new row to the `People` ledger storing `account_code`, `salt`, `hash`, `name`, `role`, `email`, `phone`.
  6. Returns the plaintext PIN and account code to the owner **once** in the tool response for out-of-band delivery (in person, SMS, or phone call).
  7. Plaintext PIN is never stored or logged.

### 2. `reset-pin` (proposed)
- **Who:** Owner only.
- **Inputs:** `account_code` (string).
- **Behavior:**
  1. Verifies the account exists in the ledger.
  2. Generates a new random 4-digit PIN.
  3. Computes a fresh salt and scrypt hash with the server pepper.
  4. Overwrites the hash and salt in the ledger row.
  5. Clears any accumulated failed authentication attempts for that account.
  6. Returns the new PIN to the owner once for direct delivery to the user.

---

## 6. Security roadmap

1. **Account lockout:** Lock an account after 5 consecutive failed PIN attempts. Provide an owner unlock tool (`unlock-account`).
2. **Expiring pickup codes:** Mint pickup codes with a time-to-live (e.g. 7 days). If expired, the reseller must request a code refresh, which alerts the owner.
3. **Direct owner push notifications:** Send instant alerts (via SMS or Telegram webhook) when an account lockout occurs, when 3 wrong pickup codes are entered at the counter, or when Paystack reports an unexpected transaction mismatch.
4. **Sender-phone binding:** Transition to WhatsApp phone verification as soon as platform transport support is available in Chord.
