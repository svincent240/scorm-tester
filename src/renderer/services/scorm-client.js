/**
 * SCORM Client Service
 *
 * Provides SCORM API implementation for the renderer process.
 * Handles IPC communication with main process while maintaining
 * synchronous SCORM API behavior through local caching.
 *
 * @fileoverview SCORM API client for renderer process
 *
 * NOTE: This file must remain browser/renderer-safe. Avoid Node-only APIs like Buffer
 * unless guarded. Where binary transforms are needed, prefer atob/btoa/Uint8Array.
 */

import { eventBus } from './event-bus.js';
import { uiState as uiStatePromise } from './ui-state.js';

/**
 * SCORM Client Class
 * 
 * Implements full SCORM 2004 4th Edition API with asynchronous IPC
 * communication and synchronous interface through local caching.
 */
class ScormClient {
  constructor() {
    this.sessionId = null;
    this.isInitialized = false;
    this.localCache = new Map();
    this.lastError = '0';
    this.apiCallQueue = [];
    this.isProcessingQueue = false;
    this.sessionTimer = null;
    this.validator = null; // Will be loaded dynamically
    this.uiState = null; // Will be set by AppManager

    // Concurrency guards and throttles
    this._finalizing = false;           // prevent concurrent Commit/Terminate bursts
    this._lastSessionTimeSetAt = 0;     // throttle cmi.session_time SetValue()
    this._SESSION_TIME_MIN_MS = 3000;   // min interval between session_time updates
    this._lastIpcRateLimitAt = 0;       // skip immediate retries after rate limit
    this._IPC_BACKOFF_MS = 1200;

    this.setupEventListeners();
    this.loadValidator(); // Load validator dynamically
  }

  /**
   * Load the validator module dynamically using proper dynamic imports
   * Uses renderer-specific ES6 validator that doesn't depend on CommonJS modules
   */
  async loadValidator() {
    try {
      // Dynamic import of ES6 renderer validator
      const validatorModule = await import('../utils/scorm-validator.js');
      
      this.validator = {
        isValidElement: validatorModule.isValidElement,
        isValidValue: validatorModule.isValidValue
      };
    } catch (error) {
      try {
        const { rendererLogger } = await import('../utils/renderer-logger.js');
        rendererLogger.error('Failed to load validator module', error?.message || error);
      } catch (_) {
        // no-op
      }
      // Fallback: create dummy validators that always return true
      this.validator = {
        isValidElement: () => true,
        isValidValue: () => true
      };
    }
  }

  /**
   * Check if validator is available (fallback to true if not loaded)
   */
  isValidatorReady() {
    return this.validator !== null;
  }

  /**
   * Set the UI State Manager instance
   * @param {Object} uiStateInstance - The resolved UIStateManager instance
   */
  setUiState(uiStateInstance) {
    this.uiState = uiStateInstance;
  }

  /**
   * Initialize SCORM session
   * @param {string} sessionId - Session identifier
   * @returns {string} "true" or "false"
   */
  Initialize(sessionId) {
    if (this.isInitialized) {
      this.setLastError('103'); // Already initialized
      return 'false';
    }

    if (!sessionId || typeof sessionId !== 'string') {
      this.setLastError('101'); // General exception
      return 'false';
    }

    this.sessionId = sessionId;
    this.isInitialized = true;
    this.lastError = '0';

    // Asynchronously initialize with main process
    this.asyncInitialize(sessionId);

    // Update UI state
    this.uiState.updateSession({
      id: sessionId,
      startTime: Date.now(),
      connected: true
    });

    this.logApiCall('Initialize', sessionId, 'true');
    eventBus.emit('scorm:initialized', { sessionId });

    return 'true';
  }

  /**
   * Terminate SCORM session
   * @param {string} parameter - Empty string parameter
   * @returns {string} "true" or "false"
   */
  Terminate(parameter) {
    if (!this.isInitialized) {
      this.setLastError('112'); // Termination before initialization
      return 'false';
    }

    if (parameter !== '') {
      this.setLastError('201'); // Invalid argument error
      return 'false';
    }

    // Commit any pending data
    this.Commit('');

    this.isInitialized = false;
    this.lastError = '0';

    // Asynchronously terminate with main process
    // Space termination slightly to avoid colliding with Commit in the same window
    setTimeout(() => { this.asyncTerminate(); }, 200);

    this.logApiCall('Terminate', parameter, 'true');
    eventBus.emit('scorm:terminated', { sessionId: this.sessionId });

    return 'true';
  }

  /**
   * Get value from SCORM data model
   * @param {string} element - Data model element
   * @returns {string} Element value
   */
  GetValue(element) {
    if (!this.isInitialized) {
      this.setLastError('122', { element }); // Get before initialization
      return '';
    }

    if (!element || typeof element !== 'string') {
      this.setLastError('201', { element }); // Invalid argument
      return '';
    }

    // Validate element name using dynamically loaded validator
    if (this.isValidatorReady() && !this.validator.isValidElement(element)) {
      this.setLastError('401', { element }); // Undefined data model element
      return '';
    }

    // Return cached value immediately for synchronous behavior
    const cachedValue = this.localCache.get(element) || '';
    this.lastError = '0';

    // Asynchronously refresh from main process
    this.asyncGetValue(element);

    this.logApiCall('GetValue', element, cachedValue);
    return cachedValue;
  }

  /**
   * Set value in SCORM data model
   * @param {string} element - Data model element
   * @param {string} value - Value to set
   * @returns {string} "true" or "false"
   */
  SetValue(element, value) {
    if (!this.isInitialized) {
      this.setLastError('132', { element }); // Set before initialization
      return 'false';
    }

    if (!element || typeof element !== 'string') {
      this.setLastError('201', { element }); // Invalid argument
      return 'false';
    }

    if (value === null || value === undefined) {
      this.setLastError('201', { element }); // Invalid argument
      return 'false';
    }

    // Convert to string
    value = String(value);

    // Validate element name using dynamically loaded validator
    if (this.isValidatorReady() && !this.validator.isValidElement(element)) {
      this.setLastError('401', { element }); // Undefined data model element
      return 'false';
    }

    // Validate value format using dynamically loaded validator
    if (this.isValidatorReady() && !this.validator.isValidValue(element, value)) {
      this.setLastError('405', { element }); // Incorrect data type
      return 'false';
    }

    // Update local cache immediately
    this.localCache.set(element, value);
    this.lastError = '0';

    // Update UI state for key elements
    this.updateUIFromElement(element, value);

    // Asynchronously send to main process
    this.asyncSetValue(element, value);

    this.logApiCall('SetValue', `${element} = ${value}`, 'true');
    eventBus.emit('scorm:dataChanged', { element, value });

    return 'true';
  }

  /**
   * Commit data to persistent store
   * @param {string} parameter - Empty string parameter
   * @returns {string} "true" or "false"
   */
  Commit(parameter) {
    if (!this.isInitialized) {
      this.setLastError('142'); // Commit before initialization
      return 'false';
    }

    if (parameter !== '') {
      this.setLastError('201'); // Invalid argument
      return 'false';
    }

    this.lastError = '0';

    // Asynchronously commit to main process
    this.asyncCommit();

    this.logApiCall('Commit', parameter, 'true');
    eventBus.emit('scorm:committed', { sessionId: this.sessionId });

    return 'true';
  }

  /**
   * Get last error code
   * @returns {string} Error code
   */
  GetLastError() {
    return this.lastError;
  }

  /**
   * Get error string for error code
   * @param {string} errorCode - Error code
   * @returns {string} Error description
   */
  GetErrorString(errorCode) {
    const errorStrings = {
      '0': 'No error',
      '101': 'General exception',
      '102': 'General initialization failure',
      '103': 'Already initialized',
      '104': 'Content instance terminated',
      '111': 'General termination failure',
      '112': 'Termination before initialization',
      '113': 'Termination after termination',
      '122': 'Retrieve data before initialization',
      '123': 'Retrieve data after termination',
      '132': 'Store data before initialization',
      '133': 'Store data after termination',
      '142': 'Commit before initialization',
      '143': 'Commit after termination',
      '201': 'Invalid argument error',
      '301': 'General get failure',
      '351': 'General set failure',
      '391': 'General commit failure',
      '401': 'Undefined data model element',
      '402': 'Unimplemented data model element',
      '403': 'Data model element value not initialized',
      '404': 'Data model element is read only',
      '405': 'Incorrect data type'
    };

    return errorStrings[errorCode] || 'Unknown error';
  }

  /**
   * Get diagnostic information for error code
   * @param {string} errorCode - Error code
   * @returns {string} Diagnostic information
   */
  GetDiagnostic(errorCode) {
    return `Diagnostic information for error ${errorCode}: ${this.GetErrorString(errorCode)}`;
  }

  /**
   * Asynchronously initialize with main process
   * @private
   */
  async asyncInitialize(sessionId) {
    try {
      const result = await window.electronAPI.scormInitialize(sessionId);
      if (result.success) {
        // Pre-populate cache with common elements
        await this.preloadCommonElements();
      } else {
        try {
          const { rendererLogger } = await import('../utils/renderer-logger.js');
          rendererLogger.warn('SCORM initialization failed', result.errorCode);
        } catch (_) {}
      }
    } catch (error) {
      try {
        const { rendererLogger } = await import('../utils/renderer-logger.js');
        rendererLogger.error('Error initializing SCORM session', error?.message || error);
      } catch (_) {}
    }
  }

  /**
   * Asynchronously terminate with main process
   * @private
   */
  async asyncTerminate() {
    // serialize with commit to avoid burst
    if (this._finalizing) {
      // slight jitter to allow commit to complete
      await new Promise(r => setTimeout(r, 300));
    }
    try {
      if (this.sessionId) {
        await window.electronAPI.scormTerminate(this.sessionId);
      }
    } catch (error) {
      const msg = (error && error.message) ? error.message : String(error);
      if (msg.includes('Rate limit exceeded')) {
        this._lastIpcRateLimitAt = Date.now();
        // Silent backoff: do not log to app log or console
        return;
      }
      // Swallow non-rate-limit errors during shutdown to avoid noisy logs
      return;
    }
  }

  /**
   * Asynchronously get value from main process
   * @private
   */
  async asyncGetValue(element) {
    try {
      const result = await window.electronAPI.scormGetValue(this.sessionId, element);
      if (result.success) {
        this.localCache.set(element, result.value);
        this.updateUIFromElement(element, result.value);
        eventBus.emit('scorm:dataRefreshed', { element, value: result.value });
      }
    } catch (error) {
      try {
        const { rendererLogger } = await import('../utils/renderer-logger.js');
        rendererLogger.error(`Error getting SCORM value for ${element}`, error?.message || error);
      } catch (_) {}
    }
  }

  /**
   * Asynchronously set value to main process
   * @private
   */
  async asyncSetValue(element, value) {
    try {
      const result = await window.electronAPI.scormSetValue(this.sessionId, element, value);
      if (!result.success) {
        // Silent failure path; renderer cache already updated
      }
    } catch (error) {
      // Silent backoff on rate limit; swallow other errors to keep shutdown quiet
      const msg = (error && error.message) ? error.message : String(error);
      if (msg.includes('Rate limit exceeded')) {
        this._lastIpcRateLimitAt = Date.now();
        return;
      }
      return;
    }
  }

  /**
   * Asynchronously commit to main process
   * @private
   */
  async asyncCommit() {
    // prevent overlapping finalization bursts
    if (this._finalizing) return;
    this._finalizing = true;
    try {
      const result = await window.electronAPI.scormCommit(this.sessionId);
      if (!result.success) {
        // Silent failure; commit retries are not critical here
      }
    } catch (error) {
      const msg = (error && error.message) ? error.message : String(error);
      if (msg.includes('Rate limit exceeded')) {
        this._lastIpcRateLimitAt = Date.now();
        // Silent backoff
      }
      // Swallow other errors to avoid log noise
    } finally {
      // small delay to avoid immediate follow-up terminate congestion
      setTimeout(() => { this._finalizing = false; }, 250);
    }
  }

