"use strict";

// Electron bootstrap that runs the MCP stdio server inside Electron.
// This enables all runtime tools (offscreen windows, real adapter preload)
// while preserving the stdio JSON-lines protocol on stdout for agent tools.

const { app } = require("electron");
const { startServer } = require("./server");

async function main() {
  try {
    // Check if running in child mode (spawned by Node.js bridge)
    const isChildMode = process.env.ELECTRON_CHILD_MODE === '1' || process.argv.includes('--child-mode');

    if (isChildMode) {
      // Child mode: Don't start stdio server, just provide runtime services via IPC
      return await childMode();
    }

    // Legacy mode: Run as standalone MCP server with stdio (Mac/Linux only)
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
        // Find project root
        let projectRoot = __dirname;
        while (projectRoot !== path.dirname(projectRoot)) {
          if (fs.existsSync(path.join(projectRoot, 'package.json'))) {
            break;
          }
          projectRoot = path.dirname(projectRoot);
        }
        // Logs cleared on startup and overwrite previous session (matching main app behavior)
        const logDir = path.join(projectRoot, 'logs', 'mcp');
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
      // Note: stderr writes removed to avoid polluting MCP protocol channel
      // All diagnostic info is available via system_get_logs tool
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

async function childMode() {
  // Child mode: Electron provides runtime services via IPC, no stdio MCP server
  app.on("window-all-closed", (e) => {
    try { e.preventDefault(); } catch (_) {}
  });

  await app.whenReady();

  // Signal to parent (Node bridge) that we're ready
  if (process.send) {
    process.send({ type: 'ready' });
  }

  // Handle IPC messages from parent for runtime operations
  process.on('message', async (message) => {
    try {
      const RuntimeManager = require('./runtime-manager');
      const result = await RuntimeManager.handleIPCMessage(message);
      if (process.send) {
        process.send({ id: message.id, result });
      }
    } catch (error) {
      if (process.send) {
        process.send({ id: message.id, error: error.message });
      }
    }
  });
}

if (require.main === module) {
  main();
}

module.exports = { main, childMode };

