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
    this.uiState = await this.uiState; // Ensure uiState is resolved
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

    const footerStatus = this.element.querySelector('#footer-status');
    if (footerStatus) {
      footerStatus.textContent = this.formatStatus(progressData.completionStatus);
    }
    
    const footerScore = this.element.querySelector('#footer-score');
    if (footerScore) {
      footerScore.textContent = this.formatScore(progressData.scoreRaw);
    }
    
    const footerTime = this.element.querySelector('#footer-time');
    if (footerTime) {
      footerTime.textContent = progressData.sessionTime || '00:00:00';
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