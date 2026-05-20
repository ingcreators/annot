#!/usr/bin/env node

// `annot-mcp` CLI shim. Boots the MCP server over stdio so an MCP
// client (Claude Desktop, Claude Code, Cursor, …) can spawn this
// binary and pipe JSON-RPC over stdin / stdout.
//
// Configure in `~/.config/Claude/claude_desktop_config.json` (or
// the equivalent for other clients) as:
//
//   {
//     "mcpServers": {
//       "annot": { "command": "npx", "args": ["@ingcreators/annot-mcp"] }
//     }
//   }
//
// The actual server lives in `../dist/index.js` after `vite build`;
// during workspace development run `pnpm --filter
// @ingcreators/annot-mcp build` before invoking the bin.

import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "..", "dist", "index.js");

// Windows dynamic import requires a `file://` URL; passing the raw
// absolute path triggers `ERR_UNSUPPORTED_ESM_URL_SCHEME` ("Only
// URLs with a scheme in: file, data, and node are supported"). Use
// `pathToFileURL` so the same code works on Linux / macOS / Windows.
const mod = await import(pathToFileURL(entry).href);
await mod.runStdioServer();
