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

    // 1) Terminate SCORM sessions FIRST (best-effort, silent)
    await this.terminateScormSessionsSafely();

    // 2) Clear API call history (from IpcHandlers)
    this.clearApiCallHistory();
    this.logger?.info('[DEBUG EVENT] API call history cleared on app shutdown');

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
      this.registerSyncHandler('log-message', this.handleLogMessage.bind(this));
      this.registerSyncHandler('debug-event', this.handleDebugEvent.bind(this));
      this.registerHandler('open-debug-window', this.handleOpenDebugWindow.bind(this));

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
    // Per-channel idempotency/debounce guards for "open-debug-window"
    const OPEN_DEBUG_DEBOUNCE_MS = 500;
    if (!this._openDebugGuards) {
      this._openDebugGuards = { lastAttemptTs: 0, inFlight: false, timer: null, pending: false };
    }

    return async (event, ...args) => {
      const requestId = ++this.requestCounter;
      const startTime = Date.now();

      try {
        if (!this.validateRequest(event, channel, args)) {
          throw new Error('Request validation failed');
        }

        // Special-case: ensure open-debug-window always results in a focus/create
        if (channel === 'open-debug-window') {
          try {
            const windowManager = this.getDependency('windowManager');
            if (windowManager) {
              const existing = windowManager.getWindow('debug');
              if (existing) {
                // Focus existing window immediately
                try { existing.focus(); } catch (_) {}
                this.recordOperation('open-debug-window:focused_existing', true);
                return { success: true, alreadyOpen: true, focused: true, action: 'focused' };
              }
            }
          } catch (_) {
            // Non-fatal; continue
          }

          const nowTs = Date.now();
          // Coalesce multiple invocations within debounce window, but guarantee trailing execution
          if ((nowTs - this._openDebugGuards.lastAttemptTs) < OPEN_DEBUG_DEBOUNCE_MS || this._openDebugGuards.inFlight) {
            this._openDebugGuards.pending = true;
            // refresh debounce timer
            if (this._openDebugGuards.timer) {
              clearTimeout(this._openDebugGuards.timer);
            }
            this._openDebugGuards.timer = setTimeout(async () => {
              try {
                // trailing attempt: re-check and create/focus
                const wm = this.getDependency('windowManager');
                if (wm) {
                  const ex = wm.getWindow('debug');
                  if (ex) {
                    try { ex.focus(); } catch (_) {}
                    this.recordOperation('open-debug-window:trailing_focus', true);
                  } else {
                    this.recordOperation('open-debug-window:trailing_create', true);
                    await wm.createDebugWindow();
                  }
                }
              } catch (_) {
                // swallow to avoid noise
              } finally {
                this._openDebugGuards.pending = false;
                this._openDebugGuards.timer = null;
              }
            }, OPEN_DEBUG_DEBOUNCE_MS);
            this.recordOperation('open-debug-window:coalesced_trailing', true);
            return { success: true, coalesced: true, deferred: true };
          }
        }

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
        this.recordOperation(`${channel}:success`, true);
        this.logger?.debug(`IpcHandler: ${channel} request ${requestId} completed in ${duration}ms`);

        return result;

      } catch (error) {
        const duration = Date.now() - startTime;

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

    // SCORM-aware grace window: exempt scorm-get-value shortly after Initialize ACK
    try {
      if (channel === 'scorm-get-value') {
        const scormService = this.getDependency('scormService');
        if (scormService && typeof scormService.getAllSessions === 'function') {
          const sessions = scormService.getAllSessions();
          // Find any session that was initialized within the last 750ms
          const nowTs = Date.now();
          for (const s of sessions) {
            const started = s && s.startTime ? new Date(s.startTime).getTime() : 0;
            if (started && (nowTs - started) <= 750) {
              // Allow early GetValue bursts during startup
              return true;
            }
          }
        }
      }
    } catch (_) {
      // On any failure of exemption logic, fall back to generic limiter
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

  async handleLoadSharedLoggerAdapter(_event) {
    try {
      // Lazy-require the CommonJS Logger class
      // eslint-disable-next-line global-require, import/no-commonjs
      const LoggerClass = require('../../shared/utils/logger.js');

      // Prefer the same directory used by the main logger initialization
      // If our BaseService logger is configured, assume it writes to the correct app.log already.
      // The LoggerClass constructor requires a directory; we derive it from the existing logger if possible.
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

      // Singleton the instance within this service
      if (!this._sharedLoggerInstance) {
        this._sharedLoggerInstance = new LoggerClass(logDir);
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


  // Handle opening the debug window
  async handleOpenDebugWindow(event) {
    const windowManager = this.getDependency('windowManager');
    if (windowManager) {
      await windowManager.createDebugWindow();
      return { success: true };
    } else {
      this.logger?.error('IpcHandler: WindowManager not available to open debug window');
      return { success: false, error: 'WindowManager not available' };
    }
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

  // --- End of merged IpcHandlers methods ---
}

module.exports = IpcHandler;