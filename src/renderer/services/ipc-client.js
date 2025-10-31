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

  // Event subscriptions
  onMenuEvent(handler) {
    const api = this._ensureAPI();
    if (typeof api.onMenuEvent !== 'function') {
      throw new Error('electronAPI.onMenuEvent not available');
    }
    return api.onMenuEvent(handler);
  }

  onActivityProgressUpdated(handler) {
    const api = this._ensureAPI();
    if (typeof api.onActivityProgressUpdated !== 'function') {
      throw new Error('electronAPI.onActivityProgressUpdated not available');
    }
    return api.onActivityProgressUpdated(handler);
  }

  onObjectivesUpdated(handler) {
    const api = this._ensureAPI();
    if (typeof api.onObjectivesUpdated !== 'function') {
      throw new Error('electronAPI.onObjectivesUpdated not available');
    }
    return api.onObjectivesUpdated(handler);
  }

  onNavigationCompleted(handler) {
    const api = this._ensureAPI();
    if (typeof api.onNavigationCompleted !== 'function') {
      throw new Error('electronAPI.onNavigationCompleted not available');
    }
    return api.onNavigationCompleted(handler);
  }

  onScormApiCallLogged(handler) {
    const api = this._ensureAPI();
    if (typeof api.onScormApiCallLogged !== 'function') {
      throw new Error('electronAPI.onScormApiCallLogged not available');
    }
    return api.onScormApiCallLogged(handler);
  }

  onScormInspectorDataUpdated(handler) {
    const api = this._ensureAPI();
    if (typeof api.onScormInspectorDataUpdated !== 'function') {
      throw new Error('electronAPI.onScormInspectorDataUpdated not available');
    }
    return api.onScormInspectorDataUpdated(handler);
  }

  onNavigationAvailabilityUpdated(handler) {
    const api = this._ensureAPI();
    if (typeof api.onNavigationAvailabilityUpdated !== 'function') {
      throw new Error('electronAPI.onNavigationAvailabilityUpdated not available');
    }
    return api.onNavigationAvailabilityUpdated(handler);
  }

  onRendererConsoleError(handler) {
    const api = this._ensureAPI();
    if (typeof api.onRendererConsoleError !== 'function') {
      throw new Error('electronAPI.onRendererConsoleError not available');
    }
    return api.onRendererConsoleError(handler);
  }

  onCourseLoaded(handler) {
    const api = this._ensureAPI();
    if (typeof api.onCourseLoaded !== 'function') {
      throw new Error('electronAPI.onCourseLoaded not available');
    }
    return api.onCourseLoaded(handler);
  }

  onCourseExited(handler) {
    const api = this._ensureAPI();
    if (typeof api.onCourseExited !== 'function') {
      throw new Error('electronAPI.onCourseExited not available');
    }
    return api.onCourseExited(handler);
  }

  // SCORM typed helpers (preserve positional arg shapes exposed by preload)
  async scormInitialize(sessionId, options = {}) {
    const api = this._ensureAPI();
    if (typeof api.scormInitialize !== 'function') {
      throw new Error('electronAPI.scormInitialize not available');
    }
    return api.scormInitialize(sessionId, options);
  }

  async scormGetProgressSnapshot(sessionId) {
    const api = this._ensureAPI();
    if (typeof api.scormGetProgressSnapshot !== 'function') {
      throw new Error('electronAPI.scormGetProgressSnapshot not available');
    }
    return api.scormGetProgressSnapshot(sessionId);
  }

  async scormTerminate(sessionId, exitValue = '') {
    const api = this._ensureAPI();
    if (typeof api.scormTerminate !== 'function') {
      throw new Error('electronAPI.scormTerminate not available');
    }
    return api.scormTerminate(sessionId, exitValue);
  }

  async scormGetValue(sessionId, element) {
    const api = this._ensureAPI();
    if (typeof api.scormGetValue !== 'function') {
      throw new Error('electronAPI.scormGetValue not available');
    }
    return api.scormGetValue(sessionId, element);
  }

  async scormSetValue(sessionId, element, value) {
    const api = this._ensureAPI();
    if (typeof api.scormSetValue !== 'function') {
      throw new Error('electronAPI.scormSetValue not available');
    }
    return api.scormSetValue(sessionId, element, value);
  }

  async scormSetValuesBatch(sessionId, batch) {
    const api = this._ensureAPI();
    if (typeof api.scormSetValuesBatch !== 'function') {
      throw new Error('electronAPI.scormSetValuesBatch not available');
    }
    return api.scormSetValuesBatch(sessionId, batch);
  }

  async scormCommit(sessionId) {
    const api = this._ensureAPI();
    if (typeof api.scormCommit !== 'function') {
      throw new Error('electronAPI.scormCommit not available');
    }
    return api.scormCommit(sessionId);
  }


}

const ipcClient = new IpcClient();
export { IpcClient, ipcClient };

