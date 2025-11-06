"use strict";

const path = require("path");
const fs = require("fs");
const ManifestParser = require("../main/services/scorm/cam/manifest-parser");
let electron = null;
try { electron = require("electron"); } catch (_) { electron = null; }


const PathUtils = require("../shared/utils/path-utils");
const { getPreloadPath, installRealAdapterForWindow } = require("./runtime-adapter");
const getLogger = require("../shared/utils/logger");

// Get logger instance for browser console capture
const logger = getLogger();

// Atomic counter for IPC message IDs to avoid collisions with concurrent calls
let _ipcMessageIdCounter = 0;

async function resolveEntryPathFromManifest(workspace) {
  function findFirstLaunchableItem(items, resById) {
    if (!Array.isArray(items)) return null;
    for (const it of items) {
      if (!it) continue;
      // visible, with identifierref pointing to a resource with href
      if (it.identifierref && it.isvisible !== false) {
        const res = resById.get(it.identifierref);
        if (res && res.href) return { item: it, resource: res };
      }
      if (Array.isArray(it.children) && it.children.length) {
        const found = findFirstLaunchableItem(it.children, resById);
        if (found) return found;
      }
    }
    return null;
  }

  const manifestPath = path.join(workspace, "imsmanifest.xml");
  if (!fs.existsSync(manifestPath)) return null;
  const parser = new ManifestParser({ setError: () => {} });
  try {
    const parsed = await parser.parseManifestFile(manifestPath);
    const manifestDir = path.dirname(manifestPath);

    // Prefer CAM-based launch resolution using default organization/item tree
    const orgs = parsed?.organizations || {};
    const defaultOrgId = orgs.default || null;
    const organizations = Array.isArray(orgs.organization) ? orgs.organization : [];
    const org = organizations.find(o => o.identifier === defaultOrgId) || organizations[0] || null;

    // Build resource map for quick lookup
    const resources = Array.isArray(parsed?.resources) ? parsed.resources : [];
    const resById = new Map();
    for (const r of resources) if (r?.identifier) resById.set(r.identifier, r);

    const found = org ? findFirstLaunchableItem(org.items || [], resById) : null;
    const resource = found?.resource || null;

    // Strict CAM resolution only: require default org/item -> resource.href
    if (resource && resource.href) {
      const base = resource.resolvedBase || manifestDir;
      const resolved = PathUtils.join(base, resource.href);
      return resolved;
    }
    return null;
  } catch (_) { /* intentionally empty */ }
  return null;
}

// Persistent runtime registry keyed by session_id
const _persistentBySession = new Map();

// Per-session network request buffers
const _networkRequestsBySession = new Map();

/**
 * Map Chromium console level to logger level
 * @param {number} level - Chromium console level (0-3)
 * @returns {string} Logger level string
 */
function mapConsoleLevel(level) {
  switch (level) {
    case 0: return 'debug';  // verbose
    case 1: return 'info';   // info
    case 2: return 'warn';   // warning
    case 3: return 'error';  // error
    default: return 'info';
  }
}

/**
 * Set up console logging capture for a BrowserWindow
 * Captures all browser console messages and logs them to the unified logging system
 * Browser console logs are accessible via system_get_logs MCP tool
 * Also stores messages in browser context for scorm_get_console_errors
 * @param {BrowserWindow} win - The BrowserWindow to monitor
 */
