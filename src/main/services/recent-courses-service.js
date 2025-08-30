/**
 * Recent Courses Service
 *
 * Manages a Most Recently Used (MRU) list of SCORM courses, persisting it to a JSON file.
 * This service runs in the main process to ensure persistence across app restarts and
 * to bypass renderer-side localStorage limitations in sandboxed environments.
 *
 * @fileoverview Main process service for managing recent SCORM courses.
 */

const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');
const BaseService = require('./base-service');
const { MAIN_PROCESS_ERRORS } = require('../../shared/constants/error-codes');

const RECENT_FILE_NAME = 'recents.json';
const MAX_RECENT_ITEMS = 5; // User-defined limit

class RecentCoursesService extends BaseService {
  constructor(errorHandler, logger, options = {}) {
    super('RecentCoursesService', errorHandler, logger, options);
    this.recentsFilePath = path.join(app.getPath('userData'), RECENT_FILE_NAME);
    this.logger?.debug('RecentCoursesService: Constructor - userData path:', app.getPath('userData'));
    this.logger?.debug('RecentCoursesService: Constructor - recents file path:', this.recentsFilePath);
    this._items = [];
    this._saveInProgress = false; // Prevent concurrent saves
  }

  /**
   * Initializes the service by loading recent courses from the persistence file.
   * @protected
   */
  async doInitialize() {
    this.logger?.debug('RecentCoursesService: Starting initialization');
    await this._loadRecents();
    this.logger?.debug('RecentCoursesService: Initialization completed');
  }

  /**
   * Shuts down the service (no specific actions needed for shutdown beyond BaseService).
   * @protected
   */
  async doShutdown() {
    this.logger?.debug('RecentCoursesService: Starting shutdown');
    // No explicit save needed here, as _saveRecents is called on every update.
    this.logger?.debug('RecentCoursesService: Shutdown completed');
  }

  /**
   * Retrieves the current list of recent courses.
   * @returns {Array<Object>} An array of recent course objects.
   */
  async getRecents() {
    // Annotate each item with an exists boolean (non-destructive check)
    try {
      const annotated = await Promise.all(this._items.map(async (item) => {
        try {
          await fs.stat(item.path);
          return { ...item, exists: true };
        } catch (_) {
          return { ...item, exists: false };
        }
      }));
      return annotated;
    } catch (e) {
      this.logger?.warn('RecentCoursesService: Failed to annotate exists flags on recents', e?.message || e);
      return [...this._items];
    }
  }

  /**
   * Adds or updates a recent course entry. Moves the item to the top of the list.
   * @param {Object} course - The course object to add/update.
   * @param {'zip'|'folder'} course.type - The type of course (zip or folder).
   * @param {string} course.path - The file system path to the course.
   * @param {string} [course.displayName] - Optional display name for the course.
   * @param {Object} [course.meta] - Optional metadata for the course.
   * @returns {Array<Object>} The updated list of recent courses.
   */
  async addOrUpdateRecent(course) {
    const { type, path: coursePath } = course || {};
    if (!type || !coursePath) {
      this.logger?.warn('RecentCoursesService: Attempted to add invalid recent course', course);
      return this._items;
    }

    const now = Date.now();
    const existingIndex = this._items.findIndex(item => item.type === type && item.path === coursePath);

    if (existingIndex !== -1) {
      const existing = this._items[existingIndex];
      const updated = {
        ...existing,
        displayName: course.displayName || existing.displayName,
        meta: course.meta != null ? course.meta : existing.meta,
        lastOpenedTs: now
      };
      this._items.splice(existingIndex, 1);
      this._items.unshift(updated);
    } else {
      const newItem = {
        type,
        path: coursePath,
        displayName: course.displayName || undefined,
        meta: course.meta || undefined,
        lastOpenedTs: now
      };
      this._items.unshift(newItem);
    }

    // Cap the list size
    if (this._items.length > MAX_RECENT_ITEMS) {
      this._items.length = MAX_RECENT_ITEMS;
    }

    await this._saveRecents();
    this.logger?.info('RecentCoursesService: Added/updated recent course', { type, path: coursePath });
    return this._items;
  }

  /**
   * Removes a specific course from the recent list.
   * @param {'zip'|'folder'} type - The type of course.
   * @param {string} coursePath - The file system path to the course.
   * @returns {Array<Object>} The updated list of recent courses.
   */
  async removeRecent(type, coursePath) {
    const initialLength = this._items.length;
    this._items = this._items.filter(item => !(item.type === type && item.path === coursePath));
    if (this._items.length < initialLength) {
      await this._saveRecents();
      this.logger?.info('RecentCoursesService: Removed recent course', { type, path: coursePath });
    }
    return this._items;
  }

  /**
   * Clears all recent courses from the list.
   * @returns {Array<Object>} An empty array.
   */
  async clearRecents() {
    this._items = [];
    await this._saveRecents();
    this.logger?.info('RecentCoursesService: Cleared all recent courses');
    return this._items;
  }

  /**
   * Loads recent courses from the persistence file.
   * @private
   */
  async _loadRecents() {
    try {
      const data = await fs.readFile(this.recentsFilePath, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        // Basic validation and capping
        this._items = parsed
          .filter(item => item && (item.type === 'zip' || item.type === 'folder') && typeof item.path === 'string')
          .map(item => ({
            type: item.type,
            path: item.path,
            displayName: typeof item.displayName === 'string' ? item.displayName : undefined,
            meta: item.meta != null ? item.meta : undefined,
            lastOpenedTs: Number(item.lastOpenedTs) || 0
          }))
          .sort((a, b) => (b.lastOpenedTs || 0) - (a.lastOpenedTs || 0))
          .slice(0, MAX_RECENT_ITEMS);
        this.logger?.info(`RecentCoursesService: Loaded ${this._items.length} recent courses from file.`);
      } else {
        this._items = [];
        this.logger?.warn('RecentCoursesService: Recents file content is not an array, initializing empty list.');
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.logger?.info('RecentCoursesService: Recents file not found, initializing empty list.');
      } else {
        this.errorHandler?.setError(
          MAIN_PROCESS_ERRORS.FILE_SYSTEM_OPERATION_FAILED,
          `Failed to load recent courses: ${error.message}`,
          'RecentCoursesService._loadRecents'
        );
        this.logger?.error('RecentCoursesService: Failed to load recent courses', error);
      }
      this._items = [];
    }
  }

  /**
   * Saves the current list of recent courses to the persistence file.
   * @private
   */
  async _saveRecents() {
    // Prevent concurrent saves to avoid temp file conflicts
    if (this._saveInProgress) {
      this.logger?.debug('RecentCoursesService: _saveRecents - Save already in progress, skipping');
      return;
    }

    this._saveInProgress = true;

    try {
      const dir = path.dirname(this.recentsFilePath);
      this.logger?.debug('RecentCoursesService: _saveRecents - Directory path:', dir);
      this.logger?.debug('RecentCoursesService: _saveRecents - Full file path:', this.recentsFilePath);

      // Check if directory exists before mkdir
      try {
        const dirStats = await fs.stat(dir);
        this.logger?.debug('RecentCoursesService: _saveRecents - Directory exists before mkdir:', dirStats.isDirectory());
      } catch (statErr) {
        this.logger?.debug('RecentCoursesService: _saveRecents - Directory does not exist before mkdir:', statErr.code);
      }

      await fs.mkdir(dir, { recursive: true });

      // Check if directory exists after mkdir
      try {
        const dirStats = await fs.stat(dir);
        this.logger?.debug('RecentCoursesService: _saveRecents - Directory exists after mkdir:', dirStats.isDirectory());
      } catch (statErr) {
        this.logger?.debug('RecentCoursesService: _saveRecents - Directory does not exist after mkdir:', statErr.code);
      }

      // Write atomically: write to temp file then rename
      const tempPath = `${this.recentsFilePath}.tmp.${Date.now()}.${Math.random().toString(36).substr(2, 9)}`;
      this.logger?.debug('RecentCoursesService: _saveRecents - Temp file path:', tempPath);

      await fs.writeFile(tempPath, JSON.stringify(this._items, null, 2), 'utf8');

      // Check if temp file exists before rename
      try {
        const tempStats = await fs.stat(tempPath);
        this.logger?.debug('RecentCoursesService: _saveRecents - Temp file exists before rename:', tempStats.size, 'bytes');
      } catch (statErr) {
        this.logger?.debug('RecentCoursesService: _saveRecents - Temp file does not exist before rename:', statErr.code);
      }

      // Check permissions on directory
      try {
        const dirStats = await fs.stat(dir);
        this.logger?.debug('RecentCoursesService: _saveRecents - Directory permissions:', dirStats.mode?.toString(8));
      } catch (statErr) {
        this.logger?.debug('RecentCoursesService: _saveRecents - Cannot check directory permissions:', statErr.code);
      }

      try {
        await fs.rename(tempPath, this.recentsFilePath);
      } catch (renameErr) {
        // On Windows, rename may fail with EPERM/EACCES if another process briefly
        // holds the destination file (antivirus, indexer, etc.). Fall back to a
        // copy-then-unlink strategy for robustness.
        if (renameErr && (renameErr.code === 'EPERM' || renameErr.code === 'EACCES')) {
          try {
            await fs.copyFile(tempPath, this.recentsFilePath);
            await fs.unlink(tempPath);
            this.logger?.warn('RecentCoursesService: rename failed (EPERM/EACCES); used copy+unlink fallback.');
          } catch (fallbackErr) {
            // If fallback fails, try one more approach: direct write (non-atomic)
            try {
              await fs.writeFile(this.recentsFilePath, JSON.stringify(this._items, null, 2), 'utf8');
              await fs.unlink(tempPath).catch(() => {}); // Best effort cleanup
              this.logger?.warn('RecentCoursesService: fallback copy+unlink failed; used direct write.');
            } catch (directWriteErr) {
              // If all approaches fail, surface the original rename error for diagnostics
              this.logger?.warn('RecentCoursesService: All write strategies failed. Recent courses not persisted this time.');
              await fs.unlink(tempPath).catch(() => {}); // Best effort cleanup
              throw renameErr;
            }
          }
        } else {
          // Non-EPERM error - rethrow for outer handler
          throw renameErr;
        }
      }

      this.logger?.debug('RecentCoursesService: Saved recent courses to file (atomic write).');
    } catch (error) {
      this.errorHandler?.setError(
        MAIN_PROCESS_ERRORS.FILE_SYSTEM_OPERATION_FAILED,
        `Failed to save recent courses: ${error.message}`,
        'RecentCoursesService._saveRecents'
      );
      this.logger?.error('RecentCoursesService: Failed to save recent courses', error);
    } finally {
      this._saveInProgress = false;
    }
  }
}

module.exports = RecentCoursesService;