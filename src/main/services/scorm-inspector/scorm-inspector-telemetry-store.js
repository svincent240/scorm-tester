"use strict";

/**
 * SCORM Inspector Telemetry Store
 * 
 * Single source of truth for all SCORM package inspection data.
 * This is NOT for app debugging - it's for end-user SCORM content analysis.
 * 
 * Enhanced version of the original DebugTelemetryStore with:
 * - Proper SCORM Inspector terminology
 * - Error classification and routing
 * - Broadcasting to all windows
 * - Improved data structure for inspection
 */

class ScormInspectorTelemetryStore {
  constructor(options = {}) {
    const {
      maxHistorySize = 2000,
      dataModelHistorySize = 5000,
      logger = null,
      enableBroadcast = true
    } = options;
    
    this.config = {
      maxHistorySize: Number(maxHistorySize) || 2000,
      dataModelHistorySize: Number(dataModelHistorySize) || Number(maxHistorySize) || 2000,
      enableBroadcast: Boolean(enableBroadcast),
      retentionTimeMs: 3600000, // 1 hour
      ...options
    };
    
    this.logger = logger || console;
    
    // Ring buffer for SCORM API call history
    this.scormApiHistory = [];
    this.scormErrors = [];
    this.dataModelHistory = [];
    
    // Window manager reference for broadcasting
    this.windowManager = null;
    
    // Performance tracking
    this.performanceStats = {
      totalStoreTime: 0,
      totalBroadcastTime: 0,
      storeCallCount: 0,
      dataModelStoreCallCount: 0,
      broadcastCount: 0,
      memoryUsage: 0
    };
  }

  /**
   * Store a SCORM API call for inspection
   * @param {Object} data - SCORM API call data
   */
  storeApiCall(data) {
    const startTime = performance.now();
    
    try {
      if (!data || typeof data !== 'object') return;
      
      const entry = {
        id: this.generateId(),
        timestamp: Date.now(),
        entryType: 'api-call',
        ...data
      };

      const numericTimestamp = typeof entry.timestamp === 'number'
        ? entry.timestamp
        : Date.parse(entry.timestamp) || Date.now();

      entry.timestampMs = numericTimestamp;

      const isoTimestamp = new Date(numericTimestamp).toISOString();
      entry.timestampIso = isoTimestamp;
      entry.timestamp = isoTimestamp;

      if (!entry.entryType) entry.entryType = 'api-call';
      
      // Add to ring buffer
      this.scormApiHistory.push(entry);
      this.trimHistory();
      
      // Classify and store errors separately
      if (entry.errorCode && entry.errorCode !== '0') {
        this.storeScormError(entry);
      }
      
      // Immediately broadcast to all windows
      this.broadcastToAllWindows('scorm-inspector-data-updated', entry);

      // Update performance stats
      const endTime = performance.now();
      this.performanceStats.totalStoreTime += (endTime - startTime);
      this.performanceStats.storeCallCount++;

      // Monitor memory usage periodically
      if (this.performanceStats.storeCallCount % 100 === 0) {
        this.checkMemoryUsage();
      }
      
    } catch (e) {
      // Never throw from telemetry store; log and continue
      try { 
        this.logger?.warn && this.logger.warn('[ScormInspectorTelemetryStore] Failed to store API call', e?.message || e); 
      } catch (_) { /* intentionally empty */ }
    }
  }

  /**
   * Store SCORM-related errors for inspection
   * @param {Object} entry - API call entry with error
   */
  storeScormError(entry) {
    try {
      const errorEntry = {
        ...entry,
        source: 'scorm',
        severity: this.classifyErrorSeverity(entry.errorCode),
        userActionable: true,
        troubleshootingSteps: this.generateTroubleshootingSteps(entry)
      };
      
      this.scormErrors.push(errorEntry);
      this.trimErrors();
      
      // Broadcast error specifically to SCORM Inspector
      this.broadcastToAllWindows('scorm-inspector-error-updated', errorEntry);
      
    } catch (e) {
      try { 
        this.logger?.warn && this.logger.warn('[ScormInspectorTelemetryStore] Failed to store SCORM error', e?.message || e); 
      } catch (_) { /* intentionally empty */ }
    }
  }

  /**
   * Store data model change events for inspection timeline
   * @param {Object} data - Data model change payload
   */
  storeDataModelChange(data) {
    const startTime = performance.now();

    try {
      if (!data || typeof data !== 'object') return;

      const entry = {
        id: data.id || this.generateId(),
        timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
        entryType: 'data-model-change',
        ...data
      };

      const numericTimestamp = typeof entry.timestamp === 'number'
        ? entry.timestamp
        : Date.parse(entry.timestamp) || Date.now();

  entry.timestampMs = numericTimestamp;

  const isoTimestamp = new Date(numericTimestamp).toISOString();
  entry.timestampIso = isoTimestamp;
  entry.timestamp = isoTimestamp;
      if (!entry.entryType) entry.entryType = 'data-model-change';

      if (entry.sessionId != null) {
        entry.sessionId = String(entry.sessionId);
      }

      this.dataModelHistory.push(entry);
      this.trimDataModelHistory();

      if (this.config.enableBroadcast) {
        this.broadcastToAllWindows('scorm-data-model-change', entry);
      }

      const endTime = performance.now();
      this.performanceStats.totalStoreTime += (endTime - startTime);
      this.performanceStats.dataModelStoreCallCount++;

      if (this.performanceStats.dataModelStoreCallCount % 100 === 0) {
        this.checkMemoryUsage();
      }
    } catch (e) {
      try {
        this.logger?.warn && this.logger.warn('[ScormInspectorTelemetryStore] Failed to store data model change', e?.message || e);
      } catch (_) { /* intentionally empty */ }
    }
  }

  /**
   * Get historical SCORM API calls for inspector window initialization
   * @param {Object} options - Query options
   * @returns {Object} Response with history data
   */
  getHistory(options = {}) {
    try {
      const { limit = 1000, offset = 0, sinceTs = null, methodFilter = null } = options || {};
      
      this.logger?.debug && this.logger.debug(`[ScormInspectorTelemetryStore] getHistory called. Current history size: ${this.scormApiHistory.length}, options: ${JSON.stringify(options)}`);
      
      let filteredHistory = [...this.scormApiHistory];
      
      // Apply filters
      if (sinceTs != null) {
        const since = Number(sinceTs) || 0;
        filteredHistory = filteredHistory.filter(entry => (entry.timestampMs || entry.timestamp || 0) >= since);
        this.logger?.debug && this.logger.debug(`[ScormInspectorTelemetryStore] getHistory after sinceTs filter: ${filteredHistory.length} entries`);
      }
      
      if (methodFilter) {
        const methods = Array.isArray(methodFilter) ? methodFilter.map(m => String(m)) : [String(methodFilter)];
        filteredHistory = filteredHistory.filter(entry => methods.includes(entry.method));
        this.logger?.debug && this.logger.debug(`[ScormInspectorTelemetryStore] getHistory after methodFilter: ${filteredHistory.length} entries`);
      }
      
      // Sort newest first, then apply pagination
      filteredHistory.sort((a, b) => (b.timestampMs || b.timestamp || 0) - (a.timestampMs || a.timestamp || 0));
      
      // Apply offset + limit
      const off = Math.max(0, Number(offset) || 0);
      if (limit != null) {
        const lim = Math.max(0, Number(limit) || 0);
        filteredHistory = filteredHistory.slice(off, off + lim);
      } else {
        filteredHistory = filteredHistory.slice(off);
      }

  const dataModelResponse = this.getDataModelHistory({ sinceTs, limit, offset });
      
      this.logger?.debug && this.logger.debug(`[ScormInspectorTelemetryStore] getHistory returning ${filteredHistory.length} entries`);
      
      return {
        success: true,
        history: filteredHistory,
        dataModelChanges: dataModelResponse.success ? dataModelResponse.changes : [],
        dataModelTotal: dataModelResponse.total,
        dataModelHasMore: dataModelResponse.hasMore,
        total: this.scormApiHistory.length,
        hasMore: this.scormApiHistory.length > (off + filteredHistory.length)
      };
      
    } catch (e) {
      try { 
        this.logger?.warn && this.logger.warn('[ScormInspectorTelemetryStore] getHistory failed', e?.message || e); 
      } catch (_) { /* intentionally empty */ }
      return {
        success: false,
        history: [],
  dataModelChanges: [],
        dataModelTotal: 0,
        dataModelHasMore: false,
        total: 0,
        hasMore: false,
        error: e?.message || 'Unknown error'
      };
    }
  }

