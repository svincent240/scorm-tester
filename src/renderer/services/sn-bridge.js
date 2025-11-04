/**
 * Sequencing and Navigation Bridge Service
 *
 * Provides a bridge between the renderer process and the main process
 * SCORM SN (Sequencing and Navigation) service. This ensures proper
 * SCORM compliance by delegating navigation logic to the main process.
 *
 * @fileoverview SN service IPC bridge
 */

import { ipcClient } from './ipc-client.js';

/**
 * SN Bridge Class
 *
 * Handles communication with the main process SN service via IPC
 */
class SNBridge {
  constructor() {
    this.isConnected = false;
    this.sessionId = null;
    this.logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    // Initialize renderer logger asynchronously with safe fallback
    try {
      import('../utils/renderer-logger.js').then(({ rendererLogger }) => {
        if (rendererLogger) this.logger = rendererLogger;
      }).catch(() => {});
    } catch (_) {}
  }

  /**
   * Initialize connection to main process SN service
   */
  async initialize() {
    try {
      const status = await ipcClient.invoke('sn:getStatus');
      if (status && status.success) {
        this.isConnected = true;
        try { this.logger.debug('SNBridge: Connected to main process SN service'); } catch (_) {}
        return { success: true };
      }
      throw new Error('Failed to connect to SN service');
    } catch (error) {
      try { this.logger.error('SNBridge: Failed to initialize', error?.message || error); } catch (_) {}
      return { success: false, error: error?.message || String(error) };
    }
  }

  /**
   * Initialize SN service with course manifest
   */
  async initializeCourse(manifest, packageInfo = {}) {
    try {
      const result = await this.invokeMain('sn:initialize', { manifest, packageInfo });
      if (result.success) {
        this.sessionId = result.sessionId;
        try { this.logger.debug('SNBridge: Course initialized with SN service'); } catch (_) {}
      }
      return result;
    } catch (error) {
      try { this.logger.error('SNBridge: Failed to initialize course', error?.message || error); } catch (_) {}
      return { success: false, error: error.message };
    }
  }

  /**
   * Process navigation request
   */
  async processNavigation(navigationRequest, targetActivityId = null) {
    try {
      if (!this.isConnected) {
        throw new Error('SN service not connected');
      }

      const result = await this.invokeMain('sn:processNavigation', {
        navigationRequest,
        targetActivityId
      });

      try { this.logger.debug('SNBridge: Navigation processed', result); } catch (_) {}
      return result;
    } catch (error) {
      try { this.logger.error('SNBridge: Navigation processing failed', error?.message || error); } catch (_) {}
      return { success: false, error: error.message };
    }
  }

  /**
   * Update activity progress
   */
  async updateActivityProgress(activityId, progressData) {
    try {
      if (!this.isConnected) {
        throw new Error('SN service not connected');
      }

      const result = await this.invokeMain('sn:updateActivityProgress', {
        activityId,
        progressData
      });

      return result;
    } catch (error) {
      try { this.logger.error('SNBridge: Failed to update activity progress', error?.message || error); } catch (_) {}
      return { success: false, error: error.message };
    }
  }

  /**
   * Get current sequencing state
   */
  async getSequencingState() {
    try {
      if (!this.isConnected) {
        throw new Error('SN service not connected');
      }

      const result = await this.invokeMain('sn:getSequencingState');
      return result;
    } catch (error) {
      try { this.logger.error('SNBridge: Failed to get sequencing state', error?.message || error); } catch (_) {}
      return { success: false, error: error.message };
    }
  }

  /**
   * Refresh navigation availability
   */
  async refreshNavigationAvailability() {
    try {
      if (!this.isConnected) {
        throw new Error('SN service not connected');
      }

      const result = await this.invokeMain('sn:refreshNavigation');
      return result;
    } catch (error) {
      try { this.logger.error('SNBridge: Failed to refresh navigation availability', error?.message || error); } catch (_) {}
      return { success: false, error: error.message };
    }
  }

  /**
   * Reset SN service
   */
  async reset() {
    try {
      if (!this.isConnected) {
        return { success: true }; // Already reset
      }

      const result = await this.invokeMain('sn:reset');
      this.sessionId = null;
      return result;
    } catch (error) {
      try { this.logger.error('SNBridge: Failed to reset SN service', error?.message || error); } catch (_) {}
      return { success: false, error: error.message };
    }
  }

  /**
   * Get SN service status
   */
  async getStatus() {
    try {
      const result = await this.invokeMain('sn:getStatus');
      return result;
    } catch (error) {
      try { this.logger.error('SNBridge: Failed to get status', error?.message || error); } catch (_) {}
      return { success: false, error: error.message };
    }
  }

  /**
   * Invoke main process method
   * @private
   */
  async invokeMain(channel, data = {}) {
    try {
      return await ipcClient.invoke(channel, data);
    } catch (error) {
      try { this.logger.error(`SNBridge: IPC call failed for ${channel}`, error?.message || error); } catch (_) {}
      throw error;
    }
  }