  /**
   * Preload common SCORM elements into cache
   * @private
   */
  async preloadCommonElements() {
    const commonElements = [
      'cmi.completion_status',
      'cmi.success_status',
      'cmi.score.scaled',
      'cmi.score.raw',
      'cmi.score.min',
      'cmi.score.max',
      'cmi.progress_measure',
      'cmi.location',
      'cmi.suspend_data',
      'cmi.session_time',
      'cmi.total_time',
      'cmi.learner_id',
      'cmi.learner_name',
      'cmi.credit',
      'cmi.mode'
    ];

    for (const element of commonElements) {
      try {
        const result = await window.electronAPI.scormGetValue(this.sessionId, element);
        if (result.success) {
          this.localCache.set(element, result.value);
        }
      } catch (error) {
        // Continue with other elements
      }
    }
  }

  /**
   * Update UI state from SCORM element changes
   * @private
   */
  updateUIFromElement(element, value) {
    const progressUpdates = {};

    switch (element) {
      case 'cmi.completion_status':
        progressUpdates.completionStatus = value;
        break;
      case 'cmi.success_status':
        progressUpdates.successStatus = value;
        break;
      case 'cmi.score.raw':
        progressUpdates.scoreRaw = parseFloat(value) || null;
        break;
      case 'cmi.progress_measure':
        progressUpdates.progressMeasure = parseFloat(value) || 0;
        break;
      case 'cmi.location':
        progressUpdates.location = value;
        break;
      case 'cmi.suspend_data':
        progressUpdates.suspendData = value;
        break;
      case 'cmi.session_time':
        progressUpdates.sessionTime = value;
        break;
      case 'cmi.total_time':
        progressUpdates.totalTime = value;
        break;
    }

    if (Object.keys(progressUpdates).length > 0) {
      this.uiState.updateProgress(progressUpdates);
    }
  }


  /**
   * Set last error code
   * @private
   */
  setLastError(errorCode, context = {}) {
    this.lastError = errorCode;

    // Downgrade SCORM 2004 401 (Undefined data model element) for adl.data.* access to WARN without emitting scorm:error
    // Rationale:
    // - Many sample SCOs probe optional ADL data model collections (adl.data.*) that are not required by core LMS/RTE.
    // - Per spec, undefined elements should return 401 but are not fatal; avoid triggering app-level error loops.
    try {
      const element = typeof context.element === 'string' ? context.element : null;
      const is401 = String(errorCode) === '401';
      const isAdlDataProbe = !!(element && /^adl\.data(\.|$)/i.test(element));

      if (is401 && isAdlDataProbe) {
        // Log as WARN to the centralized renderer logger and suppress 'scorm:error' event emission
        import('./utils/renderer-logger.js')
          .then(({ rendererLogger }) => {
            rendererLogger?.warn('[RTE] Ignoring undefined ADL data model probe', {
              element,
              errorCode: String(errorCode),
              description: this.GetErrorString(String(errorCode))
            });
          })
          .catch(() => { /* no-op */ });

        return; // do not emit eventBus 'scorm:error' to prevent UI feedback loops
      }
    } catch (_) {
      // Fall through to default emission if diagnostics fail
    }

    // Default behavior: emit scorm:error for all other cases
    eventBus.emit('scorm:error', { code: String(errorCode), message: this.GetErrorString(String(errorCode)), source: 'renderer/scorm-client' });
  }

  /**
   * Log API call
   * @private
   */
  logApiCall(method, parameter, result) {
    const apiCall = {
      method,
      parameter,
      result,
      errorCode: this.lastError,
      timestamp: Date.now()
    };

    this.uiState.addApiCall(apiCall);

    // Emit event for debug panel in same window
    eventBus.emit('api:call', { data: apiCall });

    // Also emit via IPC for debug window (guard against rate limits)
    if (window.electronAPI && window.electronAPI.emitDebugEvent) {
      try {
        window.electronAPI.emitDebugEvent('api:call', apiCall);
      } catch (e) {
        const msg = (e && e.message) ? e.message : String(e);
        if (msg.includes('Rate limit exceeded')) {
          // Degrade gracefully: skip further emits for this tick
        }
      }
    }
  }

  /**
   * Setup event listeners
   * @private
   */
  setupEventListeners() {
    // Only run in real browser/renderer environments to avoid open handles in Jest/Node
    const hasDom = (typeof window !== 'undefined') && (typeof document !== 'undefined');
    const isTest = (typeof process !== 'undefined') && (process.env && process.env.NODE_ENV === 'test');

    if (!hasDom || isTest) {
      // Defer interval creation in non-DOM or test environments
      // Avoid console; renderer logger may not be available synchronously here.
      this.sessionTimer = null;
      return;
    }

    // Listen for session timer updates (renderer-only UI update; no IPC here)
    this.sessionTimer = setInterval(() => {
      if (this.isInitialized && this.sessionId) {
        this.updateSessionTime();
      }
    }, 1000);
  }

