// @ts-check

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
    // Render footer progress markup directly without extra wrapper
    // The element itself (#footer-progress) will have the footer-progress-bar class
    this.element.innerHTML = `
      <div class="footer-progress__bar">
        <div id="footer-progress-fill" class="footer-progress__fill" style="width:0%"></div>
      </div>
      <div id="footer-progress-percentage" class="footer-progress__text">0%</div>
    `;
  }

  setupEventSubscriptions() {
    this.subscribe('progress:updated', this.handleProgressUpdated);

    // BUG-022 FIX: Subscribe to navigation state updates
    this.subscribe('navigation:state:updated', this.handleNavigationStateUpdate);
  }

  handleProgressUpdated(data) {
    const progressData = data.data || data;
    const percentage = Math.round((progressData.progressMeasure || 0) * 100);

    if (!this.element) {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.warn('FooterProgressBar: element not available for update');
      }).catch(() => { /* intentionally empty */ });
      return;
    }

    const footerProgressFill = this.element.querySelector('#footer-progress-fill');
    if (footerProgressFill) {
      footerProgressFill.style.width = `${percentage}%`;
    } else {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.warn('FooterProgressBar: #footer-progress-fill not found in DOM');
      }).catch(() => { /* intentionally empty */ });
    }

    const footerProgressPercentage = this.element.querySelector('#footer-progress-percentage');
    if (footerProgressPercentage) {
      footerProgressPercentage.textContent = `${percentage}%`;
    } else {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.warn('FooterProgressBar: #footer-progress-percentage not found in DOM');
      }).catch(() => { /* intentionally empty */ });
    }
  }

  /**
   * BUG-022 FIX: Handle navigation state updates from AppManager
   */
  handleNavigationStateUpdate(stateData) {
    try {
      const { state } = stateData || {};

      // Update progress bar visual state based on navigation state
      if (state === 'PROCESSING') {
        this.element.classList.add('footer-progress-bar--loading');
      } else {
        this.element.classList.remove('footer-progress-bar--loading');
      }

    } catch (error) {
      import('../../utils/renderer-logger.js').then(({ rendererLogger }) => {
        rendererLogger.error('FooterProgressBar: Error handling navigation state update', error);
      }).catch(() => { /* intentionally empty */ });
    }
  }
}

export { FooterProgressBar };