  /**
   * Check if SN service is connected
   */
  isServiceConnected() {
    return this.isConnected;
  }

  /**
   * Get current session ID
   */
  getSessionId() {
    return this.sessionId;
  }
  /**
   * Get course outline activity tree
   */
  async getCourseOutlineActivityTree() {
    try {
      return await ipcClient.invoke('course-outline-get-activity-tree');
    } catch (error) {
      try { this.logger.error('SNBridge: getCourseOutlineActivityTree failed', error?.message || error); } catch (_) {}
      return { success: false, error: error?.message || String(error) };
    }
  }

  /**
   * Get available navigation options
   */
  async getCourseOutlineAvailableNavigation() {
    try {
      return await ipcClient.invoke('course-outline-get-available-navigation');
    } catch (error) {
      try { this.logger.error('SNBridge: getCourseOutlineAvailableNavigation failed', error?.message || error); } catch (_) {}
      return { success: false, error: error?.message || String(error) };
    }
  }

  /**
   * Validate choice navigation for a given activity id
   */
  async validateCourseOutlineChoice(activityId) {
    try {
      return await ipcClient.invoke('course-outline-validate-choice', { targetActivityId: activityId });
    } catch (error) {
      try { this.logger.error('SNBridge: validateCourseOutlineChoice failed', error?.message || error); } catch (_) {}
      return { success: false, allowed: false, reason: error?.message || String(error) };
    }
  }

  /** Inspector data getters */
  async getScormInspectorHistory() {
    try {
      return await ipcClient.invoke('scorm-inspector-get-history');
    } catch (error) {
      try { this.logger.error('SNBridge: getScormInspectorHistory failed', error?.message || error); } catch (_) {}
      return { success: false, error: error?.message || String(error) };
    }
  }

  async getScormDataModel() {
    try {
      return await ipcClient.invoke('scorm-inspector-get-data-model');
    } catch (error) {
      try { this.logger.error('SNBridge: getScormDataModel failed', error?.message || error); } catch (_) {}
      return { success: false, error: error?.message || String(error) };
    }
  }

  async getSnState() {
    try {
      return await ipcClient.invoke('scorm-inspector-get-sn-state');
    } catch (error) {
      try { this.logger.error('SNBridge: getSnState failed', error?.message || error); } catch (_) {}
      return { success: false, error: error?.message || String(error) };
    }
  }

  async getActivityTree() {
    try {
      return await ipcClient.invoke('scorm-inspector-get-activity-tree');
    } catch (error) {
      try { this.logger.error('SNBridge: getActivityTree failed', error?.message || error); } catch (_) {}
      return { success: false, error: error?.message || String(error) };
    }
  }

  async getNavigationRequests() {
    try {
      return await ipcClient.invoke('scorm-inspector-get-navigation-requests');
    } catch (error) {
      try { this.logger.error('SNBridge: getNavigationRequests failed', error?.message || error); } catch (_) {}
      return { success: false, error: error?.message || String(error) };
    }
  }

  async getGlobalObjectives() {
    try {
      return await ipcClient.invoke('scorm-inspector-get-global-objectives');
    } catch (error) {
      try { this.logger.error('SNBridge: getGlobalObjectives failed', error?.message || error); } catch (_) {}
      return { success: false, error: error?.message || String(error) };
    }
  }

  async getSSPBuckets() {
    try {
      return await ipcClient.invoke('scorm-inspector-get-ssp-buckets');
    } catch (error) {
      try { this.logger.error('SNBridge: getSSPBuckets failed', error?.message || error); } catch (_) {}
      return { success: false, error: error?.message || String(error) };
    }
  }

  /** Subscribe to main-pushed inspector updates */
  onScormInspectorDataUpdated(handler) {
    try {
      if (typeof handler === 'function') {
        return ipcClient.onScormInspectorDataUpdated(handler);
      }
    } catch (_) {}
    return () => {};
  }

  /** Subscribe to data model updates */
  onScormDataModelUpdated(handler) {
    try {
      if (typeof handler === 'function') {
        return ipcClient.onScormDataModelUpdated(handler);
      }
    } catch (_) {}
    return () => {};
  }

  /** Clear SCORM Inspector data */
  async clearScormInspector() {
    try {
      return await ipcClient.clearScormInspector();
    } catch (error) {
      console.error('[SNBridge] clearScormInspector failed:', error);
      return { success: false, error: error.message };
    }
  }

  /** Subscribe to course loaded events */
  onCourseLoaded(handler) {
    try {
      if (typeof handler === 'function') {
        return ipcClient.onCourseLoaded(handler);
      }
    } catch (_) {}
    return () => {};
  }

}

// Create and export singleton instance
const snBridge = new SNBridge();

export { SNBridge, snBridge };