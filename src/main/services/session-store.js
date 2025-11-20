const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const BaseService = require('./base-service');

class SessionStore extends BaseService {
  constructor(errorHandler, logger, options = {}) {
    super('SessionStore', errorHandler, logger, options);
    this.storePath = path.join(app.getPath('userData'), 'scorm-sessions');
  }

  async doInitialize() {
    try {
      if (!fs.existsSync(this.storePath)) {
        fs.mkdirSync(this.storePath, { recursive: true });
      }
      this.logger?.info(`SessionStore initialized at ${this.storePath}`);
      
      // Rotate old session files at startup (cleanup only, not part of course lifecycle)
      await this.rotateOldSessions();
    } catch (error) {
      this.logger?.error('Failed to initialize SessionStore', error);
      throw error;
    }
  }

  /**
   * Rotate old session JSON files (cleanup only - runs at app startup/shutdown)
   * Deletes session files older than 30 days to prevent accumulation
   * This is separate from course lifecycle - never called during course startup/shutdown
   */
  async rotateOldSessions() {
    try {
      const maxAgeMs = 30 * 24 * 60 * 60 * 1000; // 30 days
      const now = Date.now();
      
      const files = await fs.promises.readdir(this.storePath);
      const sessionFiles = files.filter(f => f.endsWith('.json'));
      
      let deletedCount = 0;
      for (const file of sessionFiles) {
        const filePath = path.join(this.storePath, file);
        try {
          const stats = await fs.promises.stat(filePath);
          const age = now - stats.mtime.getTime();
          
          if (age > maxAgeMs) {
            await fs.promises.unlink(filePath);
            deletedCount++;
          }
        } catch (err) {
          // Best-effort cleanup - continue on error
          this.logger?.warn(`Failed to check/delete old session file ${file}:`, err.message);
        }
      }
      
      if (deletedCount > 0) {
        this.logger?.info(`SessionStore: Rotated ${deletedCount} old session files (>30 days)`);
      }
    } catch (error) {
      // Non-fatal - log and continue
      this.logger?.warn('SessionStore: Failed to rotate old sessions:', error.message);
    }
  }

  getFilePath(courseId, namespace = 'gui') {
    // Sanitize courseId to be safe for filename
    const safeId = courseId.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const safeNamespace = namespace.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    return path.join(this.storePath, `${safeNamespace}_${safeId}.json`);
  }

  async saveSession(courseId, data, namespace = 'gui') {
    try {
      const filePath = this.getFilePath(courseId, namespace);
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
      this.logger?.debug(`Saved session for course ${courseId} (namespace: ${namespace})`);
      return true;
    } catch (error) {
      this.logger?.error(`Failed to save session for course ${courseId} (namespace: ${namespace})`, error);
      return false;
    }
  }

  async loadSession(courseId, namespace = 'gui') {
    try {
      const filePath = this.getFilePath(courseId, namespace);
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const content = await fs.promises.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      this.logger?.error(`Failed to load session for course ${courseId} (namespace: ${namespace})`, error);
      return null;
    }
  }

  /**
   * Delete session (manual cleanup only - not used in normal course lifecycle)
   * Only called by scorm_clear_saved_data tool and rotation cleanup
   */
  async deleteSession(courseId, namespace = 'gui') {
    try {
      const filePath = this.getFilePath(courseId, namespace);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        this.logger?.info(`Deleted session for course ${courseId} (namespace: ${namespace})`);
      }
      return true;
    } catch (error) {
      this.logger?.error(`Failed to delete session for course ${courseId} (namespace: ${namespace})`, error);
      return false;
    }
  }

  hasSession(courseId, namespace = 'gui') {
    try {
      const filePath = this.getFilePath(courseId, namespace);
      return fs.existsSync(filePath);
    } catch (error) {
      return false;
    }
  }

  async doShutdown() {
    // Rotate old sessions at shutdown as well (cleanup only)
    await this.rotateOldSessions();
    this.logger?.debug('SessionStore: Shutdown complete');
  }
}

module.exports = SessionStore;
