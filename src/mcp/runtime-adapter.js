"use strict";

const path = require("path");
let electron = null;
try { electron = require("electron"); } catch (_) { electron = null; }
const ScormApiHandler = require("../main/services/scorm/rte/api-handler");
const ScormInspectorTelemetryStore = require("../main/services/scorm-inspector/scorm-inspector-telemetry-store");
const { ScormSNService } = require("../main/services/scorm/sn");
const ManifestParser = require("../main/services/scorm/cam/manifest-parser");
const SessionStore = require("../main/services/session-store");
const ErrorHandler = require("../shared/utils/error-handler");

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
// Track telemetry stores so the runtime manager can expose history to MCP tools
const telemetryStoreByWC = new Map();
let ipcRegistered = false;

function ensureIpcHandlers() {
  if (!electron || !electron.ipcMain || ipcRegistered) return;
  const { ipcMain } = electron;

  // Synchronous IPC handler for SCORM API compliance
  // Real SCORM content expects synchronous API methods that return strings immediately
  ipcMain.on("scorm-mcp:api-sync", (event, payload = {}) => {
    let method = '';
    try {
      const wc = event?.sender;
      const id = wc?.id;
      const handler = id != null ? handlerByWC.get(id) : null;
      method = String(payload?.method || "");
      const args = Array.isArray(payload?.args) ? payload.args : [];
      if (!handler || !method || typeof handler[method] !== "function") {
        try { mcpLogger.error(`MCP API (sync): handler missing or method not found`, { id, method }); } catch (_) { /* intentionally empty */ }
        event.returnValue = "false";
        return;
      }
      // SCORM methods are synchronous and return strings per spec
      const res = handler[method].apply(handler, args);
      event.returnValue = typeof res === "string" ? res : String(res);
    } catch (e) {
      try { mcpLogger.error(`MCP API (sync): error invoking ${method}`, e && e.message ? e.message : String(e)); } catch (_) { /* intentionally empty */ }
      event.returnValue = "false";
    }
  });

  // Async IPC handler for MCP tools that can handle promises
  ipcMain.handle("scorm-mcp:api", async (event, payload = {}) => {
    let method = '';
    try {
      const wc = event?.sender;
      const id = wc?.id;
      const handler = id != null ? handlerByWC.get(id) : null;
      method = String(payload?.method || "");
      const args = Array.isArray(payload?.args) ? payload.args : [];
      if (!handler || !method || typeof handler[method] !== "function") {
        try { mcpLogger.error(`MCP API: handler missing or method not found`, { id, method }); } catch (_) { /* intentionally empty */ }
        return "false";
      }
      // SCORM methods return strings per spec
      const res = await handler[method].apply(handler, args);
      return typeof res === "string" ? res : String(res);
    } catch (e) {
      try { mcpLogger.error(`MCP API: error invoking ${method}`, e && e.message ? e.message : String(e)); } catch (_) { /* intentionally empty */ }
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
          mcpLogger?.debug && mcpLogger.debug('[MCP SN] nav result', {
            action: a,
            navRes,
            navResKeys: navRes ? Object.keys(navRes) : null,
            navSuccess: navRes?.success,
            hasError: !!(navRes && navRes.error)
          });
          return { success: !!(navRes && navRes.success), error: navRes?.error, nav: navRes };
        } catch (e) {
          return { success: false, error: e?.message || String(e) };
        }
      }

      return { success: false, error: 'UNKNOWN_ACTION' };
    } catch (e) {
      try { mcpLogger.error(`MCP SN: error handling action ${action}`, e && e.message ? e.message : String(e)); } catch (_) { /* intentionally empty */ }
      return { success: false, error: e?.message || String(e) };
    }
  });

  // Renderer error channel for preload logging; fail-fast with clear surfacing
  ipcMain.handle("renderer-log-error", async (_event, ...args) => {
    try { mcpLogger.error(...args); } catch (_) { /* intentionally empty */ }
    return true;
  });

  ipcRegistered = true;
}

async function installRealAdapterForWindow(win, options = {}) {
  if (!electron || !win || !win.webContents) return false;
  try {
    ensureIpcHandlers();
    
    // Initialize SessionStore
    const errorHandler = new ErrorHandler(mcpLogger);
    const sessionStore = new SessionStore(errorHandler, mcpLogger);
    await sessionStore.initialize();

    const courseId = options.courseId || 'unknown_course';
    const namespace = 'mcp';
    
    if (options.forceNew) {
        await sessionStore.deleteSession(courseId, namespace);
        mcpLogger?.info(`MCP: Forced new session, deleted storage for ${courseId}`);
    }

    // Load session data
    const storedData = await sessionStore.loadSession(courseId, namespace);

    // Minimal telemetry store (no window broadcast in MCP runtime)
    const telemetryStore = new ScormInspectorTelemetryStore({ enableBroadcast: false, logger: mcpLogger });
    
    // Session manager - persistence now handled after Terminate completes
    const sessionManager = {
      registerSession: () => true,
      unregisterSession: () => { /* no-op in MCP runtime */ },
      persistSessionData: async (id, data) => {
          // No-op: persistence is now handled by checking exit type after Terminate
          return true;
      },
      getLearnerInfo: () => ({ id: 'mcp-learner', name: 'MCP Learner' })
    };
    
    // Create a SCORM API handler instance for this window
    const handler = new ScormApiHandler(sessionManager, /* logger */ mcpLogger, options, telemetryStore, /* scormService */ null);
    
    // Hydrate handler
    if (storedData) {
        const exit = storedData['cmi.exit'] || storedData['cmi.core.exit'];
        if (exit === 'suspend') {
            mcpLogger?.info(`MCP: Resuming session for ${courseId}`);
            // Inject stored data
            for (const [key, value] of Object.entries(storedData)) {
                 if (handler.dataModel && typeof handler.dataModel._setInternalValue === 'function') {
                     handler.dataModel._setInternalValue(key, value);
                 }
            }
            // Set entry mode
            if (handler.dataModel) {
                 handler.dataModel._setInternalValue('cmi.entry', 'resume');
                 handler.dataModel._setInternalValue('cmi.core.entry', 'resume');
            }
        } else {
            mcpLogger?.info(`MCP: stored session found but exit='${exit}', starting new`);
            // Ensure entry mode is ab-initio
             if (handler.dataModel) {
                 handler.dataModel._setInternalValue('cmi.entry', 'ab-initio');
                 handler.dataModel._setInternalValue('cmi.core.entry', 'ab-initio');
             }
        }
    }

    handlerByWC.set(win.webContents.id, handler);
    telemetryStoreByWC.set(win.webContents.id, telemetryStore);
    // Cleanup on close
    win.on("closed", () => {
      try { handlerByWC.delete(win.webContents.id); } catch (_) { /* intentionally empty */ }
      try { telemetryStoreByWC.delete(win.webContents.id); } catch (_) { /* intentionally empty */ }
    });
    try { win.__scormTelemetryStore = telemetryStore; } catch (_) { /* intentionally empty */ }
    return telemetryStore;
  } catch (e) {
    try { mcpLogger.error('MCP adapter install failed', e && e.message ? e.message : String(e)); } catch (_) { /* intentionally empty */ }
    return null;
  }
}

function getTelemetryStoreForWindowId(id) {
  if (id == null) return null;
  return telemetryStoreByWC.get(id) || null;
}

module.exports = { getPreloadPath, installRealAdapterForWindow, getTelemetryStoreForWindowId };

