#!/usr/bin/env node
"use strict";

/**
 * Node.js MCP Bridge Server
 *
 * This is the MCP server entry point that handles stdio communication.
 * It spawns Electron as a child process and communicates via IPC.
 *
 * Architecture:
 * - This process: Handles MCP stdio protocol (works on Windows)
 * - Child Electron: Provides browser runtime (BrowserWindow, screenshots, etc.)
 * - Communication: IPC messages between Node.js and Electron
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { startServer } = require('./server');

// Global reference to Electron child process
let electronChild = null;

// Initialize logger directory before starting server
// This ensures logs are written to a consistent location for this MCP session
// Logs are cleared on startup and overwrite previous session (no timestamps in path)
if (!process.env.SCORM_TESTER_LOG_DIR) {
  // Find project root
  let projectRoot = __dirname;
  while (projectRoot !== path.dirname(projectRoot)) {
    if (fs.existsSync(path.join(projectRoot, 'package.json'))) {
      break;
    }
    projectRoot = path.dirname(projectRoot);
  }
  const logDir = path.join(projectRoot, 'logs', 'mcp');
  fs.mkdirSync(logDir, { recursive: true });
  process.env.SCORM_TESTER_LOG_DIR = logDir;
  // Write to stderr for immediate visibility
  process.stderr.write(`[Bridge] Log directory: ${logDir}\n`);
}

// Start the MCP stdio server
startServer();

// Spawn Electron child process when first runtime tool is called
// This is lazy - we only spawn Electron if runtime features are actually needed
async function ensureElectronChild() {
  if (electronChild && !electronChild.killed) {
    return electronChild;
  }

  const electronPath = require('electron');
  const entryPoint = path.join(__dirname, 'electron-entry.js');

  electronChild = spawn(electronPath, [entryPoint, '--child-mode'], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], // stdin ignored, stdout/stderr piped, IPC enabled
    env: { ...process.env, ELECTRON_CHILD_MODE: '1' }
  });

  // Suppress Electron output to avoid polluting MCP protocol
  // Only log if there's an actual error
  electronChild.stdout.on('data', (data) => {
    // Silently consume stdout
  });

  electronChild.stderr.on('data', (data) => {
    // Only log actual errors to our stderr
    const msg = data.toString();
    if (msg.includes('error') || msg.includes('Error') || msg.includes('ERROR')) {
      process.stderr.write(`[Electron Error] ${msg}`);
    }
  });

  electronChild.on('exit', (code) => {
    process.stderr.write(`[Bridge] Electron child exited with code ${code}\n`);
    electronChild = null;
  });

  // Wait for Electron to signal it's ready
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Electron child startup timeout')), 10000);
    electronChild.once('message', (msg) => {
      if (msg.type === 'ready') {
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  return electronChild;
}

// Export for runtime-manager to use
global.__electronBridge = {
  ensureChild: ensureElectronChild,
  sendMessage: async (message) => {
    const child = await ensureElectronChild();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('IPC timeout')), 30000);
      const handler = (response) => {
        if (response.id === message.id) {
          clearTimeout(timeout);
          child.removeListener('message', handler);
          if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response.result);
          }
        }
      };
      child.on('message', handler);
      child.send(message);
    });
  }
};

// Cleanup on exit
process.on('exit', () => {
  if (electronChild && !electronChild.killed) {
    electronChild.kill();
  }
});
