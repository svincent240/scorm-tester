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
console.log('CRITICAL DEBUG: preload.js script is loading...');
console.log('CRITICAL DEBUG: contextBridge exists:', typeof require('electron').contextBridge !== 'undefined');
console.log('CRITICAL DEBUG: ipcRenderer exists:', typeof require('electron').ipcRenderer !== 'undefined');

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Safe IPC invoke wrapper with error handling
 */
const safeInvoke = async (channel, ...args) => {
  try {
    const result = await ipcRenderer.invoke(channel, ...args);
    return result;
  } catch (error) {
    console.error(`IPC invoke failed for channel '${channel}':`, error);
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
    console.error(`IPC send failed for channel '${channel}':`, error);
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
        console.error(`Event callback error for channel '${channel}':`, error);
      }
    };
    
    ipcRenderer.on(channel, wrappedCallback);
    
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener(channel, wrappedCallback);
    };
  } catch (error) {
    console.error(`Failed to set up event listener for channel '${channel}':`, error);
    return () => {}; // Return no-op cleanup function
  }
};

/**
 * Exposed Electron API
 */
const electronAPI = {
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
  scormCommit: (sessionId) => safeInvoke('scorm-commit', sessionId),
  scormGetLastError: (sessionId) => safeInvoke('scorm-get-last-error', sessionId),
  scormGetErrorString: (sessionId, errorCode) => safeInvoke('scorm-get-error-string', sessionId, errorCode),
  scormGetDiagnostic: (sessionId, errorCode) => safeInvoke('scorm-get-diagnostic', sessionId, errorCode),
  
  // Session Management
  createSession: (courseData) => safeInvoke('create-session', courseData),
  getSession: (sessionId) => safeInvoke('get-session', sessionId),
  getAllSessions: () => safeInvoke('get-all-sessions'),
  deleteSession: (sessionId) => safeInvoke('delete-session', sessionId),
  
  // Navigation
  scormNavigationRequest: (sessionId, request) => safeInvoke('scorm-navigation-request', sessionId, request),
  
  // Logging
  log: (level, message, ...args) => safeSend('log', level, message, ...args),
  
  // Event Listeners
  onMenuEvent: (callback) => safeOn('menu-event', callback),
  onScormApiLog: (callback) => safeOn('scorm-api-log', callback),
  onCourseLoaded: (callback) => safeOn('course-loaded', callback),
  onSessionStateChanged: (callback) => safeOn('session-state-changed', callback),
  onDebugEvent: (callback) => safeOn('debug-event-received', callback),
  
  // Utility
  pathUtils: {
    toFileUrl: (filePath) => safeInvoke('path-to-file-url', filePath),
    normalize: (filePath) => safeInvoke('path-normalize', filePath),
    join: (...paths) => safeInvoke('path-join', ...paths),
    resolveScormUrl: (contentPath, extractionPath) => safeInvoke('resolve-scorm-url', contentPath, extractionPath)
  },
  
  // Development/Debug
  openDevTools: () => safeSend('open-dev-tools'),
  reloadWindow: () => safeSend('reload-window'),
  emitDebugEvent: (eventType, data) => safeSend('debug-event', eventType, data),
  
  // App Info
  getAppVersion: () => safeInvoke('get-app-version'),
  getAppPath: () => safeInvoke('get-app-path')
};

// Add a test method to verify the API is working
electronAPI.testConnection = () => {
  console.log('SCORM Tester: electronAPI test connection called');
  return { success: true, message: 'electronAPI is working' };
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Log successful preload
console.log('SCORM Tester: Preload script loaded successfully');
console.log('SCORM Tester: electronAPI exposed with methods:', Object.keys(electronAPI));

// Note: DOM access is not available in preload scripts
// DOM ready logging will be handled in the renderer process