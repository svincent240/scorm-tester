// @ts-check

import { BaseComponent } from '../base-component.js';

class FooterStatusDisplay extends BaseComponent {
  constructor(elementId, options = {}) {
    super(elementId, options);
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
  }

  renderContent() {
    // Render footer status markup directly without extra wrapper
    // The element itself (#footer-status) will have the footer-status-display class
    this.element.innerHTML = `
      <span id="footer-status-text" class="footer-status__text">Not Started</span>
      <span id="footer-score" class="footer-status__score">--</span>
      <span id="footer-time" class="footer-status__time">00:00:00</span>
    `;
  }

  setupEventSubscriptions() {
    this.subscribe('progress:updated', this.handleProgressUpdated);
    // Also react to session updates for elapsed time display
    this.subscribe('session:updated', this.handleSessionUpdated);
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
}

export { FooterStatusDisplay };

