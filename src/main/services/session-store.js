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
}

module.exports = SessionStore;
