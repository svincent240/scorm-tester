"use strict";

/**
 * DebugTelemetryStore
 * - storeApiCall(data)
 * - clear()
 * - getHistory()
 * - flushTo(webContents)
 *
 * Keeps a bounded in-memory ring of debug/telemetry events (API call traces).
 * Designed to be simple and synchronous so callers can delegate quickly.
 */

class DebugTelemetryStore {
  constructor(options = {}) {
    const { maxSize = 5000, logger = null } = options;
    this.maxSize = Number(maxSize) || 5000;
    this.logger = logger || console;
    this.history = [];
  }

  storeApiCall(data) {
    try {
      if (!data || typeof data !== 'object') return;
      const entry = { ...data };
      if (!entry.timestamp) entry.timestamp = Date.now();
      this.history.push(entry);

      if (this.history.length > this.maxSize) {
        const removeCount = this.history.length - this.maxSize;
        this.history.splice(0, removeCount);
        this.logger?.warn && this.logger.warn(`[DebugTelemetryStore] Trimmed ${removeCount} oldest entries (maxSize=${this.maxSize})`);
      }

      this.logger?.debug && this.logger.debug(`[DebugTelemetryStore] Stored api call (total=${this.history.length})`);
    } catch (e) {
      // Never throw from telemetry store; log and continue.
      try { this.logger?.warn && this.logger.warn('[DebugTelemetryStore] Failed to store api call', e?.message || e); } catch (_) {}
    }
  }

  clear() {
    const cleared = this.history.length;
    this.history = [];
    this.logger?.info && this.logger.info(`[DebugTelemetryStore] Cleared ${cleared} entries`);
  }

  getHistory() {
    // Return a shallow copy to prevent external mutation.
    return [...this.history];
  }

  flushTo(webContents) {
    try {
      if (!webContents || (typeof webContents.send !== 'function')) {
        this.logger?.warn && this.logger.warn('[DebugTelemetryStore] flushTo called without valid webContents');
        return;
      }

      this.logger?.info && this.logger.info(`[DebugTelemetryStore] Flushing ${this.history.length} entries to debug window`);
      for (const entry of this.history) {
        try {
          webContents.send('debug-event-received', 'api:call', entry);
        } catch (e) {
          // If a single send fails, log and continue sending the rest.
          this.logger?.warn && this.logger.warn('[DebugTelemetryStore] Failed to send entry to webContents', e?.message || e);
        }
      }
    } catch (e) {
      try { this.logger?.warn && this.logger.warn('[DebugTelemetryStore] flushTo failed', e?.message || e); } catch (_) {}
    }
  }
}

module.exports = DebugTelemetryStore;