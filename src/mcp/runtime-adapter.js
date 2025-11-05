"use strict";

const path = require("path");
let electron = null;
try { electron = require("electron"); } catch (_) { electron = null; }
const ScormApiHandler = require("../main/services/scorm/rte/api-handler");
const ScormInspectorTelemetryStore = require("../main/services/scorm-inspector/scorm-inspector-telemetry-store");
const { ScormSNService } = require("../main/services/scorm/sn");
const ManifestParser = require("../main/services/scorm/cam/manifest-parser");

// Use the shared logger to write to log files (not stderr, to avoid polluting MCP protocol)
const getLogger = require('../shared/utils/logger');
const mcpLogger = getLogger();


function getPreloadPath() {
  return path.join(__dirname, "preload", "scorm-preload.js");
}

// Maintain a map of webContents.id -> handler instance
const handlerByWC = new Map();
// Map of webContents.id -> SN service instance
const snByWC = new Map();
let ipcRegistered = false;

function ensureIpcHandlers() {
  if (!electron || !electron.ipcMain || ipcRegistered) return;
  const { ipcMain } = electron;

  // Synchronous IPC handler for SCORM API compliance
  // Real SCORM content expects synchronous API methods that return strings immediately
  ipcMain.on("scorm-mcp:api-sync", (event, payload = {}) => {
    try {
      const wc = event?.sender;
      const id = wc?.id;
      const handler = id != null ? handlerByWC.get(id) : null;
      const method = String(payload?.method || "");
      const args = Array.isArray(payload?.args) ? payload.args : [];
      if (!handler || !method || typeof handler[method] !== "function") {
        try { mcpLogger.error(`MCP API (sync): handler missing or method not found`, { id, method }); } catch (_) {}
        event.returnValue = "false";
        return;
      }
      // SCORM methods are synchronous and return strings per spec
      const res = handler[method].apply(handler, args);
      event.returnValue = typeof res === "string" ? res : String(res);
    } catch (e) {
      try { mcpLogger.error(`MCP API (sync): error invoking ${method}`, e && e.message ? e.message : String(e)); } catch (_) {}
      event.returnValue = "false";
    }
  });

  // Async IPC handler for MCP tools that can handle promises
  ipcMain.handle("scorm-mcp:api", async (event, payload = {}) => {
    try {
      const wc = event?.sender;
      const id = wc?.id;
      const handler = id != null ? handlerByWC.get(id) : null;
      const method = String(payload?.method || "");
      const args = Array.isArray(payload?.args) ? payload.args : [];
      if (!handler || !method || typeof handler[method] !== "function") {
        try { mcpLogger.error(`MCP API: handler missing or method not found`, { id, method }); } catch (_) {}
        return "false";
      }
      // SCORM methods return strings per spec
      const res = await handler[method].apply(handler, args);
      return typeof res === "string" ? res : String(res);
    } catch (e) {
      try { mcpLogger.error(`MCP API: error invoking ${method}`, e && e.message ? e.message : String(e)); } catch (_) {}
      return "false";
    }
  });

  // SN bridge: initialize and query status for sequencing
  ipcMain.handle("scorm-mcp:sn", async (event, payload = {}) => {
    const wc = event?.sender;
    const id = wc?.id;
    const action = String(payload?.action || "").toLowerCase();
    try {
      if (action === 'init') {
        const manifestPath = String(payload?.payload?.manifestPath || "");
        const folderPath = String(payload?.payload?.folderPath || "");
        // Parse manifest
        const parser = new ManifestParser({ setError: () => {} });
        const manifest = await parser.parseManifestFile(manifestPath);
        // Minimal error handler
        const errorHandler = { setError: () => {}, getLastError: () => '0' };
        const sn = new ScormSNService(errorHandler, mcpLogger, {}, null, null);
        await sn.initialize(manifest, { folderPath });
        snByWC.set(id, sn);
        return { success: true };
      }
      if (action === 'status') {
        const sn = snByWC.get(id);
        if (!sn) {
          mcpLogger?.debug && mcpLogger.debug('[MCP SN] status action: SN not initialized');
          return { success: false, error: 'SN_NOT_INITIALIZED' };
        }

        // CRITICAL: Always use getSequencingState() to get full state including currentActivity
        // getStatus() only returns version/capabilities, NOT navigation state
        mcpLogger?.debug && mcpLogger.debug('[MCP SN] status action: checking SN methods', {
          hasGetSequencingState: typeof sn.getSequencingState === 'function',
          hasGetStatus: typeof sn.getStatus === 'function',
          snType: sn.constructor?.name
        });

        if (typeof sn.getSequencingState !== 'function') {
          mcpLogger?.error && mcpLogger.error('[MCP SN] status action: SN instance missing getSequencingState method!', {
            availableMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(sn)).filter(m => typeof sn[m] === 'function')
          });
          return { success: false, error: 'SN_BRIDGE_ERROR: getSequencingState not available' };
        }

        const navState = sn.getSequencingState();
        mcpLogger?.debug && mcpLogger.debug('[MCP SN] status action: got sequencing state', {
          hasCurrentActivity: !!(navState && navState.currentActivity),
          sessionState: navState?.sessionState,
          navStateKeys: navState ? Object.keys(navState) : []
        });

        return { success: true, status: navState };
      }
      if (action === 'reset') {
        const sn = snByWC.get(id);
        if (sn && typeof sn.reset === 'function') sn.reset();
        return { success: true };
      }
      if (action === 'nav') {
        const sn = snByWC.get(id);
        if (!sn) return { success: false, error: 'SN_NOT_INITIALIZED' };
        const p = (payload && payload.payload) || {};
        const a = String(p.action || '').toLowerCase();
        try {
          let navRes = null;
          if (a === 'continue') {
            navRes = await sn.processNavigation('continue');
          } else if (a === 'previous') {
            navRes = await sn.processNavigation('previous');
          } else if (a === 'choice') {
            const targetId = String(p.targetId || p.target_id || p.activity_id || '');
            navRes = await sn.processNavigation('choice', targetId);
          } else {
            return { success: false, error: 'NAV_UNSUPPORTED_ACTION' };
          }
          return { success: !!(navRes && navRes.success), nav: navRes };
        } catch (e) {
          return { success: false, error: e?.message || String(e) };
        }
      }

      return { success: false, error: 'UNKNOWN_ACTION' };
    } catch (e) {
      try { mcpLogger.error(`MCP SN: error handling action ${action}`, e && e.message ? e.message : String(e)); } catch (_) {}
      return { success: false, error: e?.message || String(e) };
    }
  });

  // Renderer error channel for preload logging; fail-fast with clear surfacing
  ipcMain.handle("renderer-log-error", async (_event, ...args) => {
    try { mcpLogger.error(...args); } catch (_) {}
    return true;
  });

  ipcRegistered = true;
}

function installRealAdapterForWindow(win, options = {}) {
  if (!electron || !win || !win.webContents) return false;
  try {
    ensureIpcHandlers();
    // Minimal telemetry store (no window broadcast in MCP runtime)
    const telemetryStore = new ScormInspectorTelemetryStore({ enableBroadcast: false, logger: mcpLogger });
    // Minimal session manager for persistence and learner info
    const sessionManager = {
      registerSession: (id, handler) => { try { /* map kept externally */ return true; } catch (_) { return true; } },
      unregisterSession: (_id) => { try { /* noop */ } catch (_) {} },
      persistSessionData: (_id, _data) => { try { mcpLogger.info('MCP adapter: persistSessionData (noop)'); return true; } catch (_) { return true; } },
      getLearnerInfo: () => ({ id: 'mcp-learner', name: 'MCP Learner' })
    };
    // Create a SCORM API handler instance for this window
    const handler = new ScormApiHandler(sessionManager, /* logger */ mcpLogger, options, telemetryStore, /* scormService */ null);
    handlerByWC.set(win.webContents.id, handler);
    // Cleanup on close
    win.on("closed", () => {
      try { handlerByWC.delete(win.webContents.id); } catch (_) {}
    });
    return true;
  } catch (e) {
    try { mcpLogger.error('MCP adapter install failed', e && e.message ? e.message : String(e)); } catch (_) {}
    return false;
  }
}

module.exports = { getPreloadPath, installRealAdapterForWindow };