  /**
   * Get SCORM errors for error tab
   * @param {Object} options - Query options  
   * @returns {Object} Response with error data
   */
  getErrors(options = {}) {
    try {
      const { severity, limit = 100 } = options;
      
      let filteredErrors = [...this.scormErrors];
      
      if (severity) {
        filteredErrors = filteredErrors.filter(error => error.severity === severity);
      }
      
      return {
        success: true,
        errors: filteredErrors.slice(0, limit),
        total: filteredErrors.length
      };
      
    } catch (e) {
      try { 
        this.logger?.warn && this.logger.warn('[ScormInspectorTelemetryStore] getErrors failed', e?.message || e); 
      } catch (_) { /* intentionally empty */ }
      return {
        success: false,
        errors: [],
        total: 0,
        error: e?.message || 'Unknown error'
      };
    }
  }

  /**
   * Retrieve data model change history
   * @param {Object} options - Query options
   * @returns {Object} Response with change data
   */
  getDataModelHistory(options = {}) {
    try {
      const {
        sinceTs = null,
        elementPrefix = null,
        sessionId = null,
        limit = 1000,
        offset = 0
      } = options || {};

      let history = [...this.dataModelHistory];

      if (sinceTs != null) {
        const since = Number(sinceTs) || 0;
        history = history.filter(entry => (entry.timestampMs || entry.timestamp || 0) >= since);
      }

      if (elementPrefix) {
        const prefixes = Array.isArray(elementPrefix) ? elementPrefix : [elementPrefix];
        history = history.filter(entry => {
          if (!entry?.element) return false;
          return prefixes.some(prefix => String(entry.element).startsWith(String(prefix)));
        });
      }

      if (sessionId) {
        const sid = String(sessionId);
        history = history.filter(entry => String(entry.sessionId || '') === sid);
      }

  history.sort((a, b) => (b.timestampMs || b.timestamp || 0) - (a.timestampMs || a.timestamp || 0));

      const off = Math.max(0, Number(offset) || 0);
      const lim = limit == null ? null : Math.max(0, Number(limit) || 0);
      const paged = lim != null ? history.slice(off, off + lim) : history.slice(off);

      return {
        success: true,
        changes: paged,
        total: this.dataModelHistory.length,
        hasMore: this.dataModelHistory.length > (off + paged.length)
      };
    } catch (e) {
      try {
        this.logger?.warn && this.logger.warn('[ScormInspectorTelemetryStore] getDataModelHistory failed', e?.message || e);
      } catch (_) { /* intentionally empty */ }
      return {
        success: false,
        changes: [],
        total: 0,
        hasMore: false,
        error: e?.message || 'Unknown error'
      };
    }
  }

  /**
   * Broadcast SCORM inspection data to all windows
   * @param {string} channel - IPC channel name
   * @param {Object} data - Data to broadcast
   */
  broadcastToAllWindows(channel, data) {
    if (!this.config.enableBroadcast || !this.windowManager) {
      return;
    }
    
    const startTime = performance.now();
    
    try {
      const windows = this.windowManager.getAllWindows();
      
      windows.forEach(window => {
        if (window && !window.isDestroyed()) {
          try {
            window.webContents.send(channel, data);
          } catch (e) {
            this.logger?.warn && this.logger.warn(`[ScormInspectorTelemetryStore] Failed to send to window`, e?.message || e);
          }
        }
      });
      
      // Update performance stats
      const endTime = performance.now();
      this.performanceStats.totalBroadcastTime += (endTime - startTime);
      this.performanceStats.broadcastCount++;
      
    } catch (error) {
      this.logger?.error && this.logger.error('[ScormInspectorTelemetryStore] Broadcast failed', error?.message || error);
    }
  }

  /**
   * Set window manager reference for broadcasting
   * @param {Object} windowManager - WindowManager instance
   */
  setWindowManager(windowManager) {
    this.windowManager = windowManager;
    this.logger?.debug && this.logger.debug('[ScormInspectorTelemetryStore] Window manager reference set');
  }

  /**
   * Legacy method for compatibility - flush to specific webContents
   * @param {Object} webContents - WebContents to send data to
   */
  flushTo(webContents) {
    try {
      if (!webContents || (typeof webContents.send !== 'function')) {
        this.logger?.warn && this.logger.warn('[ScormInspectorTelemetryStore] flushTo called without valid webContents');
        return;
      }

      const entries = [...this.scormApiHistory].slice().reverse(); // newest-first
      this.logger?.info && this.logger.info(`[ScormInspectorTelemetryStore] Flushing ${entries.length} entries to SCORM Inspector window (newest-first)`);
      
      for (const entry of entries) {
        try {
          webContents.send('scorm-inspector-data-updated', entry);
        } catch (e) {
          this.logger?.warn && this.logger.warn('[ScormInspectorTelemetryStore] Failed to send entry to webContents', e?.message || e);
        }
      }
    } catch (e) {
      try { 
        this.logger?.warn && this.logger.warn('[ScormInspectorTelemetryStore] flushTo failed', e?.message || e); 
      } catch (_) { /* intentionally empty */ }
    }
  }

  /**
   * Trim history to prevent memory issues
   */
  trimHistory() {
    if (this.scormApiHistory.length > this.config.maxHistorySize) {
      const removeCount = this.scormApiHistory.length - this.config.maxHistorySize;
      this.scormApiHistory.splice(0, removeCount);
      this.logger?.debug && this.logger.debug(`[ScormInspectorTelemetryStore] Trimmed ${removeCount} old entries`);
    }
  }

  trimDataModelHistory() {
    const limit = this.config.dataModelHistorySize || this.config.maxHistorySize;
    if (this.dataModelHistory.length > limit) {
      const removeCount = this.dataModelHistory.length - limit;
      this.dataModelHistory.splice(0, removeCount);
      this.logger?.debug && this.logger.debug(`[ScormInspectorTelemetryStore] Trimmed ${removeCount} data model entries`);
    }
  }

  /**
   * Trim error history
   */
  trimErrors() {
    const maxErrors = Math.floor(this.config.maxHistorySize * 0.2); // 20% of total
    if (this.scormErrors.length > maxErrors) {
      const removeCount = this.scormErrors.length - maxErrors;
      this.scormErrors.splice(0, removeCount);
      this.logger?.debug && this.logger.debug(`[ScormInspectorTelemetryStore] Trimmed ${removeCount} old error entries`);
    }
  }

  /**
   * Classify SCORM error severity
   * @param {string} errorCode - SCORM error code
   * @returns {string} Severity level
   */
  classifyErrorSeverity(errorCode) {
    const criticalErrors = ['101', '201', '301'];
    // Treat core data model and general get/set/commit failures as high
    const highErrors = ['401', '402', '403', '404', '406', '407', '408', '409', '410', '411'];
    const mediumErrors = ['351', '391'];
    
    if (criticalErrors.includes(errorCode)) return 'critical';
    if (highErrors.includes(errorCode)) return 'high';
    if (mediumErrors.includes(errorCode)) return 'medium';
    return 'low';
  }

  /**
   * Generate troubleshooting steps for SCORM errors
   * @param {Object} entry - API call entry
   * @returns {Array} Array of troubleshooting steps
   */
  generateTroubleshootingSteps(entry) {
    const steps = [];
    
    switch (entry.errorCode) {
      case '404': // Undefined data model element
        steps.push(
          'Check if the data element name is spelled correctly',
          'Verify the element exists in the SCORM data model',
          'Ensure proper SCORM session initialization'
        );
        break;
      case '406': // Value not initialized
        steps.push(
          'Set the element before reading (per course logic)',
          'Verify you have called Initialize() first',
          'Ensure the session is not terminated'
        );
        break;
      case '407': // Read only
        steps.push(
          'Check if the data element is read-only',
          'Write to the correct writable element instead'
        );
        break;
      case '409': // Type mismatch
        steps.push(
          'Validate the data value format',
          'Check value length limits',
          'Ensure value matches expected data type'
        );
        break;
      default:
        steps.push(
          'Check SCORM package manifest for errors',
          'Verify API call sequence and timing',
          'Review SCORM specification compliance'
        );
    }
    
    return steps;
  }

  /**
   * Generate unique ID for entries
   * @returns {string} Unique identifier
   */
  generateId() {
    return `scorm-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Clear all SCORM inspection data
   */
  clear() {
    const clearedApiCalls = this.scormApiHistory.length;
    const clearedErrors = this.scormErrors.length;
    
  this.scormApiHistory = [];
  this.scormErrors = [];
  this.clearDataModelHistory();
    
    // Reset performance stats
    this.performanceStats = {
      totalStoreTime: 0,
      totalBroadcastTime: 0,
      storeCallCount: 0,
      broadcastCount: 0,
      memoryUsage: 0
    };
    
    this.logger?.info && this.logger.info(`[ScormInspectorTelemetryStore] Cleared ${clearedApiCalls} API calls and ${clearedErrors} errors`);
  }

  clearDataModelHistory({ suppressBroadcast = false } = {}) {
    const clearedCount = this.dataModelHistory.length;
    this.dataModelHistory = [];
    if (!suppressBroadcast && this.config.enableBroadcast) {
      this.broadcastToAllWindows('scorm-data-model-history-cleared', {
        timestamp: Date.now(),
        clearedCount
      });
    }
    this.logger?.info && this.logger.info(`[ScormInspectorTelemetryStore] Cleared ${clearedCount} data model changes`);
  }

  /**
   * Get current statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      totalApiCalls: this.scormApiHistory.length,
      totalErrors: this.scormErrors.length,
      criticalErrors: this.scormErrors.filter(e => e.severity === 'critical').length,
      highErrors: this.scormErrors.filter(e => e.severity === 'high').length,
      lastActivity: this.scormApiHistory.length > 0 ? 
        this.scormApiHistory[this.scormApiHistory.length - 1].timestamp : null,
      performance: this.performanceStats
    };
  }

  /**
   * Check memory usage and warn if high
   */
  checkMemoryUsage() {
    try {
      const memUsage = process.memoryUsage();
      this.performanceStats.memoryUsage = memUsage.heapUsed;
      
      if (memUsage.heapUsed > 100 * 1024 * 1024) { // 100MB threshold
        this.logger?.warn && this.logger.warn('[ScormInspectorTelemetryStore] High memory usage detected', {
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
          historySize: this.scormApiHistory.length,
          errorCount: this.scormErrors.length
        });
      }
    } catch (e) {
      // Ignore memory check failures
    }
  }
}

module.exports = ScormInspectorTelemetryStore;
