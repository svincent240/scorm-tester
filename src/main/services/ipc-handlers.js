/**
 * IPC Handler Methods
 * 
 * Extracted from IpcHandler to maintain file size limits.
 * Contains all individual IPC message handler implementations.
 * 
 * @fileoverview IPC handler method implementations
 */

/**
 * IPC Handler Methods Class
 * 
 * Contains all individual handler method implementations.
 */
class IpcHandlers {
  constructor(ipcHandler) {
    this.ipcHandler = ipcHandler;
    // Persistent storage for all API calls during the session
    this.apiCallHistory = [];
    this.maxHistorySize = 5000; // Increased limit for persistent storage
    this.sessionId = null; // Track current session for clearing
    
    // Clear history on startup
    this.clearApiCallHistory();
    this.ipcHandler.logger?.info('[DEBUG EVENT] API call history cleared on startup');
  }

  // SCORM API handlers
  async handleScormInitialize(event, sessionId) {
    const scormService = this.ipcHandler.getDependency('scormService');
    return await scormService.initializeSession(sessionId);
  }

  async handleScormGetValue(event, sessionId, element) {
    const scormService = this.ipcHandler.getDependency('scormService');
    return await scormService.getValue(sessionId, element);
  }

  async handleScormSetValue(event, sessionId, element, value) {
    const scormService = this.ipcHandler.getDependency('scormService');
    return await scormService.setValue(sessionId, element, value);
  }

  async handleScormCommit(event, sessionId) {
    const scormService = this.ipcHandler.getDependency('scormService');
    return await scormService.commit(sessionId);
  }

  async handleScormTerminate(event, sessionId) {
    const scormService = this.ipcHandler.getDependency('scormService');
    return await scormService.terminate(sessionId);
  }

  // File operation handlers
  async handleSelectScormPackage(event) {
    const fileManager = this.ipcHandler.getDependency('fileManager');
    return await fileManager.selectScormPackage();
  }

  async handleExtractScorm(event, zipPath) {
    const fileManager = this.ipcHandler.getDependency('fileManager');
    return await fileManager.extractScorm(zipPath);
  }

  async handleFindScormEntry(event, folderPath) {
    const fileManager = this.ipcHandler.getDependency('fileManager');
    return await fileManager.findScormEntry(folderPath);
  }

  async handleGetCourseInfo(event, folderPath) {
    const fileManager = this.ipcHandler.getDependency('fileManager');
    return await fileManager.getCourseInfo(folderPath);
  }

  async handleGetCourseManifest(event, folderPath) {
    const fileManager = this.ipcHandler.getDependency('fileManager');
    return await fileManager.getCourseManifest(folderPath);
  }

  async handleSaveTemporaryFile(event, fileName, base64Data) {
    const fileManager = this.ipcHandler.getDependency('fileManager');
    return await fileManager.saveTemporaryFile(fileName, base64Data);
  }

  // Validation handlers
  async handleValidateScormCompliance(event, folderPath) {
    const scormService = this.ipcHandler.getDependency('scormService');
    return await scormService.validateCompliance(folderPath);
  }

  async handleAnalyzeScormContent(event, folderPath) {
    const scormService = this.ipcHandler.getDependency('scormService');
    return await scormService.analyzeContent(folderPath);
  }

  // Session management handlers
  async handleGetSessionData(event, sessionId) {
    const scormService = this.ipcHandler.getDependency('scormService');
    return await scormService.getSessionData(sessionId);
  }

  async handleResetSession(event, sessionId) {
    const scormService = this.ipcHandler.getDependency('scormService');
    const result = await scormService.resetSession(sessionId);
    
    // Clear API call history when session is reset
    this.clearApiCallHistory();
    this.ipcHandler.logger?.info(`[DEBUG EVENT] API call history cleared due to session reset: ${sessionId}`);
    
    return result;
  }

  async handleGetAllSessions(event) {
    const scormService = this.ipcHandler.getDependency('scormService');
    return await scormService.getAllSessions();
  }

  // LMS profile handlers
  async handleApplyLmsProfile(event, sessionId, profileName) {
    const scormService = this.ipcHandler.getDependency('scormService');
    return await scormService.applyLmsProfile(sessionId, profileName);
  }

  async handleGetLmsProfiles(event) {
    const scormService = this.ipcHandler.getDependency('scormService');
    return await scormService.getLmsProfiles();
  }

  // Testing handlers
  async handleRunTestScenario(event, sessionId, scenarioType) {
    const scormService = this.ipcHandler.getDependency('scormService');
    return await scormService.runTestScenario(sessionId, scenarioType);
  }

  // Utility handlers
  async handleOpenExternal(event, url) {
    const { shell } = require('electron');
    return await shell.openExternal(url);
  }

  async handlePathUtilsToFileUrl(event, filePath) {
    const PathUtils = require('../../shared/utils/path-utils');
    const path = require('path');
    const appRoot = PathUtils.normalize(path.resolve(__dirname, '../../../'));
    return PathUtils.toScormProtocolUrl(filePath, appRoot);
  }

  async handleResolveScormUrl(event, contentPath, extractionPath) {
    const PathUtils = require('../../shared/utils/path-utils');
    const path = require('path');
    const appRoot = PathUtils.normalize(path.resolve(__dirname, '../../../'));
    return PathUtils.resolveScormContentUrl(contentPath, extractionPath, appRoot);
  }

  async handlePathNormalize(event, filePath) {
    const PathUtils = require('../../shared/utils/path-utils');
    return PathUtils.normalize(filePath);
  }

  async handlePathJoin(event, ...paths) {
    const path = require('path');
    const PathUtils = require('../../shared/utils/path-utils');
    return PathUtils.normalize(path.join(...paths));
  }

  // Logging handler
  handleLogMessage(event, { level, message, args }) {
    this.ipcHandler.logger?.log(level, `[Renderer] ${message}`, ...args);
  }

  // Debug event handler
  handleDebugEvent(event, eventType, data) {
    try {
      this.ipcHandler.logger?.info(`[DEBUG EVENT] Received debug event: ${eventType}`, data);
      
      // Get the window manager to access debug window
      const windowManager = this.ipcHandler.getDependency('windowManager');
      if (windowManager) {
        this.ipcHandler.logger?.info(`[DEBUG EVENT] WindowManager found, getting debug window`);
        
        const debugWindow = windowManager.getWindow('debug');
        
        // Always store API calls in persistent history
        if (eventType === 'api:call') {
          this.storeApiCall(data);
        }
        
        // Handle special events for clearing history
        if (eventType === 'course:loaded' || eventType === 'course:reset' || eventType === 'session:reset') {
          this.clearApiCallHistory();
          this.ipcHandler.logger?.info(`[DEBUG EVENT] API call history cleared due to: ${eventType}`);
        }
        
        if (debugWindow && !debugWindow.isDestroyed()) {
          // Debug window is available - send event immediately
          debugWindow.webContents.send('debug-event-received', eventType, data);
          this.ipcHandler.logger?.info(`[DEBUG EVENT] Event forwarded to debug window: ${eventType}`);
        } else {
          // Debug window not available - just log for non-API events
          if (eventType !== 'api:call') {
            this.ipcHandler.logger?.warn(`[DEBUG EVENT] Debug window not available for event: ${eventType}`);
          }
        }
      } else {
        this.ipcHandler.logger?.error(`[DEBUG EVENT] WindowManager not found`);
      }
    } catch (error) {
      this.ipcHandler.logger?.error('[DEBUG EVENT] Failed to handle debug event:', error);
    }
  }

  // Store API call in persistent history
  storeApiCall(data) {
    // Add timestamp if not present
    if (data && typeof data === 'object' && !data.timestamp) {
      data.timestamp = Date.now();
    }
    
    this.apiCallHistory.push(data);
    
    // Limit history size to prevent memory issues
    if (this.apiCallHistory.length > this.maxHistorySize) {
      // Remove oldest calls when history is full
      const removed = this.apiCallHistory.splice(0, this.apiCallHistory.length - this.maxHistorySize);
      this.ipcHandler.logger?.warn(`[DEBUG EVENT] History full, removed ${removed.length} oldest API calls`);
    }
    
    this.ipcHandler.logger?.debug(`[DEBUG EVENT] API call stored in history (${this.apiCallHistory.length} total)`);
  }

  // Send all stored API calls to debug window (called when debug window is created)
  sendBufferedApiCalls(debugWindow) {
    if (this.apiCallHistory.length > 0 && debugWindow && !debugWindow.isDestroyed()) {
      this.ipcHandler.logger?.info(`[DEBUG EVENT] Sending ${this.apiCallHistory.length} stored API calls to newly opened debug window`);
      for (const storedCall of this.apiCallHistory) {
        debugWindow.webContents.send('debug-event-received', 'api:call', storedCall);
      }
      // Note: Do NOT clear the history after sending - keep it persistent
    } else if (this.apiCallHistory.length === 0) {
      this.ipcHandler.logger?.debug(`[DEBUG EVENT] No stored API calls to send to debug window`);
    }
  }

  // Clear API call history (called on course load, reset, etc.)
  clearApiCallHistory() {
    const clearedCount = this.apiCallHistory.length;
    this.apiCallHistory = [];
    this.ipcHandler.logger?.info(`[DEBUG EVENT] Cleared ${clearedCount} API calls from history`);
  }

  // Get current API call history (for debugging)
  getApiCallHistory() {
    return [...this.apiCallHistory]; // Return copy to prevent external modification
  }

  // Shutdown cleanup - clear history on app close
  shutdown() {
    this.clearApiCallHistory();
    this.ipcHandler.logger?.info('[DEBUG EVENT] API call history cleared on app shutdown');
  }
}

module.exports = IpcHandlers;