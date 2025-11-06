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
const { startServer } = require('./server');

// Global reference to Electron child process
let electronChild = null;

// Atomic counter for IPC message IDs to avoid collisions with concurrent calls
let _ipcMessageIdCounter = 0;

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
  electronChild.stdout.on('data', (_data) => {
    // Silently consume stdout
  });

  electronChild.stderr.on('data', (_data) => {
    // Silently consume stderr to avoid polluting MCP protocol channel
    // All diagnostic info is logged to files via system_get_logs tool
  });

  electronChild.on('exit', (_code) => {
    // Silently handle exit - diagnostic info available via system_get_logs
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
            const details = response.error;
            let message = 'Unknown error';
            let code;
            if (typeof details === 'string') {
              message = details;
            } else if (details && typeof details === 'object') {
              if (details.message) message = details.message;
              if (details.code) code = details.code;
            }
            const err = new Error(message);
            if (code) err.code = code;
            reject(err);
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

// Cleanup on exit - close all persistent windows before killing Electron child
async function cleanup() {
  try {
    // Close all persistent runtime windows to prevent leaks
    if (electronChild && !electronChild.killed) {
      // Send cleanup message to Electron child to close all windows
      try {
        electronChild.send({
          id: ++_ipcMessageIdCounter,
          type: 'runtime_closeAll'
        });
        // Give Electron child a moment to clean up windows
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (_) {
        // Best-effort cleanup
      }
      electronChild.kill();
    }
  } catch (_) {
    // Ensure we kill the child even if cleanup fails
    if (electronChild && !electronChild.killed) {
      electronChild.kill();
    }
  }
}

process.on('exit', () => {
  // Synchronous cleanup - kill child immediately
  if (electronChild && !electronChild.killed) {
    electronChild.kill();
  }
});

// Async cleanup on signals
process.on('SIGINT', async () => {
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(0);
});
