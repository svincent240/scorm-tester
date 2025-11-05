"use strict";

// Electron bootstrap for the MCP (Multi-Control Program).
// This file should ONLY be executed as a child process of the node-bridge.js.
// It provides runtime services (like offscreen windows) via IPC to the main MCP server.

const { app } = require("electron");

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
      const { RuntimeManager } = require('./runtime-manager');
      if (!RuntimeManager) {
        throw new Error('RuntimeManager module not loaded');
      }
      if (typeof RuntimeManager.handleIPCMessage !== 'function') {
        throw new Error('RuntimeManager.handleIPCMessage is not a function. Type: ' + typeof RuntimeManager.handleIPCMessage + ', Keys: ' + Object.keys(RuntimeManager).join(', '));
      }
      const result = await RuntimeManager.handleIPCMessage(message);
      if (process.send) {
        process.send({ id: message.id, result });
      }
    } catch (error) {
      if (process.send) {
        process.send({ id: message.id, error: error.message || String(error) });
      }
    }
  });
}

// This module should only be run as a child process.
// Enforce this by checking for the required child mode flags.
if (require.main === module) {
  const isChildMode = process.env.ELECTRON_CHILD_MODE === '1' || process.argv.includes('--child-mode');
  if (!isChildMode) {
    // Do not write to stderr, as it can interfere with MCP protocols if misused.
    // The node-bridge is the only correct entry point.
    process.exit(1);
  }
  childMode();
}

module.exports = { childMode };

