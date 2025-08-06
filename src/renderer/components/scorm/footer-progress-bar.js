import { BaseComponent } from '../base-component.js';

class FooterProgressBar extends BaseComponent {
  constructor(elementId, options = {}) {
    super(elementId, options);
  }

  getDefaultOptions() {
    return {
      ...super.getDefaultOptions(),
      className: 'footer-progress-bar',
      attributes: { 'data-component': 'footer-progress-bar' }
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
    const percentage = Math.round((progressData.progressMeasure || 0) * 100);

    if (!this.element) {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.warn('FooterProgressBar: element not available for update');
      }).catch(() => {});
      return;
    }

    const footerProgressFill = this.element.querySelector('#footer-progress-fill');
    if (footerProgressFill) {
      footerProgressFill.style.width = `${percentage}%`;
    } else {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.warn('FooterProgressBar: #footer-progress-fill not found in DOM');
      }).catch(() => {});
    }
    
    const footerProgressPercentage = this.element.querySelector('#footer-progress-percentage');
    if (footerProgressPercentage) {
      footerProgressPercentage.textContent = `${percentage}%`;
    } else {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.warn('FooterProgressBar: #footer-progress-percentage not found in DOM');
      }).catch(() => {});
    }
  }
}

export { FooterProgressBar };