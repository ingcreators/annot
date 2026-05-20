// `createServer` — factory for the Annot MCP server. Phase 1 wires
// up the `@modelcontextprotocol/sdk` integration with zero tools
// registered, just enough to prove the transport handshake works.
// Tools land in subsequent phases:
//
//   Phase 2  → `annot_annotate_screenshot`
//   Phase 3b → `annot_annotate_url`
//   Phase 4  → `annot_redact_screenshot` + `annot_redact_url`
//   Phase 5  → `annot_compare_screenshots`
//   Phase 6  → `annot_export_pptx` (gated)
//
// Each phase adds one entry to the tools array; the handler
// dispatch stays a one-line `switch` on tool name.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export interface CreateServerOptions {
  /**
   * Override the version reported in the MCP `initialize` response.
   * Defaults to the package version baked at build time. Mostly
   * useful for tests that want a deterministic version string.
   */
  version?: string;
}

const SERVER_NAME = "annot-mcp";
const DEFAULT_VERSION = "0.1.0";

/**
 * Construct an MCP server instance with the Annot tool surface.
 * Phase 1 registers zero tools; the request handler returns an
 * empty list and rejects any `tools/call` invocation with a
 * "method not found" error.
 */
export function createServer(options: CreateServerOptions = {}): Server {
  const server = new Server(
    {
      name: SERVER_NAME,
      version: options.version ?? DEFAULT_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: [] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    throw new Error(`Unknown tool: ${request.params.name}`);
  });

  return server;
}
