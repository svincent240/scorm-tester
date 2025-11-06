// @ts-check

/**
 * Recent Courses MRU Store
 *
 * Persists a capped list of recently opened SCORM sources (zip or folder).
 * - Dedupe by (type + path)
 * - Move-to-top on add/touch
 * - Cap max items
 * - Persist to localStorage
 * - No browser console logs; use renderer-logger if available
 */

import { ipcClient } from './ipc-client.js';

const MAX_ITEMS = 5; // User-defined limit

/**
 * @typedef {'zip'|'folder'} RecentType
 * @typedef {Object} RecentItem
 * @property {RecentType} type
 * @property {string} path
 * @property {string=} displayName
 * @property {Object=} meta
 * @property {number} lastOpenedTs
 */

class RecentCoursesStore {
  constructor() {
    this._items = [];
    this._logger = { info() {}, warn() {}, error() {}, debug() {} };

    // Lazy import logger to avoid cyclic imports
    import('../utils/renderer-logger.js')
      .then(({ rendererLogger }) => { if (rendererLogger) this._logger = rendererLogger; })
      .catch(() => { /* keep no-op */ });

    this._loadedPromise = this._load();
  }

  /**
   * Internal: load from main process via IPC
   */
  async _load() {
    try {

      const result = await ipcClient.recentCoursesGet();
      if (result.success && Array.isArray(result.recents)) {
        this._items = result.recents;
        this._logger.info(`RecentCoursesStore: Loaded ${this._items.length} recent courses from main process.`);
      } else {
        this._items = [];
        this._logger.error('RecentCoursesStore: Failed to load recents from main process', result.error);
      }
    } catch (e) {
      this._items = [];
      this._logger.error('RecentCoursesStore: Error loading recents from main process', e?.message || e);
    }
  }

  /**
   * Get a snapshot of all items (most-recent first)
   * @returns {RecentItem[]}
   */

  /**
   * Ensure the initial async load has completed
   */
  async ensureLoaded() {
    try {
      if (!this._loadedPromise) this._loadedPromise = this._load();
      await this._loadedPromise;
    } catch (_) { /* swallow */ }
  }

  getAll() {
    return [...this._items];
  }

  /**
   * Add or update an entry and move it to top.
   * @param {{type: RecentType, path: string, displayName?: string, meta?: any}} desc
   */
  async addOrUpdate(desc) {
    const { type, path } = desc || {};
    if (!type || !path) return;

    const now = Date.now();
    const idx = this._findIndex(type, path);

    if (idx !== -1) {
      const existing = this._items[idx];
      const updated = {
        ...existing,
        displayName: desc.displayName || existing.displayName,
        meta: desc.meta != null ? desc.meta : existing.meta,
        lastOpenedTs: now
      };
      this._items.splice(idx, 1);
      this._items.unshift(updated);
    } else {
      const item = {
        type,
        path,
        displayName: desc.displayName || undefined,
        meta: desc.meta || undefined,
        lastOpenedTs: now
      };
      this._items.unshift(item);
    }

    // Cap list
    if (this._items.length > MAX_ITEMS) {
      this._items.length = MAX_ITEMS;
    }

     await this._save();
     try { this._logger.info('RecentCoursesStore: addOrUpdate', { type, path }); } catch (_) { /* intentionally empty */ }
   }

  /**
   * Touch an existing item (update lastOpenedTs and move to top)
   * @param {string} path
   * @param {RecentType} type
   */
  async touch(path, type) {
    if (!path || !type) return;
    const idx = this._findIndex(type, path);
    if (idx === -1) return;
    const existing = this._items[idx];
    existing.lastOpenedTs = Date.now();
    this._items.splice(idx, 1);
    this._items.unshift(existing);
    await this._save();
    try { this._logger.debug('RecentCoursesStore: touch', { type, path }); } catch (_) { /* intentionally empty */ }
  }

  /**
   * Remove an item by (type, path)
   * @param {string} path
   * @param {RecentType} type
   */
  async removeByPathType(path, type) {
    const idx = this._findIndex(type, path);
    if (idx === -1) return;
    const removed = this._items.splice(idx, 1);
    await this._save();
    try { this._logger.info('RecentCoursesStore: remove', { type, path, removed: removed?.length || 0 }); } catch (_) { /* intentionally empty */ }
  }

  /**
   * Clear all items
   */
  async clear() {
    this._items = [];
    await this._save();
    try { this._logger.warn('RecentCoursesStore: clear all'); } catch (_) { /* intentionally empty */ }
  }

  /**
   * Internal: find index by (type, path)
   * @param {RecentType} type
   * @param {string} path
   * @returns {number}
   */
  _findIndex(type, path) {
    const needleType = String(type);
    const needlePath = String(path);
    return this._items.findIndex(it => it.type === needleType && it.path === needlePath);
  }

  /**
   * Internal: save to main process via IPC
   */
  async _save() {
    try {

      // The main process service manages the actual list, so we just tell it to add/update
      // the current state of the item that was just modified.
      // For simplicity, we'll re-add all current items to ensure the main process has the correct order and cap.
      // A more optimized approach would be to send only the changed item and let the main process manage the list.
      // However, given the small size of the MRU list, this is acceptable.
      const result = await ipcClient.recentCoursesAddOrUpdate(this._items[0]); // Send the most recent item
      if (!result.success) {
        this._logger.error('RecentCoursesStore: Failed to save recents to main process', result.error);
      }
    } catch (e) {
      this._logger.error('RecentCoursesStore: Error saving recents to main process', e?.message || e);
    }
  }
}

const recentCoursesStore = new RecentCoursesStore();

export { RecentCoursesStore, recentCoursesStore };