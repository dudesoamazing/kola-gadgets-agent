# Draft email to TSG — blocked on credits and simulator access

Send to Emmanuel / support@tsglabs.com. Keep the subject line specific so it
doesn't read as a status update.

---

**Subject: Blocked on simulator access + credits — Kola Gadgets agent, everything else is live**

Hi Emmanuel,

Quick flag, per the brief's note about telling you straight away if something on your side blocks me.

I've registered my MCP server in Chord and the Tools panel reads it fine — "show tools" returns all eight tools over Streamable HTTP with bearer auth. But I have **no credits on the account and no access to the WhatsApp simulator**, so I can't actually run a conversation through the teammate.

Everything either side of Chord is already built and proven end to end:

- MCP server live on public HTTPS: `https://kola-gadgets-mcp.onrender.com/mcp` (health at `/health`)
- Real Paystack test mode, both directions — a link created by the agent, opened in a browser, paid with a test card, then verified and applied to the right invoice
- Google Sheet ledger writing back: invoice marked paid, pickup code issued, stock released against it
- 110 assertions covering the tool paths, including the ones that must fail

The only thing I can't demonstrate is the conversation itself inside Chord.

Could you add the credits and simulator access to this account? It's the email on this message.

If it can't happen before my deadline (Tue 27th, ~13:30), I'll submit with the agent registered and the tools working, plus a recording driving the same tools directly, and I'll say plainly in the field notes what was blocked and what I'd have shown. I'd rather do the real thing, though.

One thing that might be useful to you either way: the first "show tools" after registering returned `gateway request failed 500`, and an immediate retry worked — my server was cold on a free tier. The error message is identical whether the MCP server 500s, times out, refuses the connection, or is simply asleep, which sent me debugging a server that was fine. Surfacing the upstream status, or retrying first contact with a longer timeout, would save the next person that hour.

Thanks,
Marvin

---

## Notes for me

- Send it tonight, not Monday morning. A Sunday-evening email that gets read first thing is worth more than a perfect one sent at 9am.
- Don't bury the ask. The subject line and the second paragraph both say what's needed.
- The cold-start observation is deliberately included: it's useful to them, it shows the work is real, and it makes the email worth reading rather than just a request.
