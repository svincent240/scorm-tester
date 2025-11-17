// @ts-check

import { BaseComponent } from '../base-component.js';

class FooterStatusDisplay extends BaseComponent {
  constructor(elementId, options = {}) {
    super(elementId, options);
    
    // Track suspend data limits based on LMS profile
    this.suspendDataLimit = 4096; // Conservative limit for legacy LMS compatibility
    this.suspendDataLength = 0;
  }

  getDefaultOptions() {
    return {
      ...super.getDefaultOptions(),
      className: 'footer-status-display',
      attributes: { 'data-component': 'footer-status-display' }
    };
  }

  async setup() {
    // Use uiState instance provided by BaseComponent.loadDependencies()
    // No re-awaiting or reassignment to avoid clobbering the instance.
    
    // Fetch and display initial progress state
    try {
      const progressData = this.uiState.getState('progressData');
      if (progressData) {
        this.handleProgressUpdated(progressData);
      }
    } catch (_) { /* intentionally empty */ }

    // Get actual window size on startup (not stored viewport preset)
    try {
      const { ipcClient } = await import('../../../renderer/services/ipc-client.js');
      const result = await ipcClient.invoke('window:get-content-bounds');
      if (result && result.success && result.bounds) {
        this.handleViewportSizeChanged({ width: result.bounds.width, height: result.bounds.height });
      }
    } catch (error) {
      this.logger?.warn('Failed to fetch initial window size', error);
    }
  }

  renderContent() {
    // Render footer status markup directly without extra wrapper
    // The element itself (#footer-status) will have the footer-status-display class
    this.element.innerHTML = `
      <span id="footer-status-text" class="footer-status__text">Not Started</span>
      <span id="footer-score" class="footer-status__score">--</span>
      <span id="footer-time" class="footer-status__time">00:00:00</span>
      <span id="footer-suspend-data" class="footer-status__suspend-data" title="Suspend data usage">
        <span class="footer-status__label">Suspend:</span>
        <span id="footer-suspend-count" class="footer-status__value">0</span>/<span id="footer-suspend-limit" class="footer-status__limit">64000</span>
      </span>
      <span id="footer-viewport" class="footer-status__viewport" title="Current viewport size">1366×768</span>
    `;
  }

  setupEventSubscriptions() {
    this.subscribe('progress:updated', this.handleProgressUpdated);
    // Also react to session updates for elapsed time display
    this.subscribe('session:updated', this.handleSessionUpdated);
    // Listen for viewport size changes
    this.subscribe('viewport:size-changed', this.handleViewportSizeChanged);
    // Listen for data model changes to track suspend data (use UI-scoped event from ScormClient)
    this.subscribe('ui:scorm:dataChanged', this.handleDataModelChanged);
    // Listen for session info to get LMS profile limits
    this.subscribe('session:info', this.handleSessionInfo);
  }

  handleViewportSizeChanged(data) {
    const size = data?.data || data;
    if (!this.element || !size) return;
    
    const footerViewport = this.element.querySelector('#footer-viewport');
    if (footerViewport && size.width && size.height) {
      footerViewport.textContent = `${size.width}×${size.height}`;
    }
  }

  handleProgressUpdated(data) {
    const progressData = data.data || data;

    if (!this.element) {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.warn('FooterStatusDisplay: element not available for update');
      }).catch(() => { /* intentionally empty */ });
      return;
    }

    const footerStatus = this.element.querySelector('#footer-status-text');
    if (footerStatus) {
      footerStatus.textContent = this.formatStatus(progressData.completionStatus);
    } else {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.warn('FooterStatusDisplay: #footer-status-text not found in DOM');
      }).catch(() => { /* intentionally empty */ });
    }

    const footerScore = this.element.querySelector('#footer-score');
    if (footerScore) {
      footerScore.textContent = this.formatScore(progressData.scoreRaw);
    } else {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.warn('FooterStatusDisplay: #footer-score not found in DOM');
      }).catch(() => { /* intentionally empty */ });
    }

    const footerTime = this.element.querySelector('#footer-time');
    if (footerTime) {
      footerTime.textContent = progressData.sessionTime || '00:00:00';
    } else {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.warn('FooterStatusDisplay: #footer-time not found in DOM');
      }).catch(() => { /* intentionally empty */ });
    }
  }

  handleSessionUpdated(data) {
    const session = data?.data || data;
    if (!this.element) return;
    const footerTime = this.element.querySelector('#footer-time');
    if (footerTime && session && (session.sessionTime || session.elapsedTime)) {
      footerTime.textContent = session.sessionTime || session.elapsedTime;
    }
  }

  formatStatus(status) {
    const statusMap = {
      'completed': 'Completed',
      'incomplete': 'In Progress',
      'not attempted': 'Not Started',
      'unknown': 'Unknown'
    };
    return statusMap[status] || status;
  }

  formatScore(score) {
    return (score !== null && score !== undefined) ? `${score}` : '--';
  }

  handleDataModelChanged(data) {
    const changeData = data?.data || data;
    if (!this.element || !changeData) return;

    // Track suspend_data length
    if (changeData.element === 'cmi.suspend_data') {
      const newValue = changeData.value || '';
      this.suspendDataLength = newValue.length;
      this.updateSuspendDataDisplay();
    }
  }

  handleSessionInfo(data) {
    const sessionInfo = data?.data || data;
    if (!sessionInfo) return;

    // Update suspend data limit based on LMS profile
    if (sessionInfo.lmsProfile) {
      const profileLimits = {
        'litmos': 4096,
        'generic': 4096,
        'moodle': 65536,
        'scormcloud': 65536
      };
      this.suspendDataLimit = profileLimits[sessionInfo.lmsProfile] || 64000;
      this.updateSuspendDataDisplay();
    }
  }

  updateSuspendDataDisplay() {
    if (!this.element) return;

    const countEl = this.element.querySelector('#footer-suspend-count');
    const limitEl = this.element.querySelector('#footer-suspend-limit');
    const containerEl = this.element.querySelector('#footer-suspend-data');

    if (countEl) {
      countEl.textContent = this.suspendDataLength.toString();
    }

    if (limitEl) {
      limitEl.textContent = this.suspendDataLimit.toString();
    }

    if (containerEl) {
      // Visual warnings based on usage percentage
      const usagePercent = (this.suspendDataLength / this.suspendDataLimit) * 100;
      
      containerEl.classList.remove('footer-status__suspend-data--warning', 'footer-status__suspend-data--danger');
      
      if (usagePercent >= 95) {
        containerEl.classList.add('footer-status__suspend-data--danger');
        containerEl.title = `Suspend data critical: ${this.suspendDataLength}/${this.suspendDataLimit} chars (${usagePercent.toFixed(1)}%)`;
      } else if (usagePercent >= 80) {
        containerEl.classList.add('footer-status__suspend-data--warning');
        containerEl.title = `Suspend data high: ${this.suspendDataLength}/${this.suspendDataLimit} chars (${usagePercent.toFixed(1)}%)`;
      } else {
        containerEl.title = `Suspend data usage: ${this.suspendDataLength}/${this.suspendDataLimit} chars (${usagePercent.toFixed(1)}%)`;
      }
    }
  }
}

export { FooterStatusDisplay };