  /**
   * Update session time
   * @private
   */
  updateSessionTime() {
    // Ensure uiState is available before attempting to use it
    if (!this.uiState) {
      // Silent if uiState not yet available; avoid console noise
      return;
    }

    const sessionData = this.uiState.getState('currentSession');
    if (!sessionData) return;

    const startTime = this.uiState.getState('sessionStartTime');
    if (!startTime) return;

    const now = Date.now();
    const elapsed = now - startTime;
    const hours = Math.floor(elapsed / 3600000);
    const minutes = Math.floor((elapsed % 3600000) / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    // Update UI state only; throttle IPC SetValue for cmi.session_time
    this.uiState.updateProgress({ sessionTime: timeString });

    // Throttle actual SetValue to main (min interval)
    if ((now - this._lastSessionTimeSetAt) >= this._SESSION_TIME_MIN_MS && this.isInitialized) {
      this._lastSessionTimeSetAt = now;
      // SCORM 2004 expects PTnHnMnS format; keep lightweight, avoid burst
      const isoDur = `PT${hours}H${minutes}M${seconds}S`;
      // Best-effort cache update and async send; tolerate rate-limit
      this.localCache.set('cmi.session_time', isoDur);
      // Avoid spamming if we recently saw an IPC rate limit
      if ((now - this._lastIpcRateLimitAt) >= this._IPC_BACKOFF_MS) {
        this.asyncSetValue('cmi.session_time', isoDur);
      }
    }
  }

  /**
   * Get current session ID
   * @returns {string|null} Session ID
   */
  getSessionId() {
    return this.sessionId;
  }

  /**
   * Check if initialized
   * @returns {boolean} Initialization state
   */
  getInitialized() {
    return this.isInitialized;
  }

  /**
   * Get cached value
   * @param {string} element - Element name
   * @returns {string} Cached value
   */
  getCachedValue(element) {
    return this.localCache.get(element) || '';
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.localCache.clear();
    eventBus.emit('scorm:cacheCleared');
  }

  /**
   * Destroy the SCORM client
   */
  destroy() {
   if (this.isInitialized) {
     this.Terminate('');
   }
   
   // Clear the session timer
   if (this.sessionTimer) {
     clearInterval(this.sessionTimer);
     this.sessionTimer = null;
   }
   
   this.clearCache();
   eventBus.emit('scorm:destroyed');
 }

 /**
  * Ensure a spaced final flush to minimize IPC rate-limit collisions at shutdown.
  * Sequence: optional session_time send (if not too recent) -> Commit -> Terminate (spaced)
  */
 async flushBeforeTerminate() {
   try {
     const now = Date.now();
     // Try one last session_time send if allowed by throttle
     const lastIso = this.localCache.get('cmi.session_time');
     if (this.isInitialized && (now - this._lastSessionTimeSetAt) >= 5000 && lastIso && (now - this._lastIpcRateLimitAt) >= this._IPC_BACKOFF_MS) {
       this._lastSessionTimeSetAt = now;
       await this.asyncSetValue('cmi.session_time', lastIso);
     }
     // Commit, then slight delay, then terminate
     await this.asyncCommit();
     await new Promise(r => setTimeout(r, 250));
     await this.asyncTerminate();
   } catch (_) {
     // swallow to avoid noisy shutdown
   }
 }

 /**
  * Renderer-safe utility to decode base64 into Uint8Array without Node Buffer.
  * If running in environments that provide Buffer, it won't be used here.
  */
 decodeBase64ToBytes(base64) {
   try {
     const binary = atob(base64);
     const len = binary.length;
     const bytes = new Uint8Array(len);
     for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
     return bytes;
   } catch (_) {
     // Fallback: return empty bytes on invalid input
     return new Uint8Array(0);
   }
 }

}

// Create and export singleton instance
const scormClient = new ScormClient();

export { ScormClient, scormClient };