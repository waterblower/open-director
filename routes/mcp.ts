/**
 * MCP endpoint (Streamable-HTTP compatible) served from the Fresh process.
 *
 * Point an MCP client at `http://localhost:<port>/mcp`:
 *   Claude Code:  claude mcp add --transport http open-director http://localhost:8000/mcp
 *   Codex:        [mcp_servers.open-director] url = "http://localhost:8000/mcp"
 *
 * Stateless: each POST carries a self-contained JSON-RPC message (or batch)
 * and gets a JSON response. We don't push server-initiated messages, so GET
 * (the optional SSE channel) returns 405.
 */
import { define } from "../utils.ts";
import { handleMcpPayload } from "../mcp/server.ts";

export const handler = define.handlers({
    POST: async (ctx) => {
        let payload: unknown;
        try {
            payload = await ctx.req.json();
        } catch {
            return Response.json(
                {
                    jsonrpc: "2.0",
                    id: null,
                    error: { code: -32700, message: "Parse error" },
                },
                { status: 400 },
            );
        }

        const result = await handleMcpPayload(payload);
        // Notification-only payloads get an empty 202 (no JSON-RPC response).
        if (result == null) {
            return new Response(null, { status: 202 });
        }
        return Response.json(result);
    },

    GET: () => new Response("Method Not Allowed", { status: 405 }),
});
