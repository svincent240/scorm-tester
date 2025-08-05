/**
 * IPC Handler Service
 * 
 * Centralizes all Inter-Process Communication handling between main and renderer
 * processes. Provides message routing, validation, security enforcement, and
 * error handling for all IPC operations.
 * 
 * @fileoverview IPC communication service for SCORM Tester main process
 */

const { ipcMain, shell } = require('electron'); // Added shell for handleOpenExternal
const path = require('path'); // Added path for path utils
const BaseService = require('./base-service');
const { 
  SERVICE_DEFAULTS,
  SECURITY_CONFIG,
  SERVICE_EVENTS 
} = require('../../shared/constants/main-process-constants');
const { MAIN_PROCESS_ERRORS } = require('../../shared/constants/error-codes');
const PathUtils = require('../../shared/utils/path-utils'); // Added PathUtils

/**
 * IPC Handler Service Class
 * 
 * Manages all IPC communication between main and renderer processes with
 * security validation, message routing, and comprehensive error handling.
 */
class IpcHandler extends BaseService {
  constructor(errorHandler, logger, options = {}) {
    super('IpcHandler', errorHandler, logger, options);
    
    this.config = { ...SERVICE_DEFAULTS.IPC_HANDLER, ...options };
    this.handlers = new Map();
    this.activeRequests = new Map();
    this.requestCounter = 0;
    this.rateLimitMap = new Map();
    this.securityConfig = SECURITY_CONFIG.IPC;
    // Removed this.handlerMethods = new IpcHandlers(this);
    this.rateLimitCleanupInterval = null;

    // Persistent storage for all API calls during the session (from IpcHandlers)
    this.apiCallHistory = [];
    this.maxHistorySize = 5000; // Increased limit for persistent storage
    this.sessionId = null; // Track current session for clearing
    
    // Clear history on startup (from IpcHandlers)
    this.clearApiCallHistory();
    this.logger?.info('[DEBUG EVENT] API call history cleared on startup');
  }

  /**
   * Validate dependencies
   */
  validateDependencies() {
    const fileManager = this.getDependency('fileManager');
    const scormService = this.getDependency('scormService');
    const windowManager = this.getDependency('windowManager');
    
    if (!fileManager) {
      this.logger?.error('IpcHandler: FileManager dependency missing');
      return false;
    }
    
    if (!scormService) {
      this.logger?.error('IpcHandler: ScormService dependency missing');
      return false;
    }
    
    if (!windowManager) {
      this.logger?.error('IpcHandler: WindowManager dependency missing');
      return false;
    }
    
    return true;
  }

  /**
   * Initialize IPC handler service
   */
  async doInitialize() {
    this.logger?.debug('IpcHandler: Starting initialization');
    this.registerHandlers();
    this.setupRateLimitCleanup();
    this.logger?.debug('IpcHandler: Initialization completed');
  }

  /**
   * Shutdown IPC handler service
   */
  async doShutdown() {
    this.logger?.debug('IpcHandler: Starting shutdown');
    
    // Shutdown handler methods (clears API call history) (from IpcHandlers)
    this.clearApiCallHistory(); // Directly call the method
    this.logger?.info('[DEBUG EVENT] API call history cleared on app shutdown');
    
    this.unregisterHandlers();
    this.activeRequests.clear();
    this.rateLimitMap.clear();
    
    // Clear the rate limit cleanup interval
    if (this.rateLimitCleanupInterval) {
      clearInterval(this.rateLimitCleanupInterval);
      this.rateLimitCleanupInterval = null;
    }
    
    this.logger?.debug('IpcHandler: Shutdown completed');
  }

