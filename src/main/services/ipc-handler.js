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
const IPC_ROUTES = (() => {
  try {
    return require('./ipc/routes');
  } catch (e) {
    return [];
  }
})();

const OPEN_DEBUG_DEBOUNCE_MS = 500; // Define debounce constant

// Validation utilities
const IPC_VALIDATION = require('../../shared/utils/ipc-validation');
const IPC_RESULT = require('../../shared/utils/ipc-result');

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
    // IPC refactor feature flag (Phase 0)
    this.ipcRefactorEnabled = !!(this.config && this.config.IPC_REFACTOR_ENABLED);
    
    // Telemetry store, rate limiter, and SN snapshot service will be wired via dependencies (main)
    this.telemetryStore = null;
    this.rateLimiter = null;
    this.snSnapshotService = null;
    this.handlers = new Map();
    this.activeRequests = new Map();
    this.requestCounter = 0;
    this.rateLimitMap = new Map();
    this.securityConfig = SECURITY_CONFIG.IPC;
    // Removed this.handlerMethods = new IpcHandlers(this);
    this.rateLimitCleanupInterval = null;
 
    // No local telemetry buffer: telemetry is delegated to ScormInspectorTelemetryStore (constructed in main)
    this.maxHistorySize = 5000;
    this.sessionId = null; // Track current session for clearing
    

    // SNSnapshotService is owned and managed outside this handler (wired from main); no internal SN cache here
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

    // Wire optional dependencies provided by main (telemetryStore, snSnapshotService)
    try {
      const telemetry = this.getDependency('telemetryStore');
      if (telemetry) {
        this.telemetryStore = telemetry;
        // Ensure clean telemetry state on startup when telemetryStore is provided
        try { if (typeof this.telemetryStore.clear === 'function') { this.telemetryStore.clear(); } } catch (_) {}
      }
    } catch (_) {}
    
    
    // Subscribe to scorm-api-call-logged events from ScormService
    try {
      const scormService = this.getDependency('scormService');

      if (scormService && typeof scormService.onScormApiCallLogged === 'function') {
        scormService.onScormApiCallLogged((payload) => {
          this.broadcastScormApiCallLogged(payload);
        });
      } else {
        this.logger?.warn('[IPC Handler] ScormService or onScormApiCallLogged not available; cannot subscribe to API call events.');
      }

      // Subscribe to course:loaded and session:reset events from ScormService
      if (scormService && typeof scormService.eventEmitter === 'object' && typeof scormService.eventEmitter.on === 'function') {
        scormService.eventEmitter.on('course:loaded', (payload) => {
          if (this.telemetryStore) {
            this.telemetryStore.clear();
          }
          // Broadcast course loaded event to all windows (including inspector)
          const windowManager = this.getDependency('windowManager');
          if (windowManager && typeof windowManager.broadcastToAllWindows === 'function') {
            windowManager.broadcastToAllWindows('course-loaded', payload);
            this.logger?.debug('Broadcasted course-loaded event to all windows');
          }
        });
        scormService.eventEmitter.on('session:reset', (payload) => {
          if (this.telemetryStore) {
            this.telemetryStore.clear();
          }
          // Broadcast session state changed event to all windows (including inspector)
          const windowManager = this.getDependency('windowManager');
          if (windowManager && typeof windowManager.broadcastToAllWindows === 'function') {
            windowManager.broadcastToAllWindows('session-state-changed', payload);
            this.logger?.debug('Broadcasted session-state-changed event to all windows');
          }
        });
      } else {
        this.logger?.warn('[IPC Handler] ScormService eventEmitter not available; cannot subscribe to course load/reset events.');
      }
    } catch (e) {
      this.logger?.error('[IPC Handler] Error subscribing to ScormService events:', e?.message || e);
    }

    try {
      const snSnapshot = this.getDependency('snSnapshotService');
      if (snSnapshot) this.snSnapshotService = snSnapshot;
    } catch (_) {}

    // Ensure a rate limiter exists (fallback to local if not provided)
    if (!this.rateLimiter) {
      try {
        const RateLimiter = require('./ipc/rate-limiter');
        this.rateLimiter = new RateLimiter({ rateLimitWindow: this.config?.rateLimitWindow, rateLimitMax: this.config?.rateLimitMax });
      } catch (e) {
        this.rateLimiter = null;
      }
    }

    this.registerHandlers();
    this.setupRateLimitCleanup();

    // SNSnapshotService is preferred and owned by main; fetch SN status on-demand when not present.
    if (this.snSnapshotService && typeof this.snSnapshotService.startPolling === 'function') {
    } else {
      this.logger?.warn('IpcHandler: SNSnapshotService not present; SN status will be fetched on-demand (no internal poller)');
    }

  }

  /**
   * Shutdown IPC handler service
   */
  async doShutdown() {

    // Stop SN poller (delegate to SNSnapshotService when available)
    try {
      if (this.snSnapshotService && typeof this.snSnapshotService.stopPolling === 'function') {
        this.snSnapshotService.stopPolling();
      }
    } catch (_) {
      // swallow to keep shutdown clean
    }

    // 1) Terminate SCORM sessions FIRST (best-effort, silent)
    await this.terminateScormSessionsSafely();

    // 2) Clear API call history (from IpcHandlers) - now handled by ScormInspectorTelemetryStore

    // 3) Unregister handlers AFTER SCORM termination
    this.unregisterHandlers();
    this.activeRequests.clear();
    this.rateLimitMap.clear();

    // 4) Clear the rate limit cleanup interval
    if (this.rateLimitCleanupInterval) {
      clearInterval(this.rateLimitCleanupInterval);
      this.rateLimitCleanupInterval = null;
    }

  }

  /**
   * Register critical IPC handlers that must always be available
   */
  _registerCriticalHandlers() {
    const { ipcMain } = require('electron');
    
    // Register logging handlers directly to bypass any potential issues
    try {
      ipcMain.handle('renderer-log-info', async (_event, ...args) => { 
        try { this.logger?.info(...args); } catch (e) {} 
        return { success: true }; 
      });
      ipcMain.handle('renderer-log-warn', async (_event, ...args) => { 
        try { this.logger?.warn(...args); } catch (e) {} 
        return { success: true }; 
      });
      ipcMain.handle('renderer-log-error', async (_event, ...args) => { 
        try { this.logger?.error(...args); } catch (e) {} 
        return { success: true }; 
      });
      ipcMain.handle('renderer-log-debug', async (_event, ...args) => { 
        try { this.logger?.debug(...args); } catch (e) {} 
        return { success: true }; 
      });
    } catch (e) {
      // Even if this fails, continue with other handlers
    }
  }

  /**
   * Register all IPC channel handlers
   */
  registerHandlers() {
    // Register critical logging handlers first to ensure they're always available
    this._registerCriticalHandlers();

    const declarativeChannelSet = new Set((IPC_ROUTES || []).map(r => r.channel));
    try {
      // SCORM API handlers
      this.registerHandler('scorm-initialize', this.handleScormInitialize.bind(this));
      this.registerHandler('scorm-get-value', this.handleScormGetValue.bind(this));
      this.registerHandler('scorm-set-value', this.handleScormSetValue.bind(this));
      this.registerHandler('scorm-commit', this.handleScormCommit.bind(this));
      this.registerHandler('scorm-terminate', this.handleScormTerminate.bind(this));

      // Browse Mode handlers
      this.registerHandler('browse-mode-enable', this.handleBrowseModeEnable.bind(this));
      this.registerHandler('browse-mode-disable', this.handleBrowseModeDisable.bind(this));
      this.registerHandler('browse-mode-status', this.handleBrowseModeStatus.bind(this));
      this.registerHandler('browse-mode-create-session', this.handleBrowseModeCreateSession.bind(this));
      
      // File operation handlers
      this.registerHandler('select-scorm-package', this.handleSelectScormPackage.bind(this));
      this.registerHandler('select-scorm-folder', this.handleSelectScormFolder.bind(this));
      this.registerHandler('extract-scorm', this.handleExtractScorm.bind(this));
      this.registerHandler('prepare-course-source', this.handlePrepareCourseSource.bind(this));
      this.registerHandler('save-temporary-file', this.handleSaveTemporaryFile.bind(this));
      this.registerHandler('find-scorm-entry', this.handleFindScormEntry.bind(this));
      this.registerHandler('get-course-info', this.handleGetCourseInfo.bind(this));
      this.registerHandler('get-course-manifest', this.handleGetCourseManifest.bind(this));
      
      // Recent Courses handlers
      this.registerHandler('recent:get', this.handleRecentGet.bind(this));
      this.registerHandler('recent:addOrUpdate', this.handleRecentAddOrUpdate.bind(this));
      this.registerHandler('recent:remove', this.handleRecentRemove.bind(this));
      this.registerHandler('recent:clear', this.handleRecentClear.bind(this));

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
      this.registerHandler('sn:getSequencingState', this.handleSNGetSequencingState.bind(this));
      this.registerHandler('sn:initialize', this.handleSNInitialize.bind(this));
      this.registerHandler('sn:processNavigation', this.handleSNProcessNavigation.bind(this));
      this.registerHandler('sn:updateActivityProgress', this.handleSNUpdateActivityProgress.bind(this));
      this.registerHandler('sn:reset', this.handleSNReset.bind(this));
      this.registerHandler('sn:handleActivityExit', this.handleSNActivityExit.bind(this));
      this.registerHandler('sn:updateActivityLocation', this.handleSNUpdateActivityLocation.bind(this));
      
      // LMS and testing handlers
      this.registerHandler('apply-lms-profile', this.handleApplyLmsProfile.bind(this));
      this.registerHandler('get-lms-profiles', this.handleGetLmsProfiles.bind(this));
      this.registerHandler('run-test-scenario', this.handleRunTestScenario.bind(this));
      
      // Utility handlers
      this.registerHandler('open-external', this.handleOpenExternal.bind(this));
      this.registerHandler('path-to-file-url', this.handlePathUtilsToFileUrl.bind(this));
      this.registerHandler('get-app-root', this.handleGetAppRoot.bind(this));
      this.registerHandler('path-normalize', this.handlePathNormalize.bind(this));
      this.registerHandler('path-join', this.handlePathJoin.bind(this));
      // SCORM Inspector window management
      this.registerHandler('open-scorm-inspector-window', this.handleOpenScormInspectorWindow.bind(this));
      
      // SCORM Inspector history fetch - returns newest-first entries with optional filters
      this.registerHandler('scorm-inspector-get-history', this.handleScormInspectorGetHistory.bind(this));
      
      // Enhanced SCORM Inspector data retrieval handlers
      this.registerHandler('scorm-inspector-get-activity-tree', this.handleScormInspectorGetActivityTree.bind(this));
      this.registerHandler('scorm-inspector-get-navigation-requests', this.handleScormInspectorGetNavigationRequests.bind(this));
      this.registerHandler('scorm-inspector-get-global-objectives', this.handleScormInspectorGetGlobalObjectives.bind(this));
      this.registerHandler('scorm-inspector-get-ssp-buckets', this.handleScormInspectorGetSSPBuckets.bind(this));

      // Logger adapter loader for renderer fallback
      this.registerHandler('load-shared-logger-adapter', this.handleLoadSharedLoggerAdapter.bind(this));

      // App quit handler
      this.registerHandler('quit-app', this.handleQuitApp.bind(this));

      // Direct renderer logging channels already registered in _registerCriticalHandlers()
      
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
    // Try declarative routing first
    try {
      const routes = IPC_ROUTES || [];
      const route = routes.find(r => r.channel === channel);
      if (route) {
        const wrapped = require('./ipc/wrapper-factory').createWrappedHandler(route, this);
        if (!wrapped) {
          this.logger?.error(`IpcHandler: Failed to create wrapped handler for ${channel}, falling back to legacy`);
          throw new Error(`Failed to create wrapped handler for ${channel}`);
        }
        ipcMain.handle(channel, wrapped);
        this.handlers.set(channel, wrapped);
        return;
      }
    } catch (e) {
      this.logger?.error(`IpcHandler: Declarative route registration failed for ${channel}:`, e?.message || e);
      // Fall back to legacy routing on error
    }

    if (!this.securityConfig?.allowedChannels?.includes(channel)) {
      this.logger?.error(`IpcHandler: Channel ${channel} not in allowed channels list`);
      throw new Error(`Channel ${channel} not in allowed channels list`);
    }

    try {
      const wrappedHandler = this.wrapHandler(channel, handler);
      ipcMain.handle(channel, wrappedHandler);
      this.handlers.set(channel, wrappedHandler);
    } catch (error) {
      this.logger?.error(`IpcHandler: Failed to register handler for ${channel}:`, error);
      throw error;
    }
  }

  /**
   * Register synchronous IPC handler
   */
  registerSyncHandler(channel, handler) {
    if (!this.securityConfig.allowedChannels.includes(channel)) {
      throw new Error(`Channel ${channel} not in allowed channels list`);
    }

    // Prefer registering sync channels via async handle wrapper to normalize behavior.
    // This preserves channel names while avoiding blocking sync IPC listeners.
    try {
      const wrapped = this.wrapHandler(channel, handler);
      ipcMain.handle(channel, wrapped);
      this.handlers.set(channel, wrapped);
      this.logger?.debug(`IpcHandler: Registered sync channel as async handler for channel: ${channel}`);
      return;
    } catch (e) {
      // Fallback to legacy sync on error
      const wrappedHandler = this.wrapSyncHandler(channel, handler);
      ipcMain.on(channel, wrappedHandler);
      this.handlers.set(channel, wrappedHandler);
      this.logger?.debug(`IpcHandler: Registered sync handler (fallback) for channel: ${channel}`);
    }
  }

  /**
   * Wrap handler with security and validation
   */
  wrapHandler(channel, handler) {
    // Open-debug-window coalescing/debounce handled by the declarative routes + wrapper-factory.
    // Legacy in-handler guards removed to centralize behavior.
    return async (event, ...args) => {
      const requestId = ++this.requestCounter;
      const startTime = Date.now();
 
      try {
        if (!this.validateRequest(event, channel, args)) {
          throw new Error('Request validation failed');
        }

        // Do NOT apply generic rate limiting to core SN channels; let handlers/SN enforce correctness.
        // Exempted SN channels:
        //   - sn:getStatus (cache-only, already simplified)
        //   - sn:processNavigation (sequenced by SN)
        //   - sn:initialize (one-time init)
        //   - sn:updateActivityProgress (driven by content runtime)
        //   - sn:reset (admin/reset)
        const snBypass = (
          channel === 'sn:getStatus' ||
          channel === 'sn:processNavigation' ||
          channel === 'sn:initialize' ||
          channel === 'sn:updateActivityProgress' ||
          channel === 'sn:reset'
        );
        if (!snBypass) {
          // Rate limit check with channel policies (pass channel for SCORM-aware exemptions)
          const rateAllowed = this.checkRateLimit(event.sender, channel);
          if (!rateAllowed) {
            // Initialize per-channel suppression map once
            if (!this._rateLimitLogState) this._rateLimitLogState = new Map();
            const markSuppressed = (ch) => {
              let st = this._rateLimitLogState.get(ch);
              if (!st) {
                st = { firstSeenAt: Date.now(), notified: false, suppressed: false };
                this._rateLimitLogState.set(ch, st);
              }
              if (!st.notified) {
                st.notified = true;
                st.suppressed = true;
                this.logger?.info(`IpcHandler: rate-limit engaged on ${ch}; further rate-limit logs suppressed for this session`);
              }
            };

          const isRendererLogChannel =
            channel === 'renderer-log-debug' ||
            channel === 'renderer-log-info' ||
            channel === 'renderer-log-warn' ||
            channel === 'renderer-log-error';

          const isScormChannel =
            channel === 'scorm-set-value' ||
            channel === 'scorm-commit' ||
            channel === 'scorm-terminate';

          if (isRendererLogChannel || isScormChannel) {
            markSuppressed(channel);
            this.recordOperation(`${channel}:rate_limited_soft_ok`, true);
            return { success: true, rateLimited: true };
          }

          

          // Otherwise, enforce
          throw new Error('Rate limit exceeded');
        }
        } // end non-SN bypass branch

        this.activeRequests.set(requestId, { channel, startTime, event });

        

        this.logger?.debug(`IpcHandler: Processing ${channel} request ${requestId}`);
        this.emit(SERVICE_EVENTS.IPC_MESSAGE_RECEIVED, { channel, requestId });

        const result = await handler(event, ...args);

        const duration = Date.now() - startTime;
        // IPC envelope log
        this.logger?.info(`IPC_ENVELOPE { channel: ${channel}, requestId: ${requestId}, durationMs: ${duration}, status: 'success' }`);
        this.recordOperation(`${channel}:success`, true);
        this.logger?.debug(`IpcHandler: ${channel} request ${requestId} completed in ${duration}ms`);

        return result;

      } catch (error) {
        const duration = Date.now() - startTime;
        // IPC envelope log for error case
        this.logger?.error(`IPC_ENVELOPE { channel: ${channel}, requestId: ${requestId}, durationMs: ${duration}, status: 'error', error: ${error && error.message ? error.message : 'unknown'} }`);
 
        const isRateLimit = (error && typeof error.message === 'string' && error.message.includes('Rate limit exceeded'));
        const isScormChannel = (channel === 'scorm-set-value' || channel === 'scorm-commit' || channel === 'scorm-terminate');

        if (isRateLimit && isScormChannel) {
          this.recordOperation(`${channel}:rate_limited_soft_ok`, true);
          return { success: true, rateLimited: true };
        }

        

        // Default error path
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
  /**
   * Check rate limiting for sender with SCORM-aware exemptions.
   * We allow a brief burst grace period for SCORM API calls immediately after Initialize,
   * and we never rate-limit scorm-get-value during that grace window.
   */
  checkRateLimit(sender, channel = null) {
  if (!this.config.enableRateLimiting) {
    return true;
  }

  // Route through rate limiter (Phase 2)
  try {
    const scormService = this.getDependency('scormService');
    const allowed = this.rateLimiter ? this.rateLimiter.allow(sender, channel, { scormService }) : true;
    if (!allowed) {
      this.logger?.info(`IpcHandler: rate limit hit on channel ${channel} for sender ${sender?.id}`);
      return false;
    }
  } catch (_) {
    // If limiter fails, fall back to allowing (to avoid hard failures)
  }

  // Rate limiter handles SCORM grace window and SN exemptions internally
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

  // SNSnapshotService polling logic removed from IpcHandler; main-owned SNSnapshotService handles polling and caching.

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
  async handleScormInitialize(event, sessionId, options = {}) {
    const scormService = this.getDependency('scormService');
    return await scormService.initializeSession(sessionId, options);
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

  // Browse Mode handlers
  async handleBrowseModeEnable(event, options = {}) {
    try {
      const scormService = this.getDependency('scormService');
      if (!scormService) {
        return {
          success: false,
          error: 'SCORM service not available'
        };
      }

      const result = await scormService.enableBrowseMode(options);
      this.logger?.debug('Browse mode enable result:', result);
      return result;
    } catch (error) {
      this.logger?.error('Failed to enable browse mode:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async handleBrowseModeDisable(event) {
    try {
      const scormService = this.getDependency('scormService');
      if (!scormService) {
        return {
          success: false,
          error: 'SCORM service not available'
        };
      }

      const result = await scormService.disableBrowseMode();
      this.logger?.debug('Browse mode disable result:', result);
      return result;
    } catch (error) {
      this.logger?.error('Failed to disable browse mode:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async handleBrowseModeStatus(event) {
    try {
      const scormService = this.getDependency('scormService');
      if (!scormService) {
        return {
          enabled: false,
          error: 'SCORM service not available'
        };
      }

      const status = scormService.getBrowseModeStatus();
      this.logger?.debug('Browse mode status:', status);
      return status;
    } catch (error) {
      this.logger?.error('Failed to get browse mode status:', error.message);
      return {
        enabled: false,
        error: error.message
      };
    }
  }

  async handleBrowseModeCreateSession(event, options = {}) {
    try {
      const scormService = this.getDependency('scormService');
      if (!scormService) {
        return {
          success: false,
          error: 'SCORM service not available'
        };
      }

      // Set browse mode options
      const sessionOptions = {
        launchMode: 'browse',
        memoryOnlyStorage: true,
        ...options
      };

      const result = await scormService.createSessionWithBrowseMode(sessionOptions);
      this.logger?.debug('Browse mode session creation result:', result);
      return result;
    } catch (error) {
      this.logger?.error('Failed to create browse mode session:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async handleScormTerminate(event, sessionId) {
    const scormService = this.getDependency('scormService');
    try {
      const result = await scormService.terminate(sessionId);
      // Normalize success shape
      return (result && typeof result === 'object') ? result : { success: true };
    } catch (e) {
      // During controlled shutdown, avoid noisy errors; return soft-ok
      const msg = (e && e.message) ? e.message : String(e);
      if (msg && (msg.includes('already terminated') || msg.includes('window destroyed') || msg.includes('webContents destroyed'))) {
        return { success: true, alreadyTerminated: true };
      }
      // If shutdown is underway (handlers being removed), also soft-ok
      if (!this.handlers || this.handlers.size === 0) {
        return { success: true, lateShutdown: true };
      }
      // For other cases, rethrow so upstream error handling applies
      throw e;
    }
  }

  // File operation handlers
  async handleSelectScormPackage(event) {
    const fileManager = this.getDependency('fileManager');
    return await fileManager.selectScormPackage();
  }

  async handleSelectScormFolder(event) {
    const fileManager = this.getDependency('fileManager');
    if (!fileManager || typeof fileManager.selectScormFolder !== 'function') {
      this.logger?.error('IpcHandler: FileManager.selectScormFolder not available');
      return { success: false, error: 'FileManager.selectScormFolder not available' };
    }
    return await fileManager.selectScormFolder();
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

  async handlePrepareCourseSource(event, source) {
    const fileManager = this.getDependency('fileManager');
    return await fileManager.prepareCourseSource(source);
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

  async handleLoadSharedLoggerAdapter(_event) {
    try {
      // Lazy-require the shared singleton logger getter
      // eslint-disable-next-line global-require, import/no-commonjs
      const getLogger = require('../../shared/utils/logger.js');

      // Prefer the same directory used by the main logger initialization
      // Derive from the existing logger if possible so both write to the same app.log.
      let logDir = null;

      try {
        // Best effort: extract directory from our logger's configured file path if available
        if (this.logger && this.logger.logFile) {
          logDir = path.dirname(this.logger.logFile);
        }
      } catch (_) {
        // ignore
      }

      // Fallbacks if we couldn't infer from the existing logger
      if (!logDir) {
        if (process.env && process.env.SCORM_TESTER_LOG_DIR) {
          logDir = process.env.SCORM_TESTER_LOG_DIR;
        } else if (process.env && process.env.APPDATA) {
          logDir = path.join(process.env.APPDATA, 'scorm-tester');
        } else {
          logDir = path.join(process.cwd(), 'logs');
        }
      }

      // Singleton the instance within this service (using shared getter ensures single process-wide instance)
      if (!this._sharedLoggerInstance) {
        this._sharedLoggerInstance = getLogger(logDir);
      }

      const inst = this._sharedLoggerInstance;

      // Return a minimal proxy object with methods used by the renderer
      return {
        info: (message, ...args) => inst.info(message, ...args),
        warn: (message, ...args) => inst.warn(message, ...args),
        error: (message, ...args) => inst.error(message, ...args),
        debug: (message, ...args) => inst.debug(message, ...args),
      };
    } catch (e) {
      // Return no-op methods to prevent renderer crashes
      this.logger?.error('IpcHandler: Failed to provide logger adapter to renderer', e?.message || e);
      return {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
      };
    }
  }
 
  async handlePathUtilsToFileUrl(event, filePath) {
    try {
      const appRoot = PathUtils.normalize(path.resolve(__dirname, '../../../'));
      const tempRoot = PathUtils.normalize(require('os').tmpdir());
      const canonicalTempRoot = PathUtils.normalize(path.join(tempRoot, 'scorm-tester'));
      
      const normalizedPath = PathUtils.normalize(filePath);
      
      // Check if path is within app root
      if (normalizedPath.startsWith(appRoot)) {
        const url = PathUtils.toScormProtocolUrl(filePath, appRoot);
        return { success: true, url };
      }
      
      // Check if path is within canonical temp root
      if (normalizedPath.startsWith(canonicalTempRoot)) {
        const url = PathUtils.toScormProtocolUrl(filePath, canonicalTempRoot);
        return { success: true, url };
      }
      
      // Path is not within allowed roots
      return { 
        success: false, 
        error: `Path outside allowed roots (app: ${appRoot}, temp: ${canonicalTempRoot}): ${normalizedPath}` 
      };
    } catch (error) {
      return { 
        success: false, 
        error: error.message || String(error) 
      };
    }
  }

  async handleGetAppRoot(event) {
    return PathUtils.normalize(path.resolve(__dirname, '../../../'));
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

  

  async handleScormInspectorGetHistory(event, { limit, offset, sinceTs, methodFilter } = {}) {
    this.logger?.debug(`IpcHandler: handleScormInspectorGetHistory called with limit: ${limit}, offset: ${offset}, sinceTs: ${sinceTs}, methodFilter: ${methodFilter}`);
    
    if (this.telemetryStore && typeof this.telemetryStore.getHistory === 'function') {
      try {
        const historyResponse = this.telemetryStore.getHistory({ limit, offset, sinceTs, methodFilter });
        const errorsResponse = this.telemetryStore.getErrors ? this.telemetryStore.getErrors() : { errors: [] };
        
        // Get current data model from active SCORM session
        let dataModel = {};
        const scormService = this.getDependency('scormService');
        if (scormService && typeof scormService.getCurrentDataModel === 'function') {
          try {
            dataModel = scormService.getCurrentDataModel() || {};
            this.logger?.debug(`IpcHandler: getCurrentDataModel returned object with keys: ${Object.keys(dataModel)}`);
          } catch (e) {
            this.logger?.warn('Failed to get current data model:', e.message);
          }
        } else {
          this.logger?.warn('IpcHandler: SCORM service or getCurrentDataModel method not available');
        }
        
        const responseData = {
          history: historyResponse.history || [],
          errors: errorsResponse.errors || [],
          dataModel: dataModel
        };
        
        return { success: true, data: responseData };
      } catch (error) {
        this.logger?.error(`IpcHandler: handleScormInspectorGetHistory failed: ${error.message}`);
        return { success: false, error: error.message, data: { history: [], errors: [], dataModel: {} } };
      }
    }
    
    // Fallback when telemetry store not available
    return { success: true, data: { history: [], errors: [], dataModel: {} } };
  }

  /**
   * Gracefully terminate all SCORM sessions if available on scormService.
   * Used during app shutdown to avoid noisy termination errors.
   */
  async terminateScormSessionsSafely() {
    try {
      const scormService = this.getDependency('scormService');
      if (!scormService) return;

      // Preferred fast path
      if (typeof scormService.terminateAllSessions === 'function') {
        const TERMINATE_TIMEOUT_MS = 1500;
        const p = Promise.resolve().then(() => scormService.terminateAllSessions({ silent: true }));
        await Promise.race([
          p.catch(() => {}), // swallow individual errors
          new Promise(res => setTimeout(res, TERMINATE_TIMEOUT_MS))
        ]);
        return;
      }

      // Fallback: try known method names if terminateAllSessions is not implemented
      const candidates = ['shutdown', 'terminate', 'closeAllSessions'];
      for (const m of candidates) {
        if (typeof scormService[m] === 'function') {
          try {
            await Promise.resolve().then(() => scormService[m]({ silent: true }));
            break;
          } catch (_) {
            // try next candidate
          }
        }
      }
    } catch (_) {
      // swallow to keep shutdown clean
    }
  }






  // SCORM CAM processing handler (new)
  async handleProcessScormManifest(event, folderPath, manifestContent) {
    const scormService = this.getDependency('scormService');
    return await scormService.processScormManifest(folderPath, manifestContent);
  }

  // SN Service handlers
  async handleSNGetStatus(event) {
    // Prefer SNSnapshotService status if available
    if (this.snSnapshotService && typeof this.snSnapshotService.getStatus === 'function') {
      return this.snSnapshotService.getStatus();
    }

    // Fallback: attempt to call SN service directly on-demand (no internal poller/cache)
    try {
      const scormService = this.getDependency('scormService');
      const snService = scormService && typeof scormService.getSNService === 'function'
        ? scormService.getSNService()
        : null;
      if (snService && typeof snService.getStatus === 'function') {
        const status = await Promise.resolve().then(() => snService.getStatus());
        return { success: true, ...status };
      }
    } catch (_) {
      // ignore and return safe default
    }

    // Safe default when no SN info available
    return { success: true, initialized: false, sessionState: 'not_initialized', availableNavigation: [] };
  }

  async handleSNGetSequencingState(event) {
    const scormService = this.getDependency('scormService');
    const snService = scormService.getSNService();
    if (!snService) {
      return { success: false, error: 'SN service not available' };
    }
    const state = snService.getSequencingState();
    return { success: true, ...state };
  }

  async handleSNInitialize(event, { manifest, packageInfo } = {}) {
    const scormService = this.getDependency('scormService');
    const snService = scormService.getSNService();
    if (!snService) {
      return { success: false, error: 'SN service not available' };
    }
    const result = await snService.initialize(manifest, packageInfo || {});
    return result;
  }

  async handleSNProcessNavigation(event, { navigationRequest, targetActivityId } = {}) {
    const scormService = this.getDependency('scormService');
    const snService = scormService.getSNService();
    if (!snService) {
      return { success: false, error: 'SN service not available' };
    }
    const result = await snService.processNavigation(navigationRequest, targetActivityId || null);
    return result;
  }

  async handleSNRefreshNavigation(event) {
    const scormService = this.getDependency('scormService');
    const snService = scormService.getSNService();
    if (!snService) {
      return { success: false, error: 'SN service not available' };
    }
    const result = snService.refreshNavigationAvailability();
    return { success: true, ...result };
  }

  async handleSNUpdateActivityProgress(event, { activityId, progressData } = {}) {
    const scormService = this.getDependency('scormService');
    const snService = scormService.getSNService();
    if (!snService) {
      return { success: false, error: 'SN service not available' };
    }
    const result = snService.updateActivityProgress(activityId, progressData || {});
    return result;
  }

  async handleSNReset(event) {
    const scormService = this.getDependency('scormService');
    const snService = scormService.getSNService();
    if (!snService) {
      return { success: false, error: 'SN service not available' };
    }
    snService.reset();
    return { success: true };
  }

  // BUG-004 FIX: SN Activity Exit Handler
  async handleSNActivityExit(event, { activityId, exitType } = {}) {
    const scormService = this.getDependency('scormService');
    const snService = scormService.getSNService();
    if (!snService) {
      return { success: false, error: 'SN service not available' };
    }
    const result = snService.handleActivityExit(activityId, exitType || 'navigation');
    return result;
  }

  // BUG-004 FIX: SN Activity Location Update Handler
  async handleSNUpdateActivityLocation(event, { activityId, location } = {}) {
    const scormService = this.getDependency('scormService');
    const snService = scormService.getSNService();
    if (!snService) {
      return { success: false, error: 'SN service not available' };
    }
    const result = snService.updateActivityLocation(activityId, location);
    return result;
  }

  // Recent Courses handlers
  async handleRecentGet() {
    const recentCoursesService = this.getDependency('recentCoursesService');
    if (!recentCoursesService) {
      return { success: false, error: 'RecentCoursesService not available' };
    }
    const recents = await recentCoursesService.getRecents();
    return { success: true, recents };
  }

  async handleRecentAddOrUpdate(_event, course) {
    const recentCoursesService = this.getDependency('recentCoursesService');
    if (!recentCoursesService) {
      return { success: false, error: 'RecentCoursesService not available' };
    }
    const recents = await recentCoursesService.addOrUpdateRecent(course);
    return { success: true, recents };
  }

  async handleRecentRemove(_event, type, coursePath) {
    const recentCoursesService = this.getDependency('recentCoursesService');
    if (!recentCoursesService) {
      return { success: false, error: 'RecentCoursesService not available' };
    }
    const recents = await recentCoursesService.removeRecent(type, coursePath);
    return { success: true, recents };
  }

  async handleRecentClear() {
    const recentCoursesService = this.getDependency('recentCoursesService');
    if (!recentCoursesService) {
      return { success: false, error: 'RecentCoursesService not available' };
    }
    const recents = await recentCoursesService.clearRecents();
    return { success: true, recents };
  }

  // --- End of merged IpcHandlers methods ---
  /**
   * Broadcasts a SCORM API call logged event to all active renderer windows.
   * This uses the canonical SCORM Inspector IPC channel so renderer windows
   * (including the SCORM Inspector) receive inspection data via the approved path.
   * @param {Object} payload - The event payload containing API call details.
   */
  broadcastScormApiCallLogged(payload) {
    try {
      const windowManager = this.getDependency('windowManager');
      if (windowManager && typeof windowManager.getAllWindows === 'function') {
        const windows = windowManager.getAllWindows();
        let sent = 0;
        for (const w of windows) {
          if (w && !w.isDestroyed()) {
            try {
              w.webContents.send('scorm-inspector-data-updated', payload);
              sent++;
            } catch (err) {
              this.logger?.warn(`[IPC Handler] Failed to send scorm-inspector-data-updated to window ${w?.id}`, err?.message || err);
            }
          }
        }
        this.logger?.debug(`[IPC Handler] Broadcasted scorm-inspector-data-updated to ${sent} windows`);
      } else if (windowManager) {
        // Fallback: iterate internal map (older WindowManager implementations)
        for (const window of windowManager.windows.values()) {
          if (window && !window.isDestroyed()) {
            window.webContents.send('scorm-inspector-data-updated', payload);
          }
        }
        this.logger?.debug('[IPC Handler] Broadcasted scorm-inspector-data-updated via fallback window iteration');
      } else {
        this.logger?.warn('[IPC Handler] WindowManager not available for broadcasting SCORM Inspector data.');
      }
    } catch (e) {
      this.logger?.error('[IPC Handler] Error broadcasting SCORM Inspector data:', e?.message || e);
    }
  }

  

  async handleOpenScormInspectorWindow(event) {
    const windowManager = this.getDependency('windowManager');
    if (!windowManager) {
      this.logger?.warn('IpcHandler: WindowManager dependency not available for open-scorm-inspector-window');
      return { success: false, error: 'WindowManager not available' };
    }

    try {
      // Check if SCORM Inspector window already exists
      const inspectorWindow = windowManager.getWindow('scorm-inspector');
      if (inspectorWindow && !inspectorWindow.isDestroyed()) {
        inspectorWindow.focus();
        this.logger?.info('IpcHandler: Focused existing SCORM Inspector window');
        this.recordOperation('open-scorm-inspector-window:focused', true);
        return { success: true, focused: true };
      } else {
        if (typeof windowManager.createScormInspectorWindow === 'function') {
          await windowManager.createScormInspectorWindow();
        }
        this.logger?.info('IpcHandler: Created new SCORM Inspector window');
        this.recordOperation('open-scorm-inspector-window:created', true);
        return { success: true, created: true };
      }
    } catch (error) {
      this.logger?.error('IpcHandler: Failed to open SCORM Inspector window:', error);
      this.recordOperation('open-scorm-inspector-window:error', false);
      return { success: false, error: error.message };
    }
  }

  // Enhanced SCORM Inspector data retrieval methods

  /**
   * Get activity tree structure for SCORM Inspector
   */
  async handleScormInspectorGetActivityTree(event, { sessionId } = {}) {
    this.logger?.debug(`IpcHandler: handleScormInspectorGetActivityTree called with sessionId: ${sessionId}`);
    
    try {
      const scormService = this.getDependency('scormService');
      if (!scormService) {
        return { success: false, error: 'SCORM Service not available', data: {} };
      }

      // Get SN service which manages activity trees
      const snService = scormService.snService;
      if (!snService || !snService.activityTreeManager || !snService.activityTreeManager.root) {
        return { success: true, data: {} }; // No activity tree loaded yet
      }

      // Convert activity tree to serializable format for inspector
      const activityTreeData = this.serializeActivityTree(snService.activityTreeManager);
      
      return { success: true, data: activityTreeData };
    } catch (error) {
      this.logger?.error(`IpcHandler: handleScormInspectorGetActivityTree failed: ${error.message}`);
      return { success: false, error: error.message, data: {} };
    }
  }

  /**
   * Get navigation requests analysis for SCORM Inspector
   */
  async handleScormInspectorGetNavigationRequests(event, { sessionId } = {}) {
    this.logger?.debug(`IpcHandler: handleScormInspectorGetNavigationRequests called with sessionId: ${sessionId}`);
    
    try {
      const scormService = this.getDependency('scormService');
      if (!scormService) {
        return { success: false, error: 'SCORM Service not available', data: [] };
      }

      // Get navigation analysis from SN service
      const snService = scormService.snService;
      if (!snService || !snService.navigationHandler) {
        return { success: true, data: [] }; // No navigation data yet
      }

      // Get navigation request analysis
      const navigationData = this.extractNavigationRequests(snService.navigationHandler);
      
      return { success: true, data: navigationData };
    } catch (error) {
      this.logger?.error(`IpcHandler: handleScormInspectorGetNavigationRequests failed: ${error.message}`);
      return { success: false, error: error.message, data: [] };
    }
  }

  /**
   * Get global objectives for SCORM Inspector
   */
  async handleScormInspectorGetGlobalObjectives(event, { sessionId } = {}) {
    this.logger?.debug(`IpcHandler: handleScormInspectorGetGlobalObjectives called with sessionId: ${sessionId}`);
    
    try {
      const scormService = this.getDependency('scormService');
      if (!scormService) {
        return { success: false, error: 'SCORM Service not available', data: [] };
      }

      // Get global objectives from activity tree
      const snService = scormService.snService;
      if (!snService || !snService.activityTree) {
        return { success: true, data: [] }; // No objectives yet
      }

      // Extract global objectives
      const objectivesData = this.extractGlobalObjectives(snService.activityTree);
      
      return { success: true, data: objectivesData };
    } catch (error) {
      this.logger?.error(`IpcHandler: handleScormInspectorGetGlobalObjectives failed: ${error.message}`);
      return { success: false, error: error.message, data: [] };
    }
  }

  /**
   * Get SSP buckets for SCORM Inspector
   */
  async handleScormInspectorGetSSPBuckets(event, { sessionId } = {}) {
    this.logger?.debug(`IpcHandler: handleScormInspectorGetSSPBuckets called with sessionId: ${sessionId}`);
    
    try {
      const scormService = this.getDependency('scormService');
      if (!scormService) {
        return { success: false, error: 'SCORM Service not available', data: [] };
      }

      // Get SSP data from RTE service
      const rteInstances = scormService.rteInstances;
      if (!rteInstances || rteInstances.size === 0) {
        return { success: true, data: [] }; // No SSP data yet
      }

      // Extract SSP buckets from all active sessions
      const sspData = this.extractSSPBuckets(rteInstances);
      
      return { success: true, data: sspData };
    } catch (error) {
      this.logger?.error(`IpcHandler: handleScormInspectorGetSSPBuckets failed: ${error.message}`);
      return { success: false, error: error.message, data: [] };
    }
  }

  // Helper methods for data extraction and serialization

  /**
   * Serialize activity tree for inspector display
   */
  serializeActivityTree(activityTree) {
    if (!activityTree || !activityTree.root) {
      return {};
    }

    const serializeNode = (node) => {
      const serialized = {
        id: node.identifier,
        title: node.title,
        type: node.resource?.scormType || (node.children.length > 0 ? 'cluster' : 'activity'),
        status: this.getActivityCompletionStatus(node),
        children: []
      };

      // Add detailed information for inspector
      if (node.activityState || node.attemptState || node.attemptCount > 0) {
        serialized.details = {
          completionStatus: this.mapActivityState(node.activityState),
          successStatus: this.mapAttemptState(node.attemptState),
          progressMeasure: node.progressMeasure || 0,
          attempted: node.attemptCount > 0,
          attemptCount: node.attemptCount,
          suspended: node.suspended,
          objectives: Array.from(node.objectives?.values() || []).map(obj => ({
            id: obj.id,
            status: obj.satisfiedStatus ? 'satisfied' : 'not satisfied',
            score: obj.normalizedMeasure
          })),
          sequencingDefinition: {
            choice: node.sequencing?.choice !== false,
            flow: node.sequencing?.flow !== false,
            forwardOnly: node.sequencing?.forwardOnly === true
          }
        };
      }

      // Recursively serialize children
      if (node.children && node.children.length > 0) {
        serialized.children = node.children.map(child => serializeNode(child));
      }

      return serialized;
    };

    return serializeNode(activityTree.root);
  }

  /**
   * Extract navigation requests for analysis
   */
  extractNavigationRequests(navigationHandler) {
    if (!navigationHandler) return [];

    // Get available navigation requests
    const navRequests = [
      { type: 'Start', disabled: false, willAlwaysSucceed: true, willNeverSucceed: false, hidden: false },
      { type: 'Resume All', disabled: false, willAlwaysSucceed: false, willNeverSucceed: false, hidden: false },
      { type: 'Exit', disabled: false, willAlwaysSucceed: true, willNeverSucceed: false, hidden: false },
      { type: 'Exit All', disabled: false, willAlwaysSucceed: true, willNeverSucceed: false, hidden: false },
      { type: 'Suspend All', disabled: false, willAlwaysSucceed: true, willNeverSucceed: false, hidden: false },
      { type: 'Previous', disabled: true, willAlwaysSucceed: false, willNeverSucceed: true, hidden: false },
      { type: 'Continue', disabled: false, willAlwaysSucceed: false, willNeverSucceed: false, hidden: false }
    ];

    // Add activity-specific navigation requests if available
    if (navigationHandler.currentActivity) {
      navRequests.push({
        type: 'Choice',
        targetActivityId: navigationHandler.currentActivity.identifier,
        disabled: false,
        willAlwaysSucceed: false,
        willNeverSucceed: false,
        hidden: false
      });
    }

    return navRequests;
  }

  /**
   * Extract global objectives from activity tree
   */
  extractGlobalObjectives(activityTree) {
    if (!activityTree || !activityTree.globalObjectives) {
      return [];
    }

    const objectives = [];
    for (const [id, objective] of activityTree.globalObjectives.entries()) {
      objectives.push({
        id: id,
        status: objective.satisfiedStatus ? 'satisfied' : 'not satisfied',
        score: objective.normalizedMeasure || 0,
        progressMeasure: objective.progressMeasure || 0
      });
    }

    return objectives;
  }

  /**
   * Extract SSP buckets from RTE instances
   */
  extractSSPBuckets(rteInstances) {
    const sspBuckets = [];

    for (const [sessionId, rteInstance] of rteInstances.entries()) {
      if (rteInstance && rteInstance.dataModel) {
        const suspendData = rteInstance.dataModel.getValue('cmi.suspend_data');
        if (suspendData && suspendData.value) {
          sspBuckets.push({
            id: `session-${sessionId}`,
            size: new Blob([suspendData.value]).size,
            persistence: 'session',
            data: suspendData.value
          });
        }
      }
    }

    return sspBuckets;
  }

  // Utility methods for status mapping

  mapActivityState(state) {
    const stateMap = {
      'active': 'incomplete',
      'inactive': 'not attempted',
      'suspended': 'incomplete',
      'completed': 'completed'
    };
    return stateMap[state] || 'unknown';
  }

  mapAttemptState(state) {
    const stateMap = {
      'not_attempted': 'not attempted',
      'incomplete': 'incomplete',
      'completed': 'completed',
      'passed': 'passed',
      'failed': 'failed'
    };
    return stateMap[state] || 'unknown';
  }

  getActivityCompletionStatus(node) {
    if (node.attemptCount === 0) return 'not attempted';
    if (node.activityState === 'completed') return 'completed';
    if (node.suspended || node.activityState === 'active') return 'incomplete';
    return 'not attempted';
  }

  /**
   * Handle quit app request from renderer
   */
  async handleQuitApp(event) {
    try {
      this.logger?.info('IpcHandler: Received quit-app request from renderer');
      // Import app here to avoid circular dependencies
      const { app } = require('electron');
      app.quit();
      return { success: true };
    } catch (error) {
      this.logger?.error('IpcHandler: Failed to quit app:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = IpcHandler;
