/**
 * IPC Handler Service
 * 
 * Centralizes all Inter-Process Communication handling between main and renderer
 * processes. Provides message routing, validation, security enforcement, and
 * error handling for all IPC operations.
 * 
 * @fileoverview IPC communication service for SCORM Tester main process
 */

const { ipcMain } = require('electron');
const BaseService = require('./base-service');
const IpcHandlers = require('./ipc-handlers');
const { 
  SERVICE_DEFAULTS,
  SECURITY_CONFIG,
  SERVICE_EVENTS 
} = require('../../shared/constants/main-process-constants');
const { MAIN_PROCESS_ERRORS } = require('../../shared/constants/error-codes');

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
    this.handlerMethods = new IpcHandlers(this);
    this.rateLimitCleanupInterval = null;
  }

  /**
   * Validate dependencies
   */
  validateDependencies() {
    const fileManager = this.getDependency('fileManager');
    const scormService = this.getDependency('scormService');
    
    if (!fileManager) {
      this.logger?.error('IpcHandler: FileManager dependency missing');
      return false;
    }
    
    if (!scormService) {
      this.logger?.error('IpcHandler: ScormService dependency missing');
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
      this.registerHandler('scorm-initialize', this.handlerMethods.handleScormInitialize.bind(this.handlerMethods));
      this.registerHandler('scorm-get-value', this.handlerMethods.handleScormGetValue.bind(this.handlerMethods));
      this.registerHandler('scorm-set-value', this.handlerMethods.handleScormSetValue.bind(this.handlerMethods));
      this.registerHandler('scorm-commit', this.handlerMethods.handleScormCommit.bind(this.handlerMethods));
      this.registerHandler('scorm-terminate', this.handlerMethods.handleScormTerminate.bind(this.handlerMethods));
      
      // File operation handlers
      this.registerHandler('select-scorm-package', this.handlerMethods.handleSelectScormPackage.bind(this.handlerMethods));
      this.registerHandler('extract-scorm', this.handlerMethods.handleExtractScorm.bind(this.handlerMethods));
      this.registerHandler('save-temporary-file', this.handlerMethods.handleSaveTemporaryFile.bind(this.handlerMethods));
      this.registerHandler('find-scorm-entry', this.handlerMethods.handleFindScormEntry.bind(this.handlerMethods));
      this.registerHandler('get-course-info', this.handlerMethods.handleGetCourseInfo.bind(this.handlerMethods));
      this.registerHandler('get-course-manifest', this.handlerMethods.handleGetCourseManifest.bind(this.handlerMethods));
      
      // Validation and session handlers
      this.registerHandler('validate-scorm-compliance', this.handlerMethods.handleValidateScormCompliance.bind(this.handlerMethods));
      this.registerHandler('analyze-scorm-content', this.handlerMethods.handleAnalyzeScormContent.bind(this.handlerMethods));
      this.registerHandler('get-session-data', this.handlerMethods.handleGetSessionData.bind(this.handlerMethods));
      this.registerHandler('reset-session', this.handlerMethods.handleResetSession.bind(this.handlerMethods));
      this.registerHandler('get-all-sessions', this.handlerMethods.handleGetAllSessions.bind(this.handlerMethods));
      
      // LMS and testing handlers
      this.registerHandler('apply-lms-profile', this.handlerMethods.handleApplyLmsProfile.bind(this.handlerMethods));
      this.registerHandler('get-lms-profiles', this.handlerMethods.handleGetLmsProfiles.bind(this.handlerMethods));
      this.registerHandler('run-test-scenario', this.handlerMethods.handleRunTestScenario.bind(this.handlerMethods));
      
      // Utility handlers
      this.registerHandler('open-external', this.handlerMethods.handleOpenExternal.bind(this.handlerMethods));
      this.registerHandler('path-utils-to-file-url', this.handlerMethods.handlePathUtilsToFileUrl.bind(this.handlerMethods));
      this.registerSyncHandler('log-message', this.handlerMethods.handleLogMessage.bind(this.handlerMethods));
      
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
}

module.exports = IpcHandler;