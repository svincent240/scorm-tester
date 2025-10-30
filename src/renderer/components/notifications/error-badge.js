// @ts-check

/**
 * Error Badge Component
 * 
 * Badge showing count of unacknowledged non-catastrophic errors.
 * Displayed in the header, clickable to open the error list panel.
 * 
 * @fileoverview Error badge component for non-catastrophic errors
 */

import { BaseComponent } from '../base-component.js';

export class ErrorBadge extends BaseComponent {
  constructor(elementId = 'error-badge') {
    super(elementId, {
      className: 'error-badge',
      attributes: {
        role: 'button',
        'aria-label': 'View errors',
        tabindex: '0'
      }
    });

    this.errorCount = 0;
  }

  /**
   * Initialize component
   */
  async initialize() {
    await super.initialize();

    // Subscribe to error badge count from UIState
    // UIState already calculates the count of unacknowledged errors
    const unsubscribe = this.uiState.subscribe((count) => {
      this.errorCount = count || 0;
      this.render();
    }, 'ui.errorBadgeCount');

    this.unsubscribeFunctions.push(unsubscribe);
  }

  /**
   * Render component content
   */
  renderContent() {
    if (!this.element) return;

    // Hide badge if no errors
    if (this.errorCount === 0) {
      this.element.style.display = 'none';
      this.element.innerHTML = '';
      return;
    }

    this.element.style.display = 'flex';

    this.element.innerHTML = `
      <div class="error-badge__icon">⚠️</div>
      <div class="error-badge__count">${this.errorCount}</div>
      <div class="error-badge__label">Error${this.errorCount !== 1 ? 's' : ''}</div>
    `;

    this.bindEvents();
  }

  /**
   * Bind event handlers
   */
  bindEvents() {
    // Remove old listeners if they exist
    if (this._clickHandler) {
      this.element.removeEventListener('click', this._clickHandler);
    }
    if (this._keydownHandler) {
      this.element.removeEventListener('keydown', this._keydownHandler);
    }

    // Click to open error list panel
    this._clickHandler = () => {
      this.openErrorList();
    };
    this.element.addEventListener('click', this._clickHandler);

    // Keyboard accessibility
    this._keydownHandler = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.openErrorList();
      }
    };
    this.element.addEventListener('keydown', this._keydownHandler);
  }

  /**
   * Open error list panel
   */
  openErrorList() {
    this.emit('openErrorList', { count: this.errorCount });
    this.eventBus?.emit('error-list:open', { count: this.errorCount });
    
    this.logger?.info('ErrorBadge: Opening error list panel', { errorCount: this.errorCount });
  }

  /**
   * Get status for debugging
   */
  getStatus() {
    return {
      errorCount: this.errorCount,
      visible: this.errorCount > 0
    };
  }
}

