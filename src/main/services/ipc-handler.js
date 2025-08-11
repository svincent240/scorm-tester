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
    // Initialize singleflight for open-debug-window (Phase 3)
    try {
      const SingleflightFactory = require('../../shared/utils/singleflight');
      this.openDebugSingleflight = (typeof SingleflightFactory === 'function') ? SingleflightFactory() : null;
    } catch (e) {
      this.openDebugSingleflight = null;
    }
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
 
    // No local telemetry buffer: telemetry is delegated to DebugTelemetryStore (constructed in main)
    this.maxHistorySize = 5000;
    this.sessionId = null; // Track current session for clearing
    this._openDebugGuards = { inFlight: false, lastAttemptTs: 0, pending: false, timer: null };

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
    this.logger?.debug('IpcHandler: Starting initialization');

    // Wire optional dependencies provided by main (telemetryStore, snSnapshotService)
    try {
      const telemetry = this.getDependency('telemetryStore');
      if (telemetry) {
        this.telemetryStore = telemetry;
        // Ensure clean telemetry state on startup when telemetryStore is provided
        try { if (typeof this.telemetryStore.clear === 'function') { this.telemetryStore.clear(); this.logger?.info('[DEBUG EVENT] telemetryStore cleared on startup'); } } catch (_) {}
      }
    } catch (_) {}
    
    // Diagnostic: log telemetry store wiring state for debug-event plumbing validation
    try {
      this.logger?.info(`[DEBUG EVENT] telemetryStore present: ${!!this.telemetryStore}, hasFlushTo: ${typeof this.telemetryStore?.flushTo === 'function'}`);
    } catch (_) {}
    
    // Subscribe to scorm-api-call-logged events from ScormService
    try {
      const scormService = this.getDependency('scormService');
      this.logger?.debug(`[IPC Handler] scormService in doInitialize: ${!!scormService}`);
      this.logger?.debug(`[IPC Handler] typeof scormService.onScormApiCallLogged: ${typeof scormService?.onScormApiCallLogged}`);
      this.logger?.debug(`[IPC Handler] typeof scormService.eventEmitter: ${typeof scormService?.eventEmitter}`);
      this.logger?.debug(`[IPC Handler] typeof scormService.eventEmitter.on: ${typeof scormService?.eventEmitter?.on}`);

      if (scormService && typeof scormService.onScormApiCallLogged === 'function') {
        scormService.onScormApiCallLogged((payload) => {
          this.logger?.debug('[IPC Handler] Received scorm-api-call-logged event from ScormService', payload);
          this.broadcastScormApiCallLogged(payload);
        });
        this.logger?.info('[IPC Handler] Subscribed to scorm-api-call-logged events from ScormService');
      } else {
        this.logger?.warn('[IPC Handler] ScormService or onScormApiCallLogged not available; cannot subscribe to API call events.');
      }

      // Subscribe to course:loaded and session:reset events from ScormService
      if (scormService && typeof scormService.eventEmitter === 'object' && typeof scormService.eventEmitter.on === 'function') {
        scormService.eventEmitter.on('course:loaded', (payload) => {
          this.logger?.info('[IPC Handler] Received course:loaded event from ScormService. Clearing telemetry store.');
          if (this.telemetryStore) {
            this.telemetryStore.clear();
          }
        });
        scormService.eventEmitter.on('session:reset', (payload) => {
          this.logger?.info('[IPC Handler] Received session:reset event from ScormService. Clearing telemetry store.');
          if (this.telemetryStore) {
            this.telemetryStore.clear();
          }
        });
        this.logger?.info('[IPC Handler] Subscribed to course:loaded and session:reset events from ScormService');
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
        const RateLimiter = require('./rate-limiter');
        this.rateLimiter = new RateLimiter({ rateLimitWindow: this.config?.rateLimitWindow, rateLimitMax: this.config?.rateLimitMax });
      } catch (e) {
        this.rateLimiter = null;
      }
    }

    this.logger?.debug(`IpcHandler: handleDebugGetHistory is ${typeof this.handleDebugGetHistory}`);
    this.registerHandlers();
    this.setupRateLimitCleanup();

    // SNSnapshotService is preferred and owned by main; fetch SN status on-demand when not present.
    if (this.snSnapshotService && typeof this.snSnapshotService.startPolling === 'function') {
      this.logger?.info('IpcHandler: SNSnapshotService detected; delegating SN polling to it');
    } else {
      this.logger?.warn('IpcHandler: SNSnapshotService not present; SN status will be fetched on-demand (no internal poller)');
    }

    if (IPC_ROUTES && IPC_ROUTES.length) {
      this.logger?.info(`IpcHandler: declarative routes loaded: ${IPC_ROUTES.length}`);
    } else {
      this.logger?.info('IpcHandler: no declarative routes loaded');
    }

    this.logger?.debug('IpcHandler: Initialization completed');
  }

  /**
   * Shutdown IPC handler service
   */
  async doShutdown() {
    this.logger?.debug('IpcHandler: Starting shutdown');

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

    // 2) Clear API call history (from IpcHandlers) - now handled by DebugTelemetryStore

    // 3) Unregister handlers AFTER SCORM termination
    this.unregisterHandlers();
    this.activeRequests.clear();
    this.rateLimitMap.clear();

    // 4) Clear the rate limit cleanup interval
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
    const declarativeChannelSet = new Set((IPC_ROUTES || []).map(r => r.channel));
    try {
      // SCORM API handlers
      this.registerHandler('scorm-initialize', this.handleScormInitialize.bind(this));
      this.registerHandler('scorm-get-value', this.handleScormGetValue.bind(this));
      this.registerHandler('scorm-set-value', this.handleScormSetValue.bind(this));
      this.registerHandler('scorm-commit', this.handleScormCommit.bind(this));
      this.registerHandler('scorm-terminate', this.handleScormTerminate.bind(this));
      
      // File operation handlers
      this.registerHandler('select-scorm-package', this.handleSelectScormPackage.bind(this));
      this.registerHandler('select-scorm-folder', this.handleSelectScormFolder.bind(this));
      this.registerHandler('extract-scorm', this.handleExtractScorm.bind(this));
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
      // Migrate previously-sync channels to async handlers to unify routing (preserves channel names)
      this.registerHandler('open-debug-window', this.handleOpenDebugWindow.bind(this));
      // Debug history fetch - returns newest-first entries with optional filters { limit, offset, sinceTs, methodFilter }
      this.registerHandler('debug-get-history', this.handleDebugGetHistory.bind(this));

      // Logger adapter loader for renderer fallback
      this.registerHandler('load-shared-logger-adapter', this.handleLoadSharedLoggerAdapter.bind(this));

      // Direct renderer logging channels (avoid cloning function objects over IPC)
      this.registerHandler('renderer-log-info', async (_event, ...args) => { try { this.logger?.info(...args); } catch (e) {} return { success: true }; });
      this.registerHandler('renderer-log-warn', async (_event, ...args) => { try { this.logger?.warn(...args); } catch (e) {} return { success: true }; });
      this.registerHandler('renderer-log-error', async (_event, ...args) => { try { this.logger?.error(...args); } catch (e) {} return { success: true }; });
      this.registerHandler('renderer-log-debug', async (_event, ...args) => { try { this.logger?.debug(...args); } catch (e) {} return { success: true }; });
      
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
    // Try declarative routing first
    try {
      const routes = IPC_ROUTES || [];
      const route = routes.find(r => r.channel === channel);
      if (route) {
        const wrapped = require('./ipc/wrapper-factory').createWrappedHandler(route, this);
        ipcMain.handle(channel, wrapped);
        this.handlers.set(channel, wrapped);
        this.logger?.debug(`IpcHandler: Registered declarative route for channel: ${channel}`);
        return;
      }
    } catch (e) {
      // Fall back to legacy routing on error
    }
    
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

          if (channel === 'open-debug-window') {
            // For debug window: schedule trailing attempt rather than silently OK
            markSuppressed(channel);
            this._openDebugGuards.pending = true;
            if (this._openDebugGuards.timer) clearTimeout(this._openDebugGuards.timer);
            this._openDebugGuards.timer = setTimeout(async () => {
              try {
                const wm = this.getDependency('windowManager');
                if (wm) {
                  const ex = wm.getWindow('debug');
                  if (ex) {
                    try { ex.focus(); } catch (_) {}
                    this.recordOperation('open-debug-window:rate_limited_trailing_focus', true);
                  } else {
                    this.recordOperation('open-debug-window:rate_limited_trailing_create', true);
                    await wm.createDebugWindow();
                  }
                }
              } catch (_) {
                // swallow
              } finally {
                this._openDebugGuards.pending = false;
                this._openDebugGuards.timer = null;
              }
            }, OPEN_DEBUG_DEBOUNCE_MS);
            this.recordOperation('open-debug-window:rate_limited_deferred', true);
            return { success: true, rateLimited: true, deferred: true };
          }

          // Otherwise, enforce
          throw new Error('Rate limit exceeded');
        }
        } // end non-SN bypass branch

        this.activeRequests.set(requestId, { channel, startTime, event });

        // Mark in-flight for open-debug-window to prevent bursts
        if (channel === 'open-debug-window') {
          this._openDebugGuards.inFlight = true;
          this._openDebugGuards.lastAttemptTs = Date.now();
        }

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

        if (isRateLimit && channel === 'open-debug-window') {
          // As a final guard: schedule trailing create/focus
          try {
            if (!this._openDebugGuards.timer) {
              this._openDebugGuards.timer = setTimeout(async () => {
                try {
                  const wm = this.getDependency('windowManager');
                  if (wm) {
                    const ex = wm.getWindow('debug');
                    if (ex) {
                      try { ex.focus(); } catch (_) {}
                      this.recordOperation('open-debug-window:error_trailing_focus', true);
                    } else {
                      this.recordOperation('open-debug-window:error_trailing_create', true);
                      await wm.createDebugWindow();
                    }
                  }
                } catch (_) {
                } finally {
                  this._openDebugGuards.pending = false;
                  this._openDebugGuards.timer = null;
                }
              }, OPEN_DEBUG_DEBOUNCE_MS);
            }
          } catch (_) {}
          this.recordOperation('open-debug-window:rate_limited_soft_ok', true);
          return { success: true, rateLimited: true, deferred: true };
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
        // Clear in-flight flag for open-debug-window
        if (channel === 'open-debug-window') {
          this._openDebugGuards.inFlight = false;
        }
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
    const appRoot = PathUtils.normalize(path.resolve(__dirname, '../../../'));
    return PathUtils.toScormProtocolUrl(filePath, appRoot);
  }

  // Allow optional options param to pass an allowedBase for folder-based loads
  async handleResolveScormUrl(event, contentPath, extractionPath, options = null) {
    const appRoot = PathUtils.normalize(path.resolve(__dirname, '../../../'));
    const allowedBase = options && options.allowedBase ? options.allowedBase : null;
    return PathUtils.resolveScormContentUrl(contentPath, extractionPath, appRoot, allowedBase);
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

  async handleDebugGetHistory(event, { limit, offset, sinceTs, methodFilter } = {}) {
    this.logger?.debug(`IpcHandler: handleDebugGetHistory called with limit: ${limit}, offset: ${offset}, sinceTs: ${sinceTs}, methodFilter: ${methodFilter}`);
    if (this.telemetryStore && typeof this.telemetryStore.getHistory === 'function') {
      return { success: true, history: this.telemetryStore.getHistory({ limit, offset, sinceTs, methodFilter }) };
    }
    return { success: true, history: [] };
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
   * @param {Object} payload - The event payload containing API call details.
   */
  /**
   * Broadcasts a SCORM API call logged event to all active renderer windows.
   * @param {Object} payload - The event payload containing API call details.
   */
  broadcastScormApiCallLogged(payload) {
    try {
      const windowManager = this.getDependency('windowManager');
      if (windowManager) {
        // Iterate over all managed windows and send the event
        for (const window of windowManager.windows.values()) {
          if (window && !window.isDestroyed()) {
            window.webContents.send('scorm-api-call-logged', payload);
            this.logger?.debug(`[IPC Handler] Broadcasted scorm-api-call-logged to window ${window.id}`);
          }
        }
      } else {
        this.logger?.warn('[IPC Handler] WindowManager not available for broadcasting scorm-api-call-logged event.');
      }
    } catch (e) {
      this.logger?.error('[IPC Handler] Error broadcasting scorm-api-call-logged event:', e?.message || e);
    }
  }

  async handleOpenDebugWindow(event) {
    const windowManager = this.getDependency('windowManager');
    if (!windowManager) {
      this.logger?.warn('IpcHandler: WindowManager dependency not available for open-debug-window');
      return { success: false, error: 'WindowManager not available' };
    }

    // Coalesce/debounce multiple rapid calls to open-debug-window
    // This is a client-side guard; server-side rate limiting is also applied.
    const now = Date.now();
    if (this._openDebugGuards.inFlight || (now - this._openDebugGuards.lastAttemptTs < OPEN_DEBUG_DEBOUNCE_MS && !this._openDebugGuards.pending)) {
      this.logger?.debug('IpcHandler: open-debug-window call coalesced/debounced');
      this.recordOperation('open-debug-window:coalesced', true);
      return { success: true, coalesced: true };
    }

    this._openDebugGuards.inFlight = true;
    this._openDebugGuards.lastAttemptTs = now;

    try {
      const debugWindow = windowManager.getWindow('debug');
      if (debugWindow && !debugWindow.isDestroyed()) {
        debugWindow.focus();
        this.logger?.info('IpcHandler: Focused existing debug window');
        this.recordOperation('open-debug-window:focused', true);
        return { success: true, focused: true };
      } else {
        await windowManager.createDebugWindow();
        this.logger?.info('IpcHandler: Created new debug window');
        this.recordOperation('open-debug-window:created', true);
        return { success: true, created: true };
      }
    } catch (error) {
      this.logger?.error('IpcHandler: Failed to open debug window:', error);
      this.recordOperation('open-debug-window:error', false);
      return { success: false, error: error.message };
    } finally {
      this._openDebugGuards.inFlight = false;
    }
  }
}

module.exports = IpcHandler;