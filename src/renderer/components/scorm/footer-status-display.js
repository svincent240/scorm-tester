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
    // The HTML structure for these elements already exists in index.html
    // This component will attach to and update those existing elements.
    // No need to render new content here.
  }

  setupEventSubscriptions() {
    this.subscribe('progress:updated', this.handleProgressUpdated);
  }

  handleProgressUpdated(data) {
    const progressData = data.data || data;

    if (!this.element) {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.warn('FooterStatusDisplay: element not available for update');
      }).catch(() => {});
      return;
    }

    const footerStatus = this.element.querySelector('#footer-status');
    if (footerStatus) {
      footerStatus.textContent = this.formatStatus(progressData.completionStatus);
    } else {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.warn('FooterStatusDisplay: #footer-status not found in DOM');
      }).catch(() => {});
    }
    
    const footerScore = this.element.querySelector('#footer-score');
    if (footerScore) {
      footerScore.textContent = this.formatScore(progressData.scoreRaw);
    } else {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.warn('FooterStatusDisplay: #footer-score not found in DOM');
      }).catch(() => {});
    }
    
    const footerTime = this.element.querySelector('#footer-time');
    if (footerTime) {
      footerTime.textContent = progressData.sessionTime || '00:00:00';
    } else {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.warn('FooterStatusDisplay: #footer-time not found in DOM');
      }).catch(() => {});
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