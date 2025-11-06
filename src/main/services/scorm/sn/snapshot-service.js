"use strict";

/**
 * SNSnapshotService
 * - Polls SN service status periodically (if available) and caches the last good snapshot.
 * - Provides getStatus() for fast responses to IPC handlers.
 *
 * Usage:
 *   const svc = new SNSnapshotService(scormService, { pollIntervalMs: 2000, logger });
 *   svc.startPolling();
 *   // later: svc.getStatus();
 *   // shutdown: svc.stopPolling();
 */

class SNSnapshotService {
  constructor(scormService = null, options = {}) {
    const { pollIntervalMs = 2000, logger = null } = options;
    this.scormService = scormService;
    this.pollIntervalMs = Number(pollIntervalMs) || 2000;
    this.logger = logger || console;
    this.timer = null;
    this._isPolling = false;

    // Last known good snapshot shape
    this.lastSnapshot = {
      success: true,
      initialized: false,
      sessionState: 'not_initialized',
      availableNavigation: []
    };
  }

  async _fetchStatus() {
    try {
      if (!this.scormService || typeof this.scormService.getSNService !== 'function') {
        // Nothing to poll
        return null;
      }
      const snService = this.scormService.getSNService();
      if (!snService || typeof snService.getStatus !== 'function') {
        return null;
      }
      const status = await Promise.resolve().then(() => snService.getStatus());
      if (status && typeof status === 'object') {
        // Merge into lastSnapshot for stable shape
        this.lastSnapshot = { success: true, ...status };
        return this.lastSnapshot;
      }
      return null;
    } catch (e) {
      try { this.logger?.warn && this.logger.warn('[SNSnapshotService] Poll failed', e?.message || e); } catch (_) { /* intentionally empty */ }
      return null;
    }
  }

  async _pollOnce() {
    const result = await this._fetchStatus();
    if (!result) {
      this.logger?.warn && this.logger.warn('[SNSnapshotService] Poll returned no result');
    }
  }

  async _pollLoop() {
    try {
      await this._pollOnce();
    } catch (e) {
      // swallow to keep polling alive
    } finally {
      if (this._isPolling && !this.timer) {
        // schedule next poll
        this.timer = setTimeout(() => {
          this.timer = null;
          this._pollLoop().catch(() => { /* intentionally empty */ }));
        }, this.pollIntervalMs);
      }
    }
  }

  startPolling() {
    if (this._isPolling) return;
    this._isPolling = true;
    // Kick off immediate poll
    this._pollLoop().catch(() => { /* intentionally empty */ }));
    this.logger?.info && this.logger.info('[SNSnapshotService] Started polling SN status');
  }

  stopPolling() {
    this._isPolling = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.logger?.info && this.logger.info('[SNSnapshotService] Stopped polling SN status');
  }

  /**
   * getStatus
   * - returns cached lastSnapshot quickly
   * - optionally forces a refresh when force=true and returns fresh value
   */
  async getStatus(options = {}) {
    const { force = false } = options || {};
    if (force) {
      const fresh = await this._fetchStatus();
      return fresh || this.lastSnapshot;
    }
    return this.lastSnapshot;
  }
}

module.exports = SNSnapshotService;