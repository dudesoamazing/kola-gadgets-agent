# Deployment field notes

Three problems that shaped the build, then shorter findings ranked by impact. All times stated are Lagos time (WAT).

## 1. The agent's replies didn't match what its tools did

**What happened.** Twice on 28 Oct, Ada asked for a payment link for her AirPods, then said she had paid. Both times the agent replied with a confirmation and a pickup code:

> "Payment confirmed, INV-109 is now fully paid. Your pickup code is PEPPER-BISON." (05:56)
> "Payment confirmed... Your pickup code is MANGO-TIGER." (10:39)

Neither was true. The server log shows `create_payment_link`, then nothing until the next sign-in. `verify_payment` never ran. The Sheet still showed the payment as pending, the invoice unpaid and no code issued.

On 29 Oct the same pattern showed up at sign-in, in three different shapes:
- **It made up its own rules.** After two wrong PINs it refused to pass more attempts to the server ("I can't try any more PINs in this chat"), then accepted "last one, try this" and signed Ada in. It also offered to notify Kola, which it can't do before sign-in.
- **It skipped the tool.** It told Ada four PINs didn't match without calling `identify`, then admitted it: "I told you they didn't match without actually running them through the system."
- **It ignored the result.** With every attempt reaching the server, the fifth wrong PIN locked the account and the tool said so. The agent replied "1 more wrong try will lock the account", repeating its previous wording.

**Why it matters.** For Kola, a false "payment confirmed" is the worst message the agent can send: a reseller told she has paid sends her rider to the shop. At sign-in, a false "doesn't match" makes a reseller doubt a PIN that may be right. Nothing left the shop only because release and locking happen on the server: when Tunde entered each invented code, `record_handover` checked the ledger and refused it.

**How I found the cause.** Chord's conversation view only shows text so every one of these looked like a normal reply. I added one log line per tool call and compared it with the Sheet and the chat. The MANGO-TIGER code was the clearest clue. I had removed it from the skill files but it was still in `record_handover`'s parameter description as an example. Tool descriptions are sent to the model on every turn so when it skipped the tool it copied the example.

**Fix.** Each incident moved a decision from the model to the server:
- No example values in tool descriptions, with a smoke test that fails if one comes back.
- A rule at the top of the skill: never state a confirmation, code or mismatch unless a tool returned it in this turn.
- The server counts PIN attempts and locks the account; the model only relays.
- Sign-in replies come from the server as exact text the agent sends as written.

**What Chord should change.** Show the tool calls under each reply in the conversation view, for example a small "verify_payment ✓" chip or "no tools called". An operator would spot a confirmation with nothing behind it in seconds; it took me server logs and a spreadsheet each time. And say in the tool docs that descriptions are part of the prompt so example values can be copied.

## 2. Tool results don't carry over between turns so the agent lost the payment reference

**What happened.** On 27 Oct at 19:26, the agent created a link for ₦4,360,000. I paid it and Paystack emailed a success receipt. When I sent "I don run am", the agent replied: "I need the payment reference to check and I don't have it." It then checked the invoices and told Ada no payment showed, while the money sat confirmed in Paystack.

**Why it matters.** "Send a link now, confirm later" is the core of every payment conversation. If the agent forgets what it created one message ago, the reseller who did everything right is told she hasn't paid.

**How I found the cause.** `create_payment_link` returned the reference but the agent's reply only showed the URL. By the next turn, the reference was gone and the agent said so itself. My reading is that Chord keeps the visible messages but not the tool results. It probably also explains note 1: a model that can't see what its tools said earlier is more likely to fill the gap.

**Fix.** `verify_payment` no longer needs a reference. The server looks up the signed-in account's pending payments and checks each with Paystack. The state lives in the ledger, not in the chat. Every payment test since has confirmed correctly without a reference.

**What Chord should change.** Keep tool results in the model's context across turns or say clearly in the docs that they're dropped and show the pattern for multi-step flows (create now, confirm later).

## 3. No sender identity so people sign in with a code and PIN in the chat

**What happened.** The agent serves three roles. Resellers see only their own invoices, staff release goods and nobody but Paystack can mark an invoice paid. I built the first version on phone numbers, because the docs didn't say whether the sender's number reaches the tools. On 22 Oct, TSG confirmed it doesn't: Chord passes no number and no contact ID to the agent or its tools. I rebuilt identity around it.

**Why it matters.** At Kola's counter, "who is this?" sits behind every release. Without a sender identity, the agent can't tell Ada from someone that's holding her phone or from a stranger who just types "it's Ada".

**How I found the cause.** The skills, MCP and "build a teammate" docs didn't say what a tool receives about the sender. I asked TSG on 20 Oct and built on phone numbers while I waited. Their reply on 22 Oct confirmed tools receive nothing about the sender. I then removed phone identity and rebuilt around a code and PIN.

**Fix.** Kola gives each person an account code and a 4-digit PIN and the server checks both on every tool call. Three decisions worth noting:
- An unknown code and a wrong PIN get the same reply so the agent can't be used to find real account codes.
- Five wrong PINs lock the account and flag Kola. A 4-digit PIN is only 10,000 guesses so resisting brute force matters more than the risk that someone locks a reseller out on purpose, which Kola would see in the Flags tab. Only the right PIN is told the account is locked so the lock doesn't reveal which codes exist.
- No real PIN appears in the skill. My first draft of the examples had a working code and PIN in it, which would have put a live credential in the model's context.

**What it costs.** The PIN is typed into the chat so it sits in WhatsApp history, in Chord and in the model's context. The simulator's "customer name" field doesn't help: it's self-declared and the agent greeted me by it before I'd signed in.

**What Chord should change.** Pass a verified sender identifier (the WhatsApp number or a stable hashed contact ID) to tools so accounts can be tied to a sender and the PIN becomes a second factor. Until then, the docs should list what a tool call receives about the sender, with an example payload. They don't say and I only learned that tools receive nothing about the sender by emailing TSG.

## More findings, ranked by impact

**4. A sleeping server looks like a broken agent.** Render's free tier sleeps after 15 idle minutes. On 25 Oct, the first "show tools" failed as `gateway request failed 500` and a retry worked. On 27 Oct at 17:56, a message to the sleeping server ended with the chat escalated to a human: the simulator said only "The agent didn't answer" and the Activity log credited the escalation to "You", with an unknown ID and no reason. A real reseller would just keep resending. *Chord should:* say "your MCP server didn't respond in N seconds" instead of a generic 500, record who or what escalated a chat and why and tell the customer a person now has the conversation.

**5. Markdown goes to WhatsApp unchanged.** Bold arrived as `**INV-104**` and a Markdown link arrives as text that can't be tapped. For a payments agent, a link that can't be tapped is a sale that doesn't happen. I fixed it in the skill. *Chord should:* convert Markdown to WhatsApp formatting or say in the skill docs that replies are sent as written.

**6. Credits were invisible until day four.** TSG added credits on 22 Oct but I couldn't see them until 27 Oct, when TSG pointed me to my tenant. Meanwhile everything looked healthy until I tried to send a message. Later, the header still showed 50 after 0.47 credits were used. *Chord should:* show the tenant and balance clearly, say on the teammate page why it can't run and show decimals.

**7. Skill files don't sync from the repo.** Chord keeps a copy from upload so every change has to be pasted in by hand, file by file. Twice I wasn't sure which version the agent was running. In-place editing is a nice touch though. *Chord should:* allow sync from GitHub or offer a CLI tool for pushing updates.

**8. "Instructions" and "Make instructions" aren't explained.** One click on the wrong file silently swaps the agent's main prompt. *Chord should:* add a tooltip explaining the difference and a confirmation step.

**9. Google's own Sheets MCP server can't be connected.** It needs a pre-registered OAuth client ID and Chord has no field for one. Building my own server turned out better: it exposes business actions only so the model can't write to any cell it likes. *Chord should:* accept a client ID and secret.

**10. Custom tools are MCP-only and the docs don't say so up front.** *Chord should:* state it on the tools page, with a minimal server template.

**11. The MCP SDK replies with SSE by default.** Chord accepts JSON or SSE but doesn't say which it prefers. *Chord should:* show recommendations.

**12. Dark-mode send button.** When active, the button turns white but the arrow stays white so it disappears. *Chord should:* make the arrow dark on the active state.

## What I'd build next

What stopped me is in the notes above. With more time I'd build these, in this order:

1. **Paystack webhooks.** The server learns a payment succeeded the moment it happens. The ledger updates even if the reseller never types "sent". It takes the model out of the most important step, the root of note 1.
2. **Payment reminders on credit**, polite and timed around due dates. I left these out of the first version on purpose. They're the clearest growth lever. I'd measure them on three numbers: the share of payment links paid, the days it takes to collect on credit and the number of payments left unmatched.
3. **An owner "confirm transfer" tool.** Kola's resellers will keep sending bank transfers. Today he can't turn a confirmed transfer into a pickup code. One message from him should do it.
4. **WhatsApp alerts to Kola** for locked accounts, disputes, large payments and unconfirmed transfers, instead of lines waiting in the Flags tab.
5. **Owner account tools:** add a reseller, reset a PIN and unlock an account, with PINs stored hashed. Kola should never edit the Sheet by hand or need a developer.
6. **Sign-in by WhatsApp number** once Chord passes a sender ID. The PIN then becomes a one-time step.
7. **A staff "due for pickup today" list** showing items but never codes. Unused pickup codes would also expire.
8. **Production hardening:** a database instead of the Sheet, locks that survive restarts and an always-on server.
