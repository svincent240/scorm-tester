# AI Agent MCP Setup (Claude Code, Kilo Code)

Use this to point your MCP-aware AI tools at the SCORM Tester MCP server.

## Prerequisites

- Node.js 18+
- Project dependencies installed: `npm install`
- Electron provided via devDependencies (no global install required)

## Start the MCP stdio server

- Local/dev (macOS/Windows/Linux):
  - `npm run mcp`
- Headless Linux CI:
  - `xvfb-run -a npm run mcp`

Notes:
- The server prints a banner to stderr; JSON responses are written to stdout.
- Runtime tools (screenshots, API execution) run inside Electron offscreen automatically; no flags needed.

## Example MCP client config (conceptual)

```json
{
  "command": "npm",
  "args": ["run", "mcp"],
  "transport": "stdio"
}
```

## Quick smoke test (optional)

With the server running, from another terminal:

```bash
printf '{"id":1,"method":"scorm_echo","params":{"message":"hello"}}\n' | npm run mcp
```

You should see a newline-delimited JSON response on stdout.

