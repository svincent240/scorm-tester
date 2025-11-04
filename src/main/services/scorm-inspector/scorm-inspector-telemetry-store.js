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
    const { maxHistorySize = 2000, logger = null, enableBroadcast = true } = options;
    
    this.config = {
      maxHistorySize: Number(maxHistorySize) || 2000,
      enableBroadcast: Boolean(enableBroadcast),
      retentionTimeMs: 3600000, // 1 hour
      ...options
    };
    
    this.logger = logger || console;
    
    // Ring buffer for SCORM API call history
    this.scormApiHistory = [];
    this.scormErrors = [];
    
    // Window manager reference for broadcasting
    this.windowManager = null;
    
    // Performance tracking
    this.performanceStats = {
      totalStoreTime: 0,
      totalBroadcastTime: 0,
      storeCallCount: 0,
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
        ...data
      };
      
      // Ensure timestamp is set
      if (!entry.timestamp) entry.timestamp = Date.now();
      
      // Add to ring buffer
      this.scormApiHistory.push(entry);
      this.trimHistory();
      
      // Classify and store errors separately
      if (data.errorCode && data.errorCode !== '0') {
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
      } catch (_) {}
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
      } catch (_) {}
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
        filteredHistory = filteredHistory.filter(entry => (entry.timestamp || 0) >= since);
        this.logger?.debug && this.logger.debug(`[ScormInspectorTelemetryStore] getHistory after sinceTs filter: ${filteredHistory.length} entries`);
      }
      
      if (methodFilter) {
        const methods = Array.isArray(methodFilter) ? methodFilter.map(m => String(m)) : [String(methodFilter)];
        filteredHistory = filteredHistory.filter(entry => methods.includes(entry.method));
        this.logger?.debug && this.logger.debug(`[ScormInspectorTelemetryStore] getHistory after methodFilter: ${filteredHistory.length} entries`);
      }
      
      // Sort newest first, then apply pagination
      filteredHistory.sort((a, b) => b.timestamp - a.timestamp);
      
      // Apply offset + limit
      const off = Math.max(0, Number(offset) || 0);
      if (limit != null) {
        const lim = Math.max(0, Number(limit) || 0);
        filteredHistory = filteredHistory.slice(off, off + lim);
      } else {
        filteredHistory = filteredHistory.slice(off);
      }
      
      this.logger?.debug && this.logger.debug(`[ScormInspectorTelemetryStore] getHistory returning ${filteredHistory.length} entries`);
      
      return {
        success: true,
        history: filteredHistory,
        total: this.scormApiHistory.length,
        hasMore: this.scormApiHistory.length > (off + filteredHistory.length)
      };
      
    } catch (e) {
      try { 
        this.logger?.warn && this.logger.warn('[ScormInspectorTelemetryStore] getHistory failed', e?.message || e); 
      } catch (_) {}
      return {
        success: false,
        history: [],
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
      } catch (_) {}
      return {
        success: false,
        errors: [],
        total: 0,
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
      let broadcastCount = 0;
      
      windows.forEach(window => {
        if (window && !window.isDestroyed()) {
          try {
            window.webContents.send(channel, data);
            broadcastCount++;
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
      } catch (_) {}
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
    return `scorm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clear all SCORM inspection data
   */
  clear() {
    const clearedApiCalls = this.scormApiHistory.length;
    const clearedErrors = this.scormErrors.length;
    
    this.scormApiHistory = [];
    this.scormErrors = [];
    
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