  /**
   * Register all IPC channel handlers
   */
  registerHandlers() {
    try {
      // SCORM API handlers
      this.registerHandler('scorm-initialize', this.handleScormInitialize.bind(this));
      this.registerHandler('scorm-get-value', this.handleScormGetValue.bind(this));
      this.registerHandler('scorm-set-value', this.handleScormSetValue.bind(this));
      this.registerHandler('scorm-commit', this.handleScormCommit.bind(this));
      this.registerHandler('scorm-terminate', this.handleScormTerminate.bind(this));
      
      // File operation handlers
      this.registerHandler('select-scorm-package', this.handleSelectScormPackage.bind(this));
      this.registerHandler('extract-scorm', this.handleExtractScorm.bind(this));
      this.registerHandler('save-temporary-file', this.handleSaveTemporaryFile.bind(this));
      this.registerHandler('find-scorm-entry', this.handleFindScormEntry.bind(this));
      this.registerHandler('get-course-info', this.handleGetCourseInfo.bind(this));
      this.registerHandler('get-course-manifest', this.handleGetCourseManifest.bind(this));
      
      // Validation and session handlers
      this.registerHandler('validate-scorm-compliance', this.handleValidateScormCompliance.bind(this));
      this.registerHandler('analyze-scorm-content', this.handleAnalyzeScormContent.bind(this));
      this.registerHandler('get-session-data', this.handleGetSessionData.bind(this));
      this.registerHandler('reset-session', this.handleResetSession.bind(this));
      this.registerHandler('get-all-sessions', this.handleGetAllSessions.bind(this));
      
      // SCORM CAM processing handler (new)
      this.registerHandler('process-scorm-manifest', this.handleProcessScormManifest.bind(this));
      
      // SN Service handlers
      this.registerHandler('sn:getStatus', this.handleSNGetStatus.bind(this));
      
      // LMS and testing handlers
      this.registerHandler('apply-lms-profile', this.handleApplyLmsProfile.bind(this));
      this.registerHandler('get-lms-profiles', this.handleGetLmsProfiles.bind(this));
      this.registerHandler('run-test-scenario', this.handleRunTestScenario.bind(this));
      
      // Utility handlers
      this.registerHandler('open-external', this.handleOpenExternal.bind(this));
      this.registerHandler('path-to-file-url', this.handlePathUtilsToFileUrl.bind(this));
      this.registerHandler('resolve-scorm-url', this.handleResolveScormUrl.bind(this));
      this.registerHandler('path-normalize', this.handlePathNormalize.bind(this));
      this.registerHandler('path-join', this.handlePathJoin.bind(this));
      this.registerSyncHandler('log-message', this.handleLogMessage.bind(this));
      this.registerSyncHandler('debug-event', this.handleDebugEvent.bind(this));
      
      this.logger?.info(`IpcHandler: Registered ${this.handlers.size} IPC handlers`);
      this.recordOperation('registerHandlers', true);
      
    } catch (error) {
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.IPC_CHANNEL_REGISTRATION_FAILED,
        `IPC handler registration failed: ${error.message}`,
        'IpcHandler.registerHandlers'
      );
      
      this.logger?.error('IpcHandler: Handler registration failed:', error);
      this.recordOperation('registerHandlers', false);
      throw error;
    }
  }

  /**
   * Register individual IPC handler
   */
  registerHandler(channel, handler) {
    if (!this.securityConfig.allowedChannels.includes(channel)) {
      throw new Error(`Channel ${channel} not in allowed channels list`);
    }
    
    const wrappedHandler = this.wrapHandler(channel, handler);
    ipcMain.handle(channel, wrappedHandler);
    this.handlers.set(channel, wrappedHandler);
    
    this.logger?.debug(`IpcHandler: Registered handler for channel: ${channel}`);
  }

  /**
   * Register synchronous IPC handler
   */
  registerSyncHandler(channel, handler) {
    if (!this.securityConfig.allowedChannels.includes(channel)) {
      throw new Error(`Channel ${channel} not in allowed channels list`);
    }
    
    const wrappedHandler = this.wrapSyncHandler(channel, handler);
    ipcMain.on(channel, wrappedHandler);
    this.handlers.set(channel, wrappedHandler);
    
    this.logger?.debug(`IpcHandler: Registered sync handler for channel: ${channel}`);
  }

  /**
   * Wrap handler with security and validation
   */
  wrapHandler(channel, handler) {
    return async (event, ...args) => {
      const requestId = ++this.requestCounter;
      const startTime = Date.now();
      
      try {
        if (!this.validateRequest(event, channel, args)) {
          throw new Error('Request validation failed');
        }
        
        if (!this.checkRateLimit(event.sender)) {
          throw new Error('Rate limit exceeded');
        }
        
        this.activeRequests.set(requestId, { channel, startTime, event });
        
        this.logger?.debug(`IpcHandler: Processing ${channel} request ${requestId}`);
        this.emit(SERVICE_EVENTS.IPC_MESSAGE_RECEIVED, { channel, requestId });
        
        const result = await handler(event, ...args);
        
        const duration = Date.now() - startTime;
        this.recordOperation(`${channel}:success`, true);
        this.logger?.debug(`IpcHandler: ${channel} request ${requestId} completed in ${duration}ms`);
        
        return result;
        
      } catch (error) {
        const duration = Date.now() - startTime;
        this.recordOperation(`${channel}:error`, false);
        
        this.errorHandler?.setError(
          MAIN_PROCESS_ERRORS.IPC_MESSAGE_ROUTING_FAILED,
          `IPC ${channel} handler failed: ${error.message}`,
          `IpcHandler.${channel}`
        );
        
        this.logger?.error(`IpcHandler: ${channel} request ${requestId} failed after ${duration}ms:`, error);
        this.emit(SERVICE_EVENTS.IPC_ERROR, { channel, requestId, error: error.message });
        
        throw error;
        
      } finally {
        this.activeRequests.delete(requestId);
      }
    };
  }

  /**
   * Wrap synchronous handler with security and validation
   */
  wrapSyncHandler(channel, handler) {
    return (event, ...args) => {
      try {
        if (!this.validateRequest(event, channel, args)) {
          return;
        }
        
        handler(event, ...args);
        this.recordOperation(`${channel}:sync`, true);
        
      } catch (error) {
        this.recordOperation(`${channel}:sync`, false);
        this.logger?.error(`IpcHandler: Sync ${channel} handler failed:`, error);
      }
    };
  }

  /**
   * Validate IPC request
   */
  validateRequest(event, channel, args) {
    try {
      const messageSize = JSON.stringify(args).length;
      if (messageSize > this.securityConfig.maxMessageSize) {
        this.logger?.warn(`IpcHandler: Message size ${messageSize} exceeds limit ${this.securityConfig.maxMessageSize}`);
        return false;
      }
      
      return true;
      
    } catch (error) {
      this.logger?.error('IpcHandler: Request validation failed:', error);
      return false;
    }
  }

  /**
   * Check rate limiting for sender
   */
  checkRateLimit(sender) {
    if (!this.config.enableRateLimiting) {
      return true;
    }
    
    const senderId = sender.id;
    const now = Date.now();
    const windowStart = now - this.config.rateLimitWindow;
    
    let rateLimitEntry = this.rateLimitMap.get(senderId);
    if (!rateLimitEntry) {
      rateLimitEntry = { requests: [], blocked: false };
      this.rateLimitMap.set(senderId, rateLimitEntry);
    }
    
    rateLimitEntry.requests = rateLimitEntry.requests.filter(time => time > windowStart);
    
    if (rateLimitEntry.requests.length >= this.config.rateLimitMax) {
      rateLimitEntry.blocked = true;
      return false;
    }
    
    rateLimitEntry.requests.push(now);
    rateLimitEntry.blocked = false;
    
    return true;
  }

  /**
   * Set up rate limit cleanup interval
   */
  setupRateLimitCleanup() {
    this.rateLimitCleanupInterval = setInterval(() => {
      const now = Date.now();
      const windowStart = now - this.config.rateLimitWindow;
      
      for (const [senderId, entry] of this.rateLimitMap) {
        entry.requests = entry.requests.filter(time => time > windowStart);
        
        if (entry.requests.length === 0) {
          this.rateLimitMap.delete(senderId);
        }
      }
    }, this.config.rateLimitWindow);
  }

  /**
   * Unregister all IPC handlers
   */
  unregisterHandlers() {
    for (const [channel, handler] of this.handlers) {
      ipcMain.removeHandler(channel);
      this.logger?.debug(`IpcHandler: Unregistered handler for channel: ${channel}`);
    }
    
    this.handlers.clear();
    this.logger?.info('IpcHandler: All handlers unregistered');
  }

  // --- Start of merged IpcHandlers methods ---

  // SCORM API handlers
  async handleScormInitialize(event, sessionId) {
    const scormService = this.getDependency('scormService');
    return await scormService.initializeSession(sessionId);
  }

  async handleScormGetValue(event, sessionId, element) {
    const scormService = this.getDependency('scormService');
    return await scormService.getValue(sessionId, element);
  }

  async handleScormSetValue(event, sessionId, element, value) {
    const scormService = this.getDependency('scormService');
    return await scormService.setValue(sessionId, element, value);
  }

  async handleScormCommit(event, sessionId) {
    const scormService = this.getDependency('scormService');
    return await scormService.commit(sessionId);
  }

  async handleScormTerminate(event, sessionId) {
    const scormService = this.getDependency('scormService');
    return await scormService.terminate(sessionId);
  }

  // File operation handlers
  async handleSelectScormPackage(event) {
    const fileManager = this.getDependency('fileManager');
    return await fileManager.selectScormPackage();
  }

  async handleExtractScorm(event, zipPath) {
    const fileManager = this.getDependency('fileManager');
    return await fileManager.extractScorm(zipPath);
  }

  async handleFindScormEntry(event, folderPath) {
    const fileManager = this.getDependency('fileManager');
    return await fileManager.findScormEntry(folderPath);
  }

  async handleGetCourseInfo(event, folderPath) {
    const fileManager = this.getDependency('fileManager');
    return await fileManager.getCourseInfo(folderPath);
  }

  async handleGetCourseManifest(event, folderPath) {
    const fileManager = this.getDependency('fileManager');
    return await fileManager.getCourseManifest(folderPath);
  }

  async handleSaveTemporaryFile(event, fileName, base64Data) {
    const fileManager = this.getDependency('fileManager');
    return await fileManager.saveTemporaryFile(fileName, base64Data);
  }

  // Validation handlers
  async handleValidateScormCompliance(event, folderPath) {
    const scormService = this.getDependency('scormService');
    return await scormService.validateCompliance(folderPath);
  }

  async handleAnalyzeScormContent(event, folderPath) {
    const scormService = this.getDependency('scormService');
    return await scormService.analyzeContent(folderPath);
  }

  // Session management handlers
  async handleGetSessionData(event, sessionId) {
    const scormService = this.getDependency('scormService');
    return await scormService.getSessionData(sessionId);
  }

  async handleResetSession(event, sessionId) {
    const scormService = this.getDependency('scormService');
    const result = await scormService.resetSession(sessionId);
    
    // Clear API call history when session is reset
    this.clearApiCallHistory();
    this.logger?.info(`[DEBUG EVENT] API call history cleared due to session reset: ${sessionId}`);
    
    return result;
  }

  async handleGetAllSessions(event) {
    const scormService = this.getDependency('scormService');
    return await scormService.getAllSessions();
  }

  // LMS profile handlers
  async handleApplyLmsProfile(event, sessionId, profileName) {
    const scormService = this.getDependency('scormService');
    return await scormService.applyLmsProfile(sessionId, profileName);
  }

  async handleGetLmsProfiles(event) {
    const scormService = this.getDependency('scormService');
    return await scormService.getLmsProfiles();
  }

  // Testing handlers
  async handleRunTestScenario(event, sessionId, scenarioType) {
    const scormService = this.getDependency('scormService');
    return await scormService.runTestScenario(sessionId, scenarioType);
  }

  // Utility handlers
  async handleOpenExternal(event, url) {
    return await shell.openExternal(url);
  }

  async handlePathUtilsToFileUrl(event, filePath) {
    const appRoot = PathUtils.normalize(path.resolve(__dirname, '../../../'));
    return PathUtils.toScormProtocolUrl(filePath, appRoot);
  }

  async handleResolveScormUrl(event, contentPath, extractionPath) {
    const appRoot = PathUtils.normalize(path.resolve(__dirname, '../../../'));
    return PathUtils.resolveScormContentUrl(contentPath, extractionPath, appRoot);
  }

  async handlePathNormalize(event, filePath) {
    return PathUtils.normalize(filePath);
  }

  async handlePathJoin(event, ...paths) {
    return PathUtils.normalize(path.join(...paths));
  }

  // Logging handler
  handleLogMessage(event, { level, message, args }) {
    this.logger?.log(level, `[Renderer] ${message}`, ...args);
  }

  // Debug event handler
  handleDebugEvent(event, eventType, data) {
    try {
      this.logger?.info(`[DEBUG EVENT] Received debug event: ${eventType}`, data);
      
      // Get the window manager to access debug window
      const windowManager = this.getDependency('windowManager');
      if (windowManager) {
        this.logger?.info(`[DEBUG EVENT] WindowManager found, getting debug window`);
        
        const debugWindow = windowManager.getWindow('debug');
        
        // Always store API calls in persistent history
        if (eventType === 'api:call') {
          this.storeApiCall(data);
        }
        
        // Handle special events for clearing history
        if (eventType === 'course:loaded' || eventType === 'course:reset' || eventType === 'session:reset') {
          this.clearApiCallHistory();
          this.logger?.info(`[DEBUG EVENT] API call history cleared due to: ${eventType}`);
        }
        
        if (debugWindow && !debugWindow.isDestroyed()) {
          // Debug window is available - send event immediately
          debugWindow.webContents.send('debug-event-received', eventType, data);
          this.logger?.info(`[DEBUG EVENT] Event forwarded to debug window: ${eventType}`);
        } else {
          // Debug window not available - just log for non-API events
          if (eventType !== 'api:call') {
            this.logger?.warn(`[DEBUG EVENT] Debug window not available for event: ${eventType}`);
          }
        }
      } else {
        this.logger?.error(`[DEBUG EVENT] WindowManager not found`);
      }
    } catch (error) {
      this.logger?.error('[DEBUG EVENT] Failed to handle debug event:', error);
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
      this.logger?.warn(`[DEBUG EVENT] History full, removed ${removed.length} oldest API calls`);
    }
    
    this.logger?.debug(`[DEBUG EVENT] API call stored in history (${this.apiCallHistory.length} total)`);
  }

  // Send all stored API calls to debug window (called when debug window is created)
  sendBufferedApiCalls(debugWindow) {
    if (this.apiCallHistory.length > 0 && debugWindow && !debugWindow.isDestroyed()) {
      this.logger?.info(`[DEBUG EVENT] Sending ${this.apiCallHistory.length} stored API calls to newly opened debug window`);
      for (const storedCall of this.apiCallHistory) {
        debugWindow.webContents.send('debug-event-received', 'api:call', storedCall);
      }
      // Note: Do NOT clear the history after sending - keep it persistent
    } else if (this.apiCallHistory.length === 0) {
      this.logger?.debug(`[DEBUG EVENT] No stored API calls to send to debug window`);
    }
  }

  // Clear API call history (called on course load, reset, etc.)
  clearApiCallHistory() {
    const clearedCount = this.apiCallHistory.length;
    this.apiCallHistory = [];
    this.logger?.info(`[DEBUG EVENT] Cleared ${clearedCount} API calls from history`);
  }

  // Get current API call history (for debugging)
  getApiCallHistory() {
    return [...this.apiCallHistory]; // Return copy to prevent external modification
  }


  // SCORM CAM processing handler (new)
  async handleProcessScormManifest(event, folderPath, manifestContent) {
    const scormService = this.getDependency('scormService');
    return await scormService.processScormManifest(folderPath, manifestContent);
  }

  // SN Service handlers
  async handleSNGetStatus(event) {
    const scormService = this.getDependency('scormService');
    const snService = scormService.getSNService();
    if (snService) {
      const status = snService.getStatus();
      return { success: true, ...status };
    } else {
      return { success: false, error: 'SN service not available' };
    }
  }

  // --- End of merged IpcHandlers methods ---
}

module.exports = IpcHandler;