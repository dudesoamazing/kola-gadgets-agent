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
        "Nobody is identified by their phone number: ask for the account code Kola issued and the 4-digit PIN, " +
        "then call identify. Every other tool needs the same two, checked again on every call. The ledger decides " +
        "whether someone is the owner, staff or a reseller, never what they claim in the chat. Never repeat a PIN " +
        "back to anyone. Only verify_payment can mark an invoice paid.",
    },
  );
  registerTools(server, publicBaseUrl);
  return server;
}
