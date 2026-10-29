# Problem statement

**Roles:** Product Management first, Technical Product Management second.

Kola Gadgets is a phone and laptop supplier in Computer Village, Lagos, whose resellers pick up stock on credit or pay ahead and collect later, often in split payments across their own customers. Transfers arrive without references and only the owner can see his bank account so payments go unmatched, resellers get chased for items they've already paid for and staff can't confirm a payment before handing over stock when he's unreachable. The agent sits on the shop's WhatsApp line and ties every payment to specific invoices through a Paystack link, verifies it with Paystack itself and lets staff check payment status before release, without anyone needing access to the owner's bank account.

It's worth paying for because the errors it prevents are large and routine: one ₦2.4m transfer that can't be matched to a pickup or one laptop released against a payment that never cleared, costs more than a year of the agent. The shop's current control is the owner's attention and he's the scarcest thing in it.

I deliberately left out matching plain bank transfers, logging new pickups, resolving disputes beyond flagging them for the owner and automatic payment reminders. Each one either needs bank-feed access the shop doesn't have or would put the agent in the middle of a conversation that should stay between Kola and his resellers.

I've lived this problem from the other side: I was the reseller being chased for a phone I'd already paid for.
