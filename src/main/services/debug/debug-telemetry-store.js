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

  /**
   * getHistory(options)
   * options: { limit, offset, sinceTs, methodFilter }
   * Returns newest-first array of entries (shallow copies).
   */
  getHistory(options = {}) {
    try {
      const { limit = null, offset = 0, sinceTs = null, methodFilter = null } = options || {};
      this.logger?.debug && this.logger.debug(`[DebugTelemetryStore] getHistory called. Current history size: ${this.history.length}, options: ${JSON.stringify(options)}`);
      // work on a shallow copy in reversed order (newest-first)
      let entries = [...this.history].reverse();

      // Apply sinceTs filter (timestamp is ms)
      if (sinceTs != null) {
        const since = Number(sinceTs) || 0;
        entries = entries.filter(e => (e.timestamp || 0) >= since);
        this.logger?.debug && this.logger.debug(`[DebugTelemetryStore] getHistory after sinceTs filter: ${entries.length} entries`);
      }

      // Apply methodFilter if provided (string or array)
      if (methodFilter) {
        const methods = Array.isArray(methodFilter) ? methodFilter.map(m => String(m)) : [String(methodFilter)];
        entries = entries.filter(e => methods.includes(e.method));
        this.logger?.debug && this.logger.debug(`[DebugTelemetryStore] getHistory after methodFilter: ${entries.length} entries`);
      }

      // Apply offset + limit on newest-first array
      const off = Math.max(0, Number(offset) || 0);
      if (limit != null) {
        const lim = Math.max(0, Number(limit) || 0);
        entries = entries.slice(off, off + lim);
      } else {
        entries = entries.slice(off);
      }
      this.logger?.debug && this.logger.debug(`[DebugTelemetryStore] getHistory returning ${entries.length} entries`);
      return entries;
    } catch (e) {
      try { this.logger?.warn && this.logger.warn('[DebugTelemetryStore] getHistory failed', e?.message || e); } catch (_) {}
      return [];
    }
  }

  /**
   * Flush current history to a debug window's webContents.
   * Sends newest-first so the debug UI can render new entries at top without reordering.
   */
  flushTo(webContents) {
    try {
      if (!webContents || (typeof webContents.send !== 'function')) {
        this.logger?.warn && this.logger.warn('[DebugTelemetryStore] flushTo called without valid webContents');
        return;
      }

      const entries = [...this.history].slice().reverse(); // newest-first
      this.logger?.info && this.logger.info(`[DebugTelemetryStore] Flushing ${entries.length} entries to debug window (newest-first)`);
      for (const entry of entries) {
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