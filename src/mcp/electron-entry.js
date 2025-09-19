"use strict";

// Electron bootstrap that runs the MCP stdio server inside Electron.
// This enables all runtime tools (offscreen windows, real adapter preload)
// while preserving the stdio JSON-lines protocol on stdout for agent tools.

const { app } = require("electron");
const { startServer } = require("./server");

async function main() {
  try {
    // Prevent multiple instances
    if (app && typeof app.requestSingleInstanceLock === "function") {
      const gotLock = app.requestSingleInstanceLock();
      if (!gotLock) {
        app.quit();
        return;
      }
    }

    // Do not quit when all windows are closed (we run headless/offscreen)
    app.on("window-all-closed", (e) => {
      try { e.preventDefault(); } catch (_) {}
    });

    // Ready the Electron app; BrowserWindows will be created by runtime tools as needed
    await app.whenReady();

    // Start the MCP stdio server (reads newline-delimited JSON from stdin)
    startServer();
  } catch (e) {
    try { process.stderr.write(`MCP Electron bootstrap error: ${e && e.message ? e.message : String(e)}\n`); } catch (_) {}
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };

