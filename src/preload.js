/**
 * SCORM Tester Preload Script
 *
 * Securely exposes Electron APIs to the renderer process using contextBridge.
 * This script runs in a privileged context and provides controlled access
 * to main process functionality.
 *
 * @fileoverview Preload script for secure IPC communication
 */

// CRITICAL DEBUG: Log immediately when preload script loads
// Route to main logger via IPC rather than console in renderer; keep minimal safe console only if IPC not ready.
try {
  const { ipcRenderer: __ipc } = require('electron');
  if (__ipc) {
    __ipc.invoke('renderer-log-info', 'Preload script is loading...');
    __ipc.invoke('renderer-log-debug', 'contextBridge exists:', typeof require('electron').contextBridge !== 'undefined');
    __ipc.invoke('renderer-log-debug', 'ipcRenderer exists:', typeof require('electron').ipcRenderer !== 'undefined');
  } else {
    // Fallback minimal console only if IPC is absent (should not happen in Electron)
    // IPC not available: skip logging to honor no-console policy
  }
} catch (_) {
  // Final fallback
}

const { contextBridge, ipcRenderer } = require('electron');

// Simple shutdown guard to prevent IPC calls after handlers are unregistered
let isShuttingDown = false;

// Listen for app quit to set shutdown flag
ipcRenderer.on('app-quit', () => {
  ipcRenderer.invoke('renderer-log-info', '[PRELOAD] App quit signal received, setting shutdown flag');
  isShuttingDown = true;
});

/**
 * Safe IPC invoke wrapper with error handling
 */
const safeInvoke = async (channel, ...args) => {
  // Prevent IPC calls during shutdown
  if (isShuttingDown) {
    return { success: false, error: 'App is shutting down' };
  }

  try {
    const result = await ipcRenderer.invoke(channel, ...args);
    return result;
  } catch (error) {
    // Also log to main logger if available
    try {
      ipcRenderer.invoke('renderer-log-error', `[PRELOAD] IPC invoke failed for channel '${channel}': ${error.message}`);
    } catch (_) {}
    return { success: false, error: error.message };
  }
};

/**
 * Safe IPC send wrapper
 */
const safeSend = (channel, ...args) => {
  try {
    ipcRenderer.send(channel, ...args);
  } catch (error) {
    ipcRenderer.invoke('renderer-log-error', `IPC send failed for channel '${channel}':`, error?.message || String(error));
  }
};

/**
 * Safe event listener wrapper
 */
const safeOn = (channel, callback) => {
  try {
    const wrappedCallback = (event, ...args) => {
      try {
        callback(...args);
      } catch (error) {
        ipcRenderer.invoke('renderer-log-error', `Event callback error for channel '${channel}':`, error?.message || String(error));
      }
    };

    ipcRenderer.on(channel, wrappedCallback);

    // Return cleanup function
    return () => {
      ipcRenderer.removeListener(channel, wrappedCallback);
    };
  } catch (error) {
    ipcRenderer.invoke('renderer-log-error', `Failed to set up event listener for channel '${channel}':`, error?.message || String(error));
    return () => {}; // Return no-op cleanup function
  }
};

/**
 * Exposed Electron API
 */
const electronAPI = {
  // Base URL for renderer modules to use for dynamic imports
  rendererBaseUrl: 'scorm-app://app/src/renderer/',

  // File Management
  selectScormPackage: () => safeInvoke('select-scorm-package'),
  selectScormFolder: () => safeInvoke('select-scorm-folder'),
  extractScorm: (zipPath) => safeInvoke('extract-scorm', zipPath),
  saveTemporaryFile: (fileName, base64Data) => safeInvoke('save-temporary-file', fileName, base64Data),
  getCourseInfo: (coursePath) => safeInvoke('get-course-info', coursePath),
  getCourseManifest: (coursePath) => safeInvoke('get-course-manifest', coursePath),
  findScormEntry: (coursePath) => safeInvoke('find-scorm-entry', coursePath),
  processScormManifest: (folderPath, manifestContent) => safeInvoke('process-scorm-manifest', folderPath, manifestContent),

  // SCORM API
  scormInitialize: (sessionId) => safeInvoke('scorm-initialize', sessionId),
  scormTerminate: (sessionId) => safeInvoke('scorm-terminate', sessionId),
  scormGetValue: (sessionId, element) => safeInvoke('scorm-get-value', sessionId, element),
  scormSetValue: (sessionId, element, value) => safeInvoke('scorm-set-value', sessionId, element, value),
  scormSetValuesBatch: (sessionId, ops) => safeInvoke('scorm-set-values-batch', sessionId, ops),
  scormCommit: (sessionId) => safeInvoke('scorm-commit', sessionId),
  scormGetProgressSnapshot: (sessionId) => safeInvoke('scorm-get-progress-snapshot', sessionId),
  scormGetLastError: (sessionId) => safeInvoke('scorm-get-last-error', sessionId),
  scormGetErrorString: (sessionId, errorCode) => safeInvoke('scorm-get-error-string', sessionId, errorCode),
  scormGetDiagnostic: (sessionId, errorCode) => safeInvoke('scorm-get-diagnostic', sessionId, errorCode),
  loadModule: (modulePath) => safeInvoke('load-module', modulePath), // New method

  // Session Management
  createSession: (courseData) => safeInvoke('create-session', courseData),
  getSession: (sessionId) => safeInvoke('get-session', sessionId),
  getAllSessions: () => safeInvoke('get-all-sessions'),
  deleteSession: (sessionId) => safeInvoke('delete-session', sessionId),

  // Recent Courses
  recentCourses: {
    get: () => safeInvoke('recent:get'),
    addOrUpdate: (course) => safeInvoke('recent:addOrUpdate', course),
    remove: (type, path) => safeInvoke('recent:remove', type, path),
    clear: () => safeInvoke('recent:clear')
  },

  // UI Settings (centralized in main)
  ui: {
    getSettings: () => safeInvoke('ui-settings:get'),
    setSettings: (settings) => safeInvoke('ui-settings:set', settings)
  },


  // Navigation
  scormNavigationRequest: (sessionId, request) => safeInvoke('scorm-navigation-request', sessionId, request),

  // Logging
  log: (level, message, ...args) => safeSend('log', level, message, ...args),

  // Renderer logger bridge: forward renderer logs to main logger via IPC
  logger: {
    info: (...args) => safeInvoke('renderer-log-info', ...args),
    warn: (...args) => safeInvoke('renderer-log-warn', ...args),
    error: (...args) => safeInvoke('renderer-log-error', ...args),
    debug: (...args) => safeInvoke('renderer-log-debug', ...args)
  },

  // Event Listeners
  onMenuEvent: (callback) => safeOn('menu-event', callback),
  onCourseLoaded: (callback) => safeOn('course-loaded', callback),
  onSessionStateChanged: (callback) => safeOn('session-state-changed', callback),
  onScormApiCallLogged: (callback) => safeOn('scorm-api-call-logged', callback),
  onScormInspectorDataUpdated: (callback) => safeOn('scorm-inspector-data-updated', callback),
  onScormInspectorErrorUpdated: (callback) => safeOn('scorm-inspector-error-updated', callback),

  // Utility
  pathUtils: {
    toFileUrl: (filePath) => safeInvoke('path-to-file-url', filePath),
    normalize: (filePath) => safeInvoke('path-normalize', filePath),
    join: (...paths) => safeInvoke('path-join', ...paths),
    getAppRoot: () => safeInvoke('get-app-root'),
    prepareCourseSource: (source) => safeInvoke('prepare-course-source', source)
  },

  // Development/Debug
  openDevTools: () => safeSend('open-dev-tools'),
  reloadWindow: () => safeSend('reload-window'),

  // SCORM Inspector
  getScormInspectorHistory: () => safeInvoke('scorm-inspector-get-history'),

  // Enhanced SCORM Inspector data retrieval
  getActivityTree: () => safeInvoke('scorm-inspector-get-activity-tree'),
  getNavigationRequests: () => safeInvoke('scorm-inspector-get-navigation-requests'),
  getGlobalObjectives: () => safeInvoke('scorm-inspector-get-global-objectives'),
  getSSPBuckets: () => safeInvoke('scorm-inspector-get-ssp-buckets'),

  // Course Outline Navigation methods
  getCourseOutlineActivityTree: () => safeInvoke('course-outline-get-activity-tree'),
  validateCourseOutlineChoice: (targetActivityId) => safeInvoke('course-outline-validate-choice', { targetActivityId }),
  getCourseOutlineAvailableNavigation: () => safeInvoke('course-outline-get-available-navigation'),

  // SCORM Inspector Event Listeners
  onScormDataModelUpdated: (callback) => safeOn('scorm-data-model-updated', callback),
  onNavigationAvailabilityUpdated: (callback) => safeOn('navigation:availability:updated', callback),

  // Course Outline SCORM Event Listeners
  onActivityProgressUpdated: (callback) => safeOn('activity:progress:updated', callback),
  onObjectivesUpdated: (callback) => safeOn('objectives:updated', callback),
  onNavigationCompleted: (callback) => safeOn('navigation:completed', callback),

  // App Info
  getAppVersion: () => safeInvoke('get-app-version'),
  getAppPath: () => safeInvoke('get-app-path'),

  // Generic IPC invoke method for modules that need direct IPC access
  invoke: (channel, ...args) => safeInvoke(channel, ...args)
};

