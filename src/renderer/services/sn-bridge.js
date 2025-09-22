/**
 * Sequencing and Navigation Bridge Service
 *
 * Provides a bridge between the renderer process and the main process
 * SCORM SN (Sequencing and Navigation) service. This ensures proper
 * SCORM compliance by delegating navigation logic to the main process.
 *
 * @fileoverview SN service IPC bridge
 */

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
      if (!window.electronAPI) {
        throw new Error('Electron API not available');
      }

      // Test connection to main process
      const status = await this.invokeMain('sn:getStatus');
      if (status.success) {
        this.isConnected = true;
        try { this.logger.debug('SNBridge: Connected to main process SN service'); } catch (_) {}
        return { success: true };
      } else {
        throw new Error('Failed to connect to SN service');
      }
    } catch (error) {
      try { this.logger.error('SNBridge: Failed to initialize', error?.message || error); } catch (_) {}
      return { success: false, error: error.message };
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
    if (!window.electronAPI || !window.electronAPI.invoke) {
      throw new Error('Electron IPC not available');
    }

    try {
      const result = await window.electronAPI.invoke(channel, data);
      return result;
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
   * Get course outline activity tree (renderer-safe wrapper)
   */
  async getCourseOutlineActivityTree() {
    try {
      if (window.electronAPI?.getCourseOutlineActivityTree) {
        return await window.electronAPI.getCourseOutlineActivityTree();
      }
      return { success: false, error: 'getCourseOutlineActivityTree not available' };
    } catch (error) {
      try { this.logger.error('SNBridge: getCourseOutlineActivityTree failed', error?.message || error); } catch (_) {}
      return { success: false, error: error?.message || String(error) };
    }
  }

  /**
   * Get available navigation options (renderer-safe wrapper)
   */
  async getCourseOutlineAvailableNavigation() {
    try {
      if (window.electronAPI?.getCourseOutlineAvailableNavigation) {
        return await window.electronAPI.getCourseOutlineAvailableNavigation();
      }
      return { success: false, error: 'getCourseOutlineAvailableNavigation not available' };
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
      if (window.electronAPI?.validateCourseOutlineChoice) {
        return await window.electronAPI.validateCourseOutlineChoice(activityId);
      }
      return { success: false, allowed: false, reason: 'validateCourseOutlineChoice not available' };
    } catch (error) {
      try { this.logger.error('SNBridge: validateCourseOutlineChoice failed', error?.message || error); } catch (_) {}
      return { success: false, allowed: false, reason: error?.message || String(error) };
    }
  }

  /** Inspector data getters (renderer-safe wrappers) */
  async getScormInspectorHistory() {
    try {
      if (window.electronAPI?.getScormInspectorHistory) {
        return await window.electronAPI.getScormInspectorHistory();
      }
      return { success: false, error: 'getScormInspectorHistory not available' };
    } catch (error) {
      try { this.logger.error('SNBridge: getScormInspectorHistory failed', error?.message || error); } catch (_) {}
      return { success: false, error: error?.message || String(error) };
    }
  }

  async getScormDataModel() {
    try {
      if (window.electronAPI?.getScormDataModel) {
        return await window.electronAPI.getScormDataModel();
      }
      return { success: false, error: 'getScormDataModel not available' };
    } catch (error) {
      try { this.logger.error('SNBridge: getScormDataModel failed', error?.message || error); } catch (_) {}
      return { success: false, error: error?.message || String(error) };
    }
  }

  async getSnState() {
    try {
      if (window.electronAPI?.getSnState) {
        return await window.electronAPI.getSnState();
      }
      return { success: false, error: 'getSnState not available' };
    } catch (error) {
      try { this.logger.error('SNBridge: getSnState failed', error?.message || error); } catch (_) {}
      return { success: false, error: error?.message || String(error) };
    }
  }

  async getActivityTree() {
    try {
      if (window.electronAPI?.getActivityTree) {
        return await window.electronAPI.getActivityTree();
      }
      return { success: false, error: 'getActivityTree not available' };
    } catch (error) {
      try { this.logger.error('SNBridge: getActivityTree failed', error?.message || error); } catch (_) {}
      return { success: false, error: error?.message || String(error) };
    }
  }

  async getNavigationRequests() {
    try {
      if (window.electronAPI?.getNavigationRequests) {
        return await window.electronAPI.getNavigationRequests();
      }
      return { success: false, error: 'getNavigationRequests not available' };
    } catch (error) {
      try { this.logger.error('SNBridge: getNavigationRequests failed', error?.message || error); } catch (_) {}
      return { success: false, error: error?.message || String(error) };
    }
  }

  async getGlobalObjectives() {
    try {
      if (window.electronAPI?.getGlobalObjectives) {
        return await window.electronAPI.getGlobalObjectives();
      }
      return { success: false, error: 'getGlobalObjectives not available' };
    } catch (error) {
      try { this.logger.error('SNBridge: getGlobalObjectives failed', error?.message || error); } catch (_) {}
      return { success: false, error: error?.message || String(error) };
    }
  }

  async getSSPBuckets() {
    try {
      if (window.electronAPI?.getSSPBuckets) {
        return await window.electronAPI.getSSPBuckets();
      }
      return { success: false, error: 'getSSPBuckets not available' };
    } catch (error) {
      try { this.logger.error('SNBridge: getSSPBuckets failed', error?.message || error); } catch (_) {}
      return { success: false, error: error?.message || String(error) };
    }
  }

  /** Subscribe to main-pushed inspector updates */
  onScormInspectorDataUpdated(handler) {
    try {
      if (window.electronAPI?.onScormInspectorDataUpdated && typeof handler === 'function') {
        return window.electronAPI.onScormInspectorDataUpdated(handler);
      }
    } catch (_) {}
    return () => {};
  }

}

// Create and export singleton instance
const snBridge = new SNBridge();

export { SNBridge, snBridge };