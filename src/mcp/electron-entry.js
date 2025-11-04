"use strict";

// Electron bootstrap that runs the MCP stdio server inside Electron.
// This enables all runtime tools (offscreen windows, real adapter preload)
// while preserving the stdio JSON-lines protocol on stdout for agent tools.

const { app } = require("electron");
const { startServer } = require("./server");

async function main() {
  try {
    // Do NOT enforce single-instance for MCP stdio server; CI/dev may spawn multiple for tests
    // (Keep desktop app single-instance behavior in main app entry, not here).

    // Hide dock icon on macOS when running as MCP background server
    if (process.platform === 'darwin' && app.dock) {
      app.dock.hide();
    }

    // Do not quit when all windows are closed (we run headless/offscreen)
    app.on("window-all-closed", (e) => {
      try { e.preventDefault(); } catch (_) {}
    });

    // Ready the Electron app; BrowserWindows will be created by runtime tools as needed
    // Initialize AI-accessible log directory for MCP runs if not provided
    try {
      if (!process.env.SCORM_TESTER_LOG_DIR) {
        const path = require('path');
        const fs = require('fs');
        const os = require('os');
        // Use OS temp directory with a scorm-mcp subdirectory
        const logDir = path.join(os.tmpdir(), 'scorm-mcp', `session-${Date.now()}-${process.pid}`);
        fs.mkdirSync(logDir, { recursive: true });
        process.env.SCORM_TESTER_LOG_DIR = logDir;
      }
      const getLogger = require('../shared/utils/logger.js');
      const logger = getLogger(process.env.SCORM_TESTER_LOG_DIR);
      logger.info('=== SCORM MCP Server Started ===', {
        logDir: process.env.SCORM_TESTER_LOG_DIR,
        logFile: logger.ndjsonFile,
        pid: process.pid,
        note: 'Use system_get_logs tool to retrieve logs'
      });
      // Also write to stderr for immediate visibility during startup
      try {
        process.stderr.write(`\n=== SCORM MCP Server Started ===\n`);
        process.stderr.write(`Log Directory: ${process.env.SCORM_TESTER_LOG_DIR}\n`);
        process.stderr.write(`Log File: ${logger.ndjsonFile}\n`);
        process.stderr.write(`Use system_get_logs MCP tool to retrieve logs\n\n`);
      } catch (_) {}
    } catch (_) {}

    // Start the MCP stdio server (reads newline-delimited JSON from stdin) ASAP to keep stdout responsive
    // This allows initialize/tools/* to work immediately while Electron finishes booting.
    startServer();

    await app.whenReady();
  } catch (e) {
    try { process.stderr.write(`MCP Electron bootstrap error: ${e && e.message ? e.message : String(e)}\n`); } catch (_) {}
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };

