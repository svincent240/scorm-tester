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
    } catch (error) {
      this.logger?.error('Failed to initialize SessionStore', error);
      throw error;
    }
  }

  getFilePath(courseId) {
    // Sanitize courseId to be safe for filename
    const safeId = courseId.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    return path.join(this.storePath, `${safeId}.json`);
  }

  async saveSession(courseId, data) {
    try {
      const filePath = this.getFilePath(courseId);
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
      this.logger?.debug(`Saved session for course ${courseId}`);
      return true;
    } catch (error) {
      this.logger?.error(`Failed to save session for course ${courseId}`, error);
      return false;
    }
  }

  async loadSession(courseId) {
    try {
      const filePath = this.getFilePath(courseId);
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const content = await fs.promises.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      this.logger?.error(`Failed to load session for course ${courseId}`, error);
      return null;
    }
  }

  async deleteSession(courseId) {
    try {
      const filePath = this.getFilePath(courseId);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        this.logger?.info(`Deleted session for course ${courseId}`);
      }
      return true;
    } catch (error) {
      this.logger?.error(`Failed to delete session for course ${courseId}`, error);
      return false;
    }
  }

  hasSession(courseId) {
    try {
      const filePath = this.getFilePath(courseId);
      return fs.existsSync(filePath);
    } catch (error) {
      return false;
    }
  }
}

module.exports = SessionStore;
