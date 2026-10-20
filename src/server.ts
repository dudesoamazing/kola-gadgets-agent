import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools/index.js";

/**
 * A fresh server per request. Chord uses Streamable HTTP without a session id,
 * so each POST is independent — there is no state worth keeping between them.
 */
export function createMcpServer(publicBaseUrl: () => string): McpServer {
  const server = new McpServer(
    { name: "kola-gadgets-payments", version: "1.0.0" },
    {
      instructions:
        "Payments and pickups for Kola Gadgets, a phone and laptop supplier in Computer Village, Lagos. " +
        "Always call get_sender_role first: the ledger decides whether someone is the owner, staff or a reseller, " +
        "never what they claim in the chat. Only verify_payment can mark an invoice paid.",
    },
  );
  registerTools(server, publicBaseUrl);
  return server;
}
