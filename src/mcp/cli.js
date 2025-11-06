"use strict";

const { parseCliArgs } = require("./cli-utils");
const { startServer } = require("./server");

function banner(flags) {
  const parts = [
    `SCORM MCP Tool`,
    `allow_network=${!!flags.allow_network}`,
  ];
  return parts.join(" | ");
}

/**
 * Run CLI with optional dryRun to avoid starting stdio server (useful for tests)
 * @param {{ argv?: string[], dryRun?: boolean }} opts
 * @returns {{ mode: string, flags: object }} Parsed runtime mode and flags
 */
function runCli(opts = {}) {
  const argv = Array.isArray(opts.argv) ? opts.argv : process.argv.slice(2);
  const flags = parseCliArgs(argv);

  // Expose minimal flags to environment for downstream use
  if (flags.allow_network) process.env.MCP_ALLOW_NETWORK = "1";

  // Log a simple banner to stderr (stdout is reserved for MCP JSON lines)
  try { process.stderr.write(banner(flags) + "\n"); } catch (_) { /* intentionally empty */ }

  if (opts.dryRun) {
    return { flags };
  }

  // For now, all modes start the stdio MCP server in this process.
  // Interactive GUI integration will be wired later to run the server inside Electron.
  startServer();
  return { flags };
}

if (require.main === module) {
  runCli();
}

module.exports = { runCli };

