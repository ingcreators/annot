// Stdio transport wiring. The bin shim (`bin/annot-mcp.mjs`)
// imports `runStdioServer` and invokes it; the server reads
// JSON-RPC requests from stdin and writes responses to stdout.
//
// Errors during transport setup propagate to the bin shim, which
// lets Node's default unhandled-rejection handler print the stack
// and exit non-zero — this is the right surface for an MCP client
// that spawned us, since the client sees the spawn failure in
// its logs.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./server.js";

/**
 * Boot the Annot MCP server over stdio. Resolves when the
 * transport closes (client disconnect, SIGTERM, etc.).
 *
 * Called by `bin/annot-mcp.mjs`. Exported so embedding callers
 * can also use the standalone server.
 */
export async function runStdioServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
