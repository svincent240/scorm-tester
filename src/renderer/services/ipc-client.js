// @ts-check

/**
 * Renderer IPC Client
 *
 * A thin, fail-fast wrapper around the preload-exposed window.electronAPI.
 * Centralizes all renderer -> main IPC usage so components/services don't
 * touch window.electronAPI directly.
 */

import { rendererLogger } from '../utils/renderer-logger.js';

class IpcClient {
  _ensureAPI() {
    if (typeof window === 'undefined' || !window.electronAPI) {
      const err = new Error('Electron API not available in renderer');
      try { rendererLogger.error('IpcClient: missing electronAPI'); } catch (_) {}
      throw err;
    }
    return window.electronAPI;
  }

  // Generic invoke
  async invoke(channel, data = {}) {
    const api = this._ensureAPI();
    if (typeof api.invoke !== 'function') {
      throw new Error('electronAPI.invoke not available');
    }
    return api.invoke(channel, data);
  }

  // UI settings
  async uiGetSettings() {
    const api = this._ensureAPI();
    if (!api.ui || typeof api.ui.getSettings !== 'function') {
      throw new Error('electronAPI.ui.getSettings not available');
    }
    return api.ui.getSettings();
  }

  async uiSetSettings(payload) {
    const api = this._ensureAPI();
    if (!api.ui || typeof api.ui.setSettings !== 'function') {
      throw new Error('electronAPI.ui.setSettings not available');
    }
    return api.ui.setSettings(payload);
  }

  // Course selection
  async selectScormPackage() {
    const api = this._ensureAPI();
    if (typeof api.selectScormPackage !== 'function') {
      throw new Error('electronAPI.selectScormPackage not available');
    }
    return api.selectScormPackage();
  }

  async selectScormFolder() {
    const api = this._ensureAPI();
    if (typeof api.selectScormFolder !== 'function') {
      throw new Error('electronAPI.selectScormFolder not available');
    }
    return api.selectScormFolder();
  }

  // Path utils
  async prepareCourseSource(desc) {
    const api = this._ensureAPI();
    if (!api.pathUtils || typeof api.pathUtils.prepareCourseSource !== 'function') {
      throw new Error('electronAPI.pathUtils.prepareCourseSource not available');
    }
    return api.pathUtils.prepareCourseSource(desc);
  }

  // File operations
  async saveTemporaryFile(name, base64Data) {
    const api = this._ensureAPI();
    if (typeof api.saveTemporaryFile !== 'function') {
      throw new Error('electronAPI.saveTemporaryFile not available');
    }
    return api.saveTemporaryFile(name, base64Data);
  }

  // SCORM manifest/CAM
  async getCourseManifest(unifiedPath) {
    const api = this._ensureAPI();
    if (typeof api.getCourseManifest !== 'function') {
      throw new Error('electronAPI.getCourseManifest not available');
    }
    return api.getCourseManifest(unifiedPath);
  }

  async processScormManifest(unifiedPath, manifestContent) {
    const api = this._ensureAPI();
    if (typeof api.processScormManifest !== 'function') {
      throw new Error('electronAPI.processScormManifest not available');
    }
    return api.processScormManifest(unifiedPath, manifestContent);
  }

  // Recents
  async recentCoursesGet() {
    const api = this._ensureAPI();
    if (!api.recentCourses || typeof api.recentCourses.get !== 'function') {
      throw new Error('electronAPI.recentCourses.get not available');
    }
    return api.recentCourses.get();
  }

  async recentCoursesAddOrUpdate(item) {
    const api = this._ensureAPI();
    if (!api.recentCourses || typeof api.recentCourses.addOrUpdate !== 'function') {
      throw new Error('electronAPI.recentCourses.addOrUpdate not available');
    }
    return api.recentCourses.addOrUpdate(item);
  }

}

const ipcClient = new IpcClient();
export { IpcClient, ipcClient };

