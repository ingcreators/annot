# Install `annot-mcp`

`@ingcreators/annot-mcp` ships a stdio MCP server. The
`annot-mcp` bin is exposed via npm so MCP clients can spawn it
with `npx`.

## Install

```sh
# Once globally — or skip and use `npx` per-call.
npm install -g @ingcreators/annot-mcp

# Chromium runtime for `_url` tools — one-time, ~150 MB.
npx playwright install chromium
```

The Chromium runtime is only needed for the `_url` tools
(`annot_annotate_url`, `annot_redact_url`). The `_screenshot`
tools that take pre-captured PNG bytes work without it.

## Wire into Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`
on macOS / `%APPDATA%\Claude\claude_desktop_config.json` on
Windows:

```jsonc
{
  "mcpServers": {
    "annot": {
      "command": "npx",
      "args": ["@ingcreators/annot-mcp"]
    },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

Restart Claude Desktop. Five `annot_*` tools appear alongside
playwright-mcp's `browser_*` tools.

## Claude Code

Add `annot-mcp` via the CLI:

```sh
claude mcp add annot npx @ingcreators/annot-mcp
```

Restart Claude Code; the five tools are available in chat.

## Cursor / Continue / other MCP clients

Look for `mcpServers` (or equivalent) in your client's settings;
the snippet shape is the same.

## Verify the install

```sh
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"v","version":"0"}}}' | npx @ingcreators/annot-mcp
```

Expect:

```json
{"result":{"protocolVersion":"2024-11-05",
           "capabilities":{"tools":{}},
           "serverInfo":{"name":"annot-mcp","version":"0.1.1"}},
 "jsonrpc":"2.0","id":1}
```

## Friendly errors agents see

The `_url` tools detect missing Chromium and return a structured
error pointing to the install command:

```
ChromiumUnavailableError: Failed to launch Chromium.
Run `npx playwright install chromium` to download the runtime,
then retry.
```

Locator failures surface as `LocatorResolutionError` with the
offending selector embedded:

```
LocatorResolutionError: Locator "button:has-text('Submit')"
resolved to no visible element. Check the selector matches at
least one element and the element is inside the captured
viewport.
```

These come back as MCP tool errors (`isError: true`) — the
agent corrects the input and retries without crashing the turn.