// Performance artifacts writer (JSON + TXT) - optional bridge used by diagnostics benchmarks
try {
  const fs = require('fs');
  const fsp = require('fs').promises;
  const path = require('path');

  electronAPI.writePerfArtifact = async (name, payload) => {
    try {
      if (typeof name !== 'string' || !name.trim()) {
        return { success: false, error: 'invalid_name' };
      }
      const baseName = name.trim();
      const ts = new Date().toISOString().replace(/:/g, '-'); // match existing artifacts timestamps
      const artifactsDir = path.resolve(process.cwd(), 'artifacts', 'perf');
      await fsp.mkdir(artifactsDir, { recursive: true });

      const jsonPath = path.join(artifactsDir, `${baseName}-${ts}.json`);
      const txtPath = path.join(artifactsDir, `${baseName}-${ts}.txt`);

      // Write JSON (pretty)
      const jsonContent = JSON.stringify(payload ?? {}, null, 2);
      await fsp.writeFile(jsonPath, jsonContent, 'utf8');

      // Derive a simple human-readable TXT summary
      const lines = [];
      lines.push(`# ${baseName}`);
      lines.push(`when: ${new Date().toISOString()}`);
      if (payload && typeof payload === 'object') {
        if (payload.iterations) lines.push(`iterations: ${payload.iterations}`);
        if (payload.stats && typeof payload.stats === 'object') {
          for (const [k, v] of Object.entries(payload.stats)) {
            if (v && typeof v === 'object') {
              const min = v.min != null ? v.min : '';
              const avg = v.avg != null ? v.avg : '';
              const p95 = v.p95 != null ? v.p95 : '';
              lines.push(`${k}: min ${min}ms avg ${avg}ms p95 ${p95}ms`);
            }
          }
        }
      }
      await fsp.writeFile(txtPath, lines.join('\n') + '\n', 'utf8');

      // Inform main logger
      try { await ipcRenderer.invoke('renderer-log-info', '[Perf] artifacts written', { baseName, jsonPath, txtPath }); } catch (_) {}
      return { success: true, jsonPath, txtPath };
    } catch (e) {
      try { await ipcRenderer.invoke('renderer-log-error', '[Perf] artifact write failed', String(e?.message || e)); } catch (_) {}
      return { success: false, error: String(e?.message || e) };
    }
  };
} catch (_) {
  // Bridge remains optional; renderer guards presence.
}

// Add a test method to verify the API is working
electronAPI.testConnection = () => {
  try { ipcRenderer.invoke('renderer-log-debug', 'electronAPI test connection called'); } catch (_) {}
  return { success: true, message: 'electronAPI is working' };
};

// Expose the API to the renderer process
try {
  ipcRenderer.invoke('renderer-log-info', '[PRELOAD] Attempting to expose electronAPI via contextBridge...');
  contextBridge.exposeInMainWorld('electronAPI', electronAPI);
  ipcRenderer.invoke('renderer-log-info', '[PRELOAD] electronAPI successfully exposed via contextBridge');

  // Set up a global flag to indicate API is ready
  contextBridge.exposeInMainWorld('electronAPIIsReady', true);

} catch (error) {
  ipcRenderer.invoke('renderer-log-error', '[PRELOAD] Failed to expose electronAPI via contextBridge', error?.message || String(error));
}

// NOTE: Event forwarding and API initialization polling has been moved to the renderer process
// The preload script should only expose the API and set the readiness flag

// Log successful preload (via main logger IPC if available)
try { ipcRenderer.invoke('renderer-log-info', 'Preload script loaded; electronAPI exposed', Object.keys(electronAPI)); } catch (_) {}

// Note: DOM access is not available in preload scripts
// DOM ready logging will be handled in the renderer process