// eslint-disable-next-line no-unused-vars
function setupConsoleLogging(win) {
  if (!win || !win.webContents) return;

  // Initialize console message storage in browser context
  win.webContents.executeJavaScript(`
    if (!window.__scormConsoleMessages) {
      window.__scormConsoleMessages = [];

      // Override console methods to capture messages
      const originalConsole = {
        log: console.log,
        warn: console.warn,
        error: console.error,
        info: console.info
      };

      ['log', 'warn', 'error', 'info'].forEach(method => {
        console[method] = function(...args) {
          const message = args.map(arg => {
            if (typeof arg === 'object') {
              try { return JSON.stringify(arg); } catch { return String(arg); }
            }
            return String(arg);
          }).join(' ');

          window.__scormConsoleMessages.push({
            level: method === 'log' ? 'info' : method,
            message: message,
            timestamp: Date.now(),
            source: 'console.' + method
          });

          // Keep only last 500 messages to prevent memory issues
          if (window.__scormConsoleMessages.length > 500) {
            window.__scormConsoleMessages.shift();
          }

          // Call original console method
          originalConsole[method].apply(console, args);
        };
      });

      // Capture uncaught errors
      window.addEventListener('error', (event) => {
        window.__scormConsoleMessages.push({
          level: 'error',
          message: event.message || String(event.error),
          timestamp: Date.now(),
          source: event.filename ? event.filename + ':' + event.lineno : 'unknown',
          stack_trace: event.error?.stack || null
        });
      });

      // Capture unhandled promise rejections
      window.addEventListener('unhandledrejection', (event) => {
        window.__scormConsoleMessages.push({
          level: 'error',
          message: 'Unhandled Promise Rejection: ' + (event.reason?.message || String(event.reason)),
          timestamp: Date.now(),
          source: 'promise-rejection',
          stack_trace: event.reason?.stack || null
        });
      });
    }
  `).catch(() => {
    // Ignore errors during initialization
  });

  // Capture all console messages from renderer process
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    let logLevel = mapConsoleLevel(level);
    const source = sourceId ? `${sourceId}:${line}` : 'scorm-content';

    try {
      const msgStr = String(message || '');

      // Demote known benign CSP violations from embedded SCORM content to warnings
      if (logLevel === 'error' && msgStr.includes("Refused to load the font") && msgStr.includes("data:application/font-woff")) {
        logLevel = 'warn';
      }

      // Filter out benign Chromium warnings
      const isBenignWarning = logLevel === 'warn' && (
        // Iframe sandboxing warning - expected when loading SCORM content
        msgStr.includes("iframe which has both allow-scripts and allow-same-origin") ||
        msgStr.includes("can remove its sandboxing")
      );

      // Log all non-benign messages to unified logging system (accessible via system_get_logs)
      if (!isBenignWarning) {
        logger?.[logLevel](`[Browser Console] ${message}`, { source, line });
      }
    } catch (_) { /* no-op */ }
  });

  // Capture page load errors
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logger?.error(`[Browser Load Error] ${errorDescription} (${errorCode})`, { url: validatedURL, isMainFrame });
  });

  // Capture renderer crashes
  win.webContents.on('crashed', (event, killed) => {
    logger?.error(`[Browser Crash] Renderer process crashed`, { killed });
  });
}

/**
 * Set up network request monitoring for a BrowserWindow
 * Captures all network requests made by SCORM content for debugging
 * @param {BrowserWindow} win - The BrowserWindow to monitor
 * @param {string} session_id - Optional session ID for per-session request capture
 */
function setupNetworkMonitoring(win, session_id = null) {
  if (!win || !win.webContents) return;

  // Initialize per-session network request buffer if session_id provided
  if (session_id && !_networkRequestsBySession.has(session_id)) {
    _networkRequestsBySession.set(session_id, []);
  }

  // Capture network requests via webRequest API
  try {
    const { session } = win.webContents;
    if (!session || !session.webRequest) return;

    // Track request details
    session.webRequest.onBeforeRequest((details, callback) => {
      if (session_id && _networkRequestsBySession.has(session_id)) {
        _networkRequestsBySession.get(session_id).push({
          id: details.id,
          timestamp: Date.now(),
          method: details.method,
          url: details.url,
          resourceType: details.resourceType,
          uploadData: details.uploadData || null
        });
      }
      callback({});
    });

    // Track response details
    session.webRequest.onCompleted((details) => {
      if (session_id && _networkRequestsBySession.has(session_id)) {
        const requests = _networkRequestsBySession.get(session_id);
        const req = requests.find(r => r.id === details.id);
        if (req) {
          req.statusCode = details.statusCode;
          req.statusLine = details.statusLine;
          req.responseHeaders = details.responseHeaders;
          req.completedAt = Date.now();
        }
      }
    });

    // Track errors
    session.webRequest.onErrorOccurred((details) => {
      if (session_id && _networkRequestsBySession.has(session_id)) {
        const requests = _networkRequestsBySession.get(session_id);
        const req = requests.find(r => r.id === details.id);
        if (req) {
          req.error = details.error;
          req.errorAt = Date.now();
        }
      }
    });
  } catch (err) {
    logger?.warn('Failed to set up network monitoring', { error: err.message });
  }
}

class RuntimeManager {
  static get isSupported() {
    // Runtime is supported if bridge is available
    return typeof global.__electronBridge !== 'undefined';
  }

  // Handle IPC messages from Node bridge (when in child mode)
  static async handleIPCMessage(message) {
    switch (message.type) {
      case 'runtime_openPage': {
        // When called from IPC, we're in Electron child - create the window and return window ID
        const win = await this._openPageImpl(message.params);
        // Store window reference by ID for later operations
        const winId = win.webContents.id;
        return { windowId: winId, success: true };
      }

      case 'runtime_openPersistent': {
        await this._openPersistentImpl(message.params);
        return { success: true };
      }

      case 'runtime_capture': {
        const session_id = message.params.session_id;
        const compress = message.params.compress !== false; // Default to compressed
        const persistentWin = this.getPersistent(session_id);
        if (!persistentWin) throw new Error('Runtime not open');
        const imageBuffer = await this.capture(persistentWin, compress);
        return { screenshot: imageBuffer.toString('base64'), success: true };
      }

      case 'runtime_callAPI': {
        const apiWin = this.getPersistent(message.params.session_id);
        if (!apiWin) throw new Error('Runtime not open');
        const result = await this.callAPI(apiWin, message.params.method, message.params.args || []);
        return { result, success: true };
      }

      case 'runtime_getCapturedCalls': {
        const callsWin = this.getPersistent(message.params.session_id);
        if (!callsWin) throw new Error('Runtime not open');
        const calls = await this.getCapturedCalls(callsWin);
        return { calls, success: true };
      }

      case 'runtime_executeJS': {
        const jsWin = this.getPersistent(message.params.session_id);
        if (!jsWin) throw new Error('Runtime not open');

        // Wrap script in try-catch to capture actual JavaScript errors
        // This provides detailed error information (name, message, stack, line/column numbers)
        // instead of Electron's generic "Script failed to execute" message
        // Use eval() to catch syntax errors that would otherwise fail during parsing
        // Use JSON.stringify to safely embed the script without escaping issues
        const wrappedScript = `
          (() => {
            try {
              const __result = eval(${JSON.stringify(message.params.script)});
              return { success: true, result: __result };
            } catch (__error) {
              return {
                success: false,
                error: {
                  name: __error.name || 'Error',
                  message: __error.message || String(__error),
                  stack: __error.stack || null,
                  lineNumber: __error.lineNumber || null,
                  columnNumber: __error.columnNumber || null
                }
              };
            }
          })()
        `;

        try {
          const jsResult = await jsWin.webContents.executeJavaScript(wrappedScript, true);

          // If the script threw an error, convert it to a proper Error object
          if (!jsResult.success) {
            const err = new Error(`JavaScript execution failed: ${jsResult.error.name}: ${jsResult.error.message}`);
            err.code = 'SCRIPT_EXECUTION_ERROR';
            err.details = jsResult.error;
            throw err;
          }

          return { result: jsResult.result, success: true };
        } catch (electronError) {
          // If executeJavaScript itself fails (e.g., syntax error during parsing),
          // try to extract error details from the error message
          const errorMessage = electronError.message || String(electronError);

          // Try to parse error type from Electron's error message
          // Example: "SyntaxError: Unexpected token ';'"
          const errorMatch = errorMessage.match(/^(\w+Error):\s*(.+)$/);

          if (errorMatch) {
            const err = new Error(`JavaScript execution failed: ${errorMatch[1]}: ${errorMatch[2]}`);
            err.code = 'SCRIPT_EXECUTION_ERROR';
            err.details = {
              name: errorMatch[1],
              message: errorMatch[2],
              stack: null,
              lineNumber: null,
              columnNumber: null
            };
            throw err;
          }

          // If we can't parse it, throw a generic error with what we have
          const err = new Error(`JavaScript execution failed: ${errorMessage}`);
          err.code = 'SCRIPT_EXECUTION_ERROR';
          err.details = {
            name: 'Error',
            message: errorMessage,
            stack: null,
            lineNumber: null,
            columnNumber: null
          };
          throw err;
        }
      }

      case 'runtime_getURL': {
        const urlWin = this.getPersistent(message.params.session_id);
        const url = urlWin ? this.getURL(urlWin) : null;
        return { url, success: true };
      }

      case 'runtime_closePersistent': {
        const closed = await this._closePersistentImpl(message.params.session_id);
        return { success: closed };
      }

      case 'runtime_getStatus': {
        const statusWin = this.getPersistent(message.params.session_id);
        if (!statusWin) return { open: false };
        const statusUrl = this.getURL(statusWin);
        const initState = await this.getInitializeState(statusWin);
        const statusCalls = await this.getCapturedCalls(statusWin);
        const lastCall = Array.isArray(statusCalls) && statusCalls.length ? statusCalls[statusCalls.length - 1] : null;
        return {
          open: true,
          url: statusUrl,
          initialize_state: initState,
          last_api_method: lastCall ? String(lastCall.method || '') : null,
          last_api_ts: lastCall ? Number(lastCall.ts || 0) : null
        };
      }

      case 'runtime_getInitializeState': {
        const initWin = this.getPersistent(message.params.session_id);
        if (!initWin) throw new Error('Runtime not open');
        const state = await this.getInitializeState(initWin);
        return { state };
      }

      case 'runtime_snInvoke': {
        const snWin = this.getPersistent(message.params.session_id);
        if (!snWin) throw new Error('Runtime not open');
        const snResult = await this._snInvokeImplementation(snWin, message.params.method, message.params.payload);
        return { result: snResult, success: true };
      }

      case 'runtime_closeAll': {
        // Close all persistent runtime windows (cleanup on MCP server exit)
        const sessionIds = Array.from(_persistentBySession.keys());
        for (const sid of sessionIds) {
          try {
            await this._closePersistentImpl(sid);
          } catch (_) {
            // Best-effort cleanup
          }
        }
        return { success: true, closed_count: sessionIds.length };
      }

      default:
        throw new Error(`Unknown IPC message type: ${message.type}`);
    }
  }

  static async ensureAppReady() {
    if (!this.isSupported) return false;
    // Ensure Electron child is spawned
    if (global.__electronBridge && global.__electronBridge.ensureChild) {
      await global.__electronBridge.ensureChild();
    }
    return true;
  }

  /**
   * Internal implementation that actually creates windows (called by Electron child process)
   * This runs inside the Electron child process and has access to BrowserWindow
   * @private
   */
  static async _openPageImpl({ entryPath, viewport = { width: 1024, height: 768 }, adapterOptions = {} }) {
    const { BrowserWindow } = electron;
    const wp = { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, disableDialogs: true };
    try { wp.preload = getPreloadPath(); } catch (_) { /* intentionally empty */ }
    const win = new BrowserWindow({ show: false, webPreferences: wp });
    // Strictly disable popups, unload prompts, and permissions to keep MCP headless
    try { win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); } catch (_) { /* intentionally empty */ }
    try { win.webContents.on('will-prevent-unload', (e) => { try { e.preventDefault(); } catch (_) { /* intentionally empty */ } }); } catch (_) { /* intentionally empty */ }
    try { win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => { try { callback(false); } catch (_) { /* intentionally empty */ } }); } catch (_) { /* intentionally empty */ }
    if (viewport?.width && viewport?.height) win.setSize(viewport.width, viewport.height);
    const url = 'file://' + entryPath;
    // Always attach real adapter bridge per window BEFORE loading URL to avoid missing handler races
    try { installRealAdapterForWindow(win, adapterOptions || {}); } catch (_) { /* intentionally empty */ }
    // Capture browser console messages to unified log (accessible via system_get_logs)
    this.setupConsoleLogging(win);

    // Load the URL with explicit handling for Storyline-style redirect that triggers ERR_ABORTED
    try {
      await win.loadURL(url);
    } catch (e) {
      const msg = (e && e.message) ? String(e.message) : String(e);
      if (msg.includes('ERR_ABORTED')) {
        // Navigation was aborted (likely immediate redirect). Wait briefly for the new load to finish
        const finished = await new Promise((resolve) => {
          let done = false;
          const cleanup = () => { if (!done) { done = true; resolve(true); } };
          const fail = () => { if (!done) { done = true; resolve(false); } };
          try {
            win.webContents.once('did-finish-load', cleanup);
            win.webContents.once('did-stop-loading', cleanup);
            win.webContents.once('did-fail-load', fail);
          } catch (_) { return resolve(false); }
          setTimeout(() => { if (!done) resolve(false); }, 2000);
        });
        if (!finished) {
          // Build enhanced, fail-fast error message with dir listing
          const fs = require('fs');
          const path = require('path');
          let listing = [];
          try {
            const dir = path.dirname(entryPath);
            listing = fs.readdirSync(dir).sort();
          } catch (_) { /* intentionally empty */ }
          const err = new Error(`ERR_ABORTED while loading ${entryPath}. Directory listing for ${path.dirname(entryPath)}: [${listing.join(', ')}]`);
          err.code = 'ERR_ABORTED';
          throw err;
        }
      } else {
        const fs = require('fs');
        const path = require('path');
        let listing = [];
        try {
          const dir = path.dirname(entryPath);
          listing = fs.readdirSync(dir).sort();
        } catch (_) { /* intentionally empty */ }
        const err = new Error(`${msg} while loading ${entryPath}. Directory listing for ${path.dirname(entryPath)}: [${listing.join(', ')}]`);
        err.code = 'PAGE_LOAD_FAILED';
        throw err;
      }
    }

    // Log final navigated URL for traceability (to log files, not stderr)
    try {
      const finalURL = win?.webContents?.getURL?.() || null;
      if (finalURL) { logger?.debug('Runtime final URL', { finalURL }); }
    } catch (_) { /* intentionally empty */ }

    return win;
  }

  /**
   * Public API: delegates to Electron child via IPC
   */
  static async openPage({ entryPath, viewport = { width: 1024, height: 768 }, adapterOptions = {} }) {
    if (!this.isSupported) { const e = new Error("Electron runtime is required"); e.code = "ELECTRON_REQUIRED"; throw e; }
    const ok = await this.ensureAppReady();
    if (!ok) { const e = new Error("Electron app not ready"); e.code = "ELECTRON_REQUIRED"; throw e; }

    if (!global.__electronBridge || !global.__electronBridge.sendMessage) {
      const e = new Error("Electron bridge not available");
      e.code = "ELECTRON_REQUIRED";
      throw e;
    }
    // Forward to Electron child via IPC
    const result = await global.__electronBridge.sendMessage({
      id: ++_ipcMessageIdCounter,
      type: 'runtime_openPage',
      params: { entryPath, viewport, adapterOptions }
    });
    return result;
  }

  /**
   * Internal implementation that actually creates windows (called by Electron child process)
   * @private
   */
  static async _openPersistentImpl({ session_id, entryPath, viewport = { width: 1024, height: 768 }, adapterOptions = {} }) {
    if (!session_id) throw new Error("session_id required");
    // Close any existing window first
    await this._closePersistentImpl(session_id);
    const win = await this._openPageImpl({ entryPath, viewport, adapterOptions });
    _persistentBySession.set(session_id, win);

    // Set up per-session network monitoring
    setupNetworkMonitoring(win, session_id);

    try { win.on('closed', () => {
      try {
        _persistentBySession.delete(session_id);
        _networkRequestsBySession.delete(session_id);
      } catch (_) { /* intentionally empty */ }
    }); } catch (_) { /* intentionally empty */ }
    return win;
  }

  /**
   * Public API: delegates to Electron child via IPC
   */
  static async openPersistent({ session_id, entryPath, viewport = { width: 1024, height: 768 }, adapterOptions = {} }) {
    if (!this.isSupported) { const e = new Error("Electron runtime is required"); e.code = "ELECTRON_REQUIRED"; throw e; }
    if (!session_id) throw new Error("session_id required");

    if (!global.__electronBridge || !global.__electronBridge.sendMessage) {
      const e = new Error("Electron bridge not available");
      e.code = "ELECTRON_REQUIRED";
      throw e;
    }
    // Forward to Electron child via IPC
    const result = await global.__electronBridge.sendMessage({
      id: ++_ipcMessageIdCounter,
      type: 'runtime_openPersistent',
      params: { session_id, entryPath, viewport, adapterOptions }
    });
    return { session_id, success: result.success };
  }

  static getPersistent(session_id) {
    return _persistentBySession.get(session_id) || null;
  }

  /**
   * Internal implementation that actually closes windows (called by Electron child process)
   * @private
   */
  static async _closePersistentImpl(session_id) {
    const win = _persistentBySession.get(session_id);
    if (win) {
      try { win.destroy(); } catch (_) { /* intentionally empty */ }
      _persistentBySession.delete(session_id);
      return true;
    }
    return false;
  }

  /**
   * Public API: delegates to Electron child via IPC
   */
  static async closePersistent(session_id) {
    if (global.__electronBridge && global.__electronBridge.sendMessage) {
      const result = await global.__electronBridge.sendMessage({
        id: ++_ipcMessageIdCounter,
        type: 'runtime_closePersistent',
        params: { session_id }
      });
      return result.success;
    }
    return false;
  }

  static getURL(win) {
    try { return win?.webContents?.getURL() || null; } catch (_) { return null; }
  }

  static async injectApiRecorder(_win) {
    // Always real adapter via preload exposes API_1484_11 and __scorm_calls; nothing to inject here.
    return true;
  }

  static async runScenario(win, scenario) {
    if (!scenario || !Array.isArray(scenario.steps)) return;
    for (const step of scenario.steps) {
      if (typeof step === 'string') {
        const name = step.toLowerCase();
        if (name === 'initialize') {
          await win.webContents.executeJavaScript("window.API_1484_11 && window.API_1484_11.Initialize('')");
        } else if (name === 'terminate') {
          await win.webContents.executeJavaScript("window.API_1484_11 && window.API_1484_11.Terminate('')");
        } else if (name.startsWith('setvalue ')) {
          const rest = step.substring('setvalue '.length);
          const idx = rest.indexOf(' ');
          if (idx > 0) {
            const key = rest.substring(0, idx);
            const val = rest.substring(idx + 1);
            await win.webContents.executeJavaScript(`window.API_1484_11 && window.API_1484_11.SetValue(${JSON.stringify(key)}, ${JSON.stringify(val)})`);
          }
        }
      } else if (step && typeof step === 'object' && step.method) {
        const method = String(step.method);
        const args = Array.isArray(step.args) ? step.args : [];
        await win.webContents.executeJavaScript(`(window.API_1484_11 && window.API_1484_11[${JSON.stringify(method)}]) ? window.API_1484_11[${JSON.stringify(method)}].apply(window.API_1484_11, ${JSON.stringify(args)}) : undefined`);
      }
    }
  }

  static async callAPI(win, method, args = [], session_id = null) {
    if (session_id) {
      if (global.__electronBridge && global.__electronBridge.sendMessage) {
        const result = await global.__electronBridge.sendMessage({
          id: ++_ipcMessageIdCounter,
          type: 'runtime_callAPI',
          params: { session_id, method, args }
        });
        return result.result;
      }
      throw new Error("Electron bridge not available");
    }

    // Call API using window directly
    const m = String(method || '');
    const arr = Array.isArray(args) ? args : [];
    try {
      const has = await win.webContents.executeJavaScript(`!!(window.API_1484_11 && typeof window.API_1484_11[${JSON.stringify(m)}]==='function')`, true);
      if (!has) {
        const e = new Error(`Invalid SCORM method: ${m}`);
        e.code = 'INVALID_SCORM_METHOD';
        throw e;
      }
      const res = await win.webContents.executeJavaScript(`window.API_1484_11[${JSON.stringify(m)}].apply(window.API_1484_11, ${JSON.stringify(arr)})`, true);
      return typeof res === 'string' ? res : String(res);
    } catch (err) {
      if (!err || !err.code) {
        const e = new Error(`SCORM API call failed: ${m}`);
        e.code = 'SCORM_API_ERROR';
        throw e;
      }
      throw err;
    }
  }

  static async getCapturedCalls(win, session_id = null) {
    // If session_id is provided, use IPC bridge (Node.js -> Electron child)
    if (session_id) {
      if (global.__electronBridge && global.__electronBridge.sendMessage) {
        const result = await global.__electronBridge.sendMessage({
          id: ++_ipcMessageIdCounter,
          type: 'runtime_getCapturedCalls',
          params: { session_id }
        });
        return result.calls || [];
      }
      throw new Error("Electron bridge not available");
    }

    // Direct window access (when called from Electron child)
    const script = `(() => {
      try {
        if (Array.isArray(window.__scorm_calls)) return window.__scorm_calls;
        if (window.SCORM_MCP && typeof window.SCORM_MCP.getCalls === 'function') return window.SCORM_MCP.getCalls();
        return [];
      } catch (_) { return []; }
    })()`;
    try { return await win.webContents.executeJavaScript(script, true); } catch (_) { return []; }
  }

  static async getInitializeState(win, session_id = null) {
    if (session_id) {
      if (global.__electronBridge && global.__electronBridge.sendMessage) {
        const result = await global.__electronBridge.sendMessage({
          id: ++_ipcMessageIdCounter,
          type: 'runtime_getInitializeState',
          params: { session_id }
        });
        return result.state;
      }
      throw new Error("Electron bridge not available");
    }

    // Get state from captured calls
    const calls = await this.getCapturedCalls(win);
    let state = 'none';
    for (const c of (calls || [])) {
      const m = String(c?.method || '');
      if (m === 'Initialize') state = 'initialized';
      if (m === 'Terminate') state = 'terminated';
    }
    return state;
  }

  static async getRuntimeStatus(session_id) {
    if (global.__electronBridge && global.__electronBridge.sendMessage) {
      const result = await global.__electronBridge.sendMessage({
        id: ++_ipcMessageIdCounter,
        type: 'runtime_getStatus',
        params: { session_id }
      });
      return result;
    }
    return { open: false };
  }

  static async capture(win, compress = true) {
    const image = await win.webContents.capturePage();
    if (compress) {
      // Use JPEG with 70% quality for ~10x compression vs PNG
      return image.toJPEG(70);
    }
    return image.toPNG();
  }

  static async _snInvokeImplementation(win, method, payload) {
    const js = `window.SCORM_MCP && window.SCORM_MCP.snInvoke ? window.SCORM_MCP.snInvoke(${JSON.stringify(method)}, ${payload !== undefined ? JSON.stringify(payload) : 'undefined'}) : null`;
    try { return await win.webContents.executeJavaScript(js, true); } catch (_) { return null; }
  }

  static async snInvoke(win, method, payload, session_id = null) {
    if (session_id) {
      if (global.__electronBridge && global.__electronBridge.sendMessage) {
        const result = await global.__electronBridge.sendMessage({
          id: ++_ipcMessageIdCounter,
          type: 'runtime_snInvoke',
          params: { session_id, method, payload }
        });
        return result.result;
      }
      throw new Error("Electron bridge not available");
    }

    // Invoke using window directly
    return this._snInvokeImplementation(win, method, payload);
  }

  /**
   * Execute JavaScript in the browser context
   * @param {BrowserWindow|null} win - Window object (only used when called from Electron child)
   * @param {string} script - JavaScript code to execute
   * @param {string|null} session_id - Session ID (used when called from Node.js parent via IPC)
   * @returns {Promise<any>} Result of the JavaScript execution
   * @throws {Error} With code 'SCRIPT_EXECUTION_ERROR' and details property if script throws an error
   */
  static async executeJS(win, script, session_id = null) {
    if (session_id) {
      if (global.__electronBridge && global.__electronBridge.sendMessage) {
        const result = await global.__electronBridge.sendMessage({
          id: ++_ipcMessageIdCounter,
          type: 'runtime_executeJS',
          params: { session_id, script }
        });
        // IPC handler already throws if script failed, so result.result is the actual value
        return result.result;
      }
      throw new Error("Electron bridge not available");
    }

    // Direct execution when called from Electron child
    if (!win || !win.webContents) {
      throw new Error("Runtime not open");
    }

    // Wrap script in try-catch to capture actual JavaScript errors
    // Use eval() to catch syntax errors that would otherwise fail during parsing
    // Use JSON.stringify to safely embed the script without escaping issues
    const wrappedScript = `
      (() => {
        try {
          const __result = eval(${JSON.stringify(script)});
          return { success: true, result: __result };
        } catch (__error) {
          return {
            success: false,
            error: {
              name: __error.name || 'Error',
              message: __error.message || String(__error),
              stack: __error.stack || null,
              lineNumber: __error.lineNumber || null,
              columnNumber: __error.columnNumber || null
            }
          };
        }
      })()
    `;

    try {
      const jsResult = await win.webContents.executeJavaScript(wrappedScript, true);

      // If the script threw an error, convert it to a proper Error object
      if (!jsResult.success) {
        const err = new Error(`JavaScript execution failed: ${jsResult.error.name}: ${jsResult.error.message}`);
        err.code = 'SCRIPT_EXECUTION_ERROR';
        err.details = jsResult.error;
        throw err;
      }

      return jsResult.result;
    } catch (electronError) {
      // If executeJavaScript itself fails (e.g., syntax error during parsing),
      // try to extract error details from the error message
      const errorMessage = electronError.message || String(electronError);

      // Try to parse error type from Electron's error message
      // Example: "SyntaxError: Unexpected token ';'"
      const errorMatch = errorMessage.match(/^(\w+Error):\s*(.+)$/);

      if (errorMatch) {
        const err = new Error(`JavaScript execution failed: ${errorMatch[1]}: ${errorMatch[2]}`);
        err.code = 'SCRIPT_EXECUTION_ERROR';
        err.details = {
          name: errorMatch[1],
          message: errorMatch[2],
          stack: null,
          lineNumber: null,
          columnNumber: null
        };
        throw err;
      }

      // If we can't parse it, throw a generic error with what we have
      const err = new Error(`JavaScript execution failed: ${errorMessage}`);
      err.code = 'SCRIPT_EXECUTION_ERROR';
      err.details = {
        name: 'Error',
        message: errorMessage,
        stack: null,
        lineNumber: null,
        columnNumber: null
      };
      throw err;
    }
  }

  static async close(win) {
    try { win?.destroy(); } catch (_) { /* intentionally empty */ }
  }

  /**
   * Get network requests for a specific session
   * @param {string} session_id - Session ID
   * @param {object} options - Filter options (resource_types, since_ts, max_count)
   * @returns {Array} Array of network request entries
   */
  static getNetworkRequests(session_id, options = {}) {
    const requests = _networkRequestsBySession.get(session_id) || [];
    let filtered = requests;

    // Filter by resource types if specified
    if (Array.isArray(options.resource_types) && options.resource_types.length > 0) {
      filtered = filtered.filter(req => options.resource_types.includes(req.resourceType));
    }

    // Filter by timestamp if specified
    if (options.since_ts) {
      filtered = filtered.filter(req => req.timestamp >= options.since_ts);
    }

    // Limit count if specified
    if (options.max_count && options.max_count > 0) {
      filtered = filtered.slice(-options.max_count);
    }

    return filtered;
  }

  /**
   * Set up console logging capture for browser console messages.
   * Captures all console output from SCORM content and logs to unified log system.
   * These logs are accessible via system_get_logs MCP tool.
   */
  static setupConsoleLogging(win) {
    if (!win || !win.webContents) return;

    // Map Chromium console levels to our log levels
    const mapConsoleLevel = (level) => {
      switch (level) {
        case 0: return 'debug';  // verbose
        case 1: return 'info';   // info
        case 2: return 'warn';   // warning
        case 3: return 'error';  // error
        default: return 'info';
      }
    };

    // Capture all console messages from SCORM content
    win.webContents.on('console-message', (event, level, message, line, sourceId) => {
      let logLevel = mapConsoleLevel(level);
      const source = sourceId ? `${sourceId}:${line}` : 'scorm-content';

      try {
        const msgStr = String(message || '');

        // Demote known benign CSP violations from embedded SCORM content to warnings
        if (logLevel === 'error' && msgStr.includes("Refused to load the font") && msgStr.includes("data:application/font-woff")) {
          logLevel = 'warn';
        }

        // Filter out benign Chromium warnings
        const isBenignWarning = logLevel === 'warn' && (
          msgStr.includes("iframe which has both allow-scripts and allow-same-origin") ||
          msgStr.includes("can remove its sandboxing")
        );

        // Skip benign warnings from logs
        if (isBenignWarning) return;
      } catch (_) { /* no-op */ }

      // Log to unified system (accessible via system_get_logs)
      logger?.[logLevel](`[Browser Console] ${message} (${source})`);
    });

    // Capture page load errors
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, _isMainFrame) => {
      logger?.error(`[Browser Load Error] ${errorDescription} (${errorCode}) - URL: ${validatedURL}`);
    });

    // Capture renderer crashes
    win.webContents.on('crashed', (event, killed) => {
      logger?.error(`[Browser Crash] Renderer process crashed. Killed: ${killed}`);
    });
  }
}

module.exports = { RuntimeManager, resolveEntryPathFromManifest };

