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
    return await scormService.resetSession(sessionId);
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
        if (debugWindow && !debugWindow.isDestroyed()) {
          // Forward the debug event to the debug window
          debugWindow.webContents.send('debug-event-received', eventType, data);
          this.ipcHandler.logger?.info(`[DEBUG EVENT] Event forwarded to debug window: ${eventType}`);
        } else {
          this.ipcHandler.logger?.warn(`[DEBUG EVENT] Debug window not available for event: ${eventType}`);
        }
      } else {
        this.ipcHandler.logger?.error(`[DEBUG EVENT] WindowManager not found`);
      }
    } catch (error) {
      this.ipcHandler.logger?.error('[DEBUG EVENT] Failed to handle debug event:', error);
    }
  }
}

module.exports = IpcHandlers;