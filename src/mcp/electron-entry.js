"use strict";

// Electron bootstrap for the MCP (Multi-Control Program).
// This file should ONLY be executed as a child process of the node-bridge.js.
// It provides runtime services (like offscreen windows) via IPC to the main MCP server.

const { app } = require("electron");
const { getConsoleMessages } = require('../shared/utils/console-capture');
const ScormService = require('../main/services/scorm-service');
const ScormErrorHandler = require('../main/services/scorm/rte/error-handler');
const getLogger = require('../shared/utils/logger');

// Singleton ScormService instance for MCP
let mcpScormService = null;
let mcpScormServiceInitPromise = null;

/**
 * Get or create the MCP ScormService instance
 */
async function getMcpScormService() {
  if (mcpScormService) {
    return mcpScormService;
  }
  
  if (mcpScormServiceInitPromise) {
    await mcpScormServiceInitPromise;
    return mcpScormService;
  }
  
  mcpScormServiceInitPromise = (async () => {
    // Wait for Electron app to be ready before initializing ScormService
    // SessionStore needs app.getPath('userData') which requires app to be ready
    if (app && app.whenReady && !app.isReady()) {
      await app.whenReady();
    }
    
    const logger = getLogger('MCP');
    const errorHandler = new ScormErrorHandler(logger);
    const ScormInspectorTelemetryStore = require('../main/services/scorm-inspector/scorm-inspector-telemetry-store');
    
    // Create telemetry store
    const telemetryStore = new ScormInspectorTelemetryStore({ enableBroadcast: false, logger });
    
    mcpScormService = new ScormService(errorHandler, logger, { sessionNamespace: 'mcp' });
    
    // Create a minimal WindowManager stub for MCP (ScormService requires it for validation)
    const minimalWindowManager = {
      broadcastToAllWindows: () => {} // No-op for headless MCP
    };
    
    // Initialize with minimal dependencies
    // ScormService will create its own SessionStore during initialization
    const deps = new Map([
      ['windowManager', minimalWindowManager],
      ['telemetryStore', telemetryStore]
    ]);
    
    try {
      const initSuccess = await mcpScormService.initialize(deps);
      if (!initSuccess) {
        logger?.error('MCP: ScormService initialization returned false');
        throw new Error('ScormService initialization failed');
      }
      logger?.info('MCP: ScormService initialized successfully');
    } catch (err) {
      logger?.error('MCP: ScormService initialization threw error:', err.message || err);
      throw err;
    }
  })();
  
  await mcpScormServiceInitPromise;
  return mcpScormService;
}

/**
 * Gets console message counts (without full messages to avoid token bloat).
 * @param {string} session_id - The session ID.
 * @param {number} since_ts - The timestamp to fetch messages since.
 * @returns {object|null} A console object with counts only, or null if no session_id.
 */
function getConsolePayload(session_id, since_ts) {
  if (!session_id) return null;

  const messages = getConsoleMessages(session_id, { since_ts, severity: ['warn', 'error'] });
  if (!messages) return null;

  const warning_count = messages.filter(m => m.level === 'warn').length;
  const error_count = messages.filter(m => m.level === 'error').length;

  return {
    error_count,
    warning_count
  };
}

async function childMode() {
  // Child mode: Electron provides runtime services via IPC, no stdio MCP server
  
  // Set app name BEFORE app.whenReady() so userData path is correct
  app.setName('scorm-tester');
  
  app.on("window-all-closed", (e) => {
    try { e.preventDefault(); } catch (_) { /* intentionally empty */ }
  });

  await app.whenReady();

  // Signal to parent (Node bridge) that we're ready
  if (process.send) {
    process.send({ type: 'ready' });
  }

  // Handle IPC messages from parent for runtime operations
  const { RuntimeManager } = require('./runtime-manager');
  if (!RuntimeManager) {
    throw new Error('RuntimeManager module not loaded');
  }

  process.on('message', async (message) => {
    const before_ts = Date.now();
    let result;
    const session_id = message?.params?.session_id;

    try {
      if (typeof RuntimeManager.handleIPCMessage !== 'function') {
        throw new Error('RuntimeManager.handleIPCMessage is not a function. Type: ' + typeof RuntimeManager.handleIPCMessage + ', Keys: ' + Object.keys(RuntimeManager).join(', '));
      }
      result = await RuntimeManager.handleIPCMessage(message);

      // Always attach console error/warning counts (but not full messages)
      if (session_id && result && typeof result === 'object') {
        result.console = getConsolePayload(session_id, before_ts);
      }

      if (process.send) {
        process.send({ id: message.id, result });
      }
    } catch (error) {
      const payload = { message: error?.message || String(error) };
      if (error && error.code) payload.code = error.code;
      if (error && error.data !== undefined) payload.data = error.data;

      // Always attach console error/warning counts (but not full messages)
      if (session_id) {
        payload.console = getConsolePayload(session_id, before_ts);
      }

      if (process.send) {
        process.send({ id: message.id, error: payload });
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

module.exports = { childMode, getMcpScormService };

