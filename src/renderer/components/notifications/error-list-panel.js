// @ts-check

/**
 * Error List Panel Component
 * 
 * Panel showing list of non-catastrophic errors with details and actions.
 * Provides error details, copy logs functionality, and dismiss actions.
 * 
 * @fileoverview Error list panel component
 */

import { BaseComponent } from '../base-component.js';
import { escapeHTML } from '../../utils/escape.js';

export class ErrorListPanel extends BaseComponent {
  constructor(elementId = 'error-list-panel') {
    super(elementId, {
      className: 'error-list-panel',
      attributes: {
        role: 'region',
        'aria-label': 'Error list'
      }
    });

    this.errors = [];
    this._panelVisible = false;
  }

  /**
   * Initialize component
   */
  async initialize() {
    await super.initialize();

    // Subscribe to non-catastrophic errors from UIState
    const unsubscribe = this.uiState.subscribe((errors) => {
      this.errors = errors || [];
      if (this._panelVisible) {
        this.render();
      }
    }, 'ui.nonCatastrophicErrors');

    this.unsubscribeFunctions.push(unsubscribe);

    // Listen for open event from error badge via EventBus
    if (this.eventBus) {
      const unsubscribeEventBus = this.eventBus.on('error-list:open', () => {
        this.open();
      });
      this.unsubscribeFunctions.push(unsubscribeEventBus);
    }
  }

  /**
   * Render component content
   */
  renderContent() {
    if (!this.element) return;

    if (!this._panelVisible) {
      this.element.style.display = 'none';
      return;
    }

    this.element.style.display = 'block';

    const unacknowledgedErrors = this.errors.filter(e => !e.acknowledged);
    const acknowledgedErrors = this.errors.filter(e => e.acknowledged);

    this.element.innerHTML = `
      <div class="error-list-panel__header">
        <h3 class="error-list-panel__title">
          <span class="error-list-panel__icon">⚠️</span>
          Error Log (${unacknowledgedErrors.length} unacknowledged, ${this.errors.length} total)
        </h3>
        <button class="error-list-panel__close" aria-label="Close error list">×</button>
      </div>

      <div class="error-list-panel__body">
        ${this.errors.length === 0 ? `
          <div class="error-list-panel__empty">
            <p>No errors logged</p>
            <p style="font-size: 0.875rem; color: var(--text-muted); margin-top: 0.5rem;">
              Application errors and warnings will appear here
            </p>
          </div>
        ` : ''}

        ${unacknowledgedErrors.length > 0 ? `
          <div class="error-list-panel__section">
            <h4 class="error-list-panel__section-title">Unacknowledged Errors</h4>
            <div class="error-list-panel__items">
              ${unacknowledgedErrors.map(error => this.renderErrorItem(error)).join('')}
            </div>
          </div>
        ` : ''}

        ${acknowledgedErrors.length > 0 ? `
          <div class="error-list-panel__section">
            <h4 class="error-list-panel__section-title">Acknowledged Errors</h4>
            <div class="error-list-panel__items">
              ${acknowledgedErrors.map(error => this.renderErrorItem(error)).join('')}
            </div>
          </div>
        ` : ''}
      </div>
      
      <div class="error-list-panel__footer">
        <button class="error-list-panel__button error-list-panel__button--secondary" id="error-list-copy-all">
          Copy All Logs
        </button>
        ${this.errors.length > 0 ? `
          <button class="error-list-panel__button error-list-panel__button--danger" id="error-list-clear-all">
            Clear All
          </button>
        ` : ''}
        ${unacknowledgedErrors.length > 0 ? `
          <button class="error-list-panel__button error-list-panel__button--primary" id="error-list-acknowledge-all">
            Acknowledge All
          </button>
        ` : ''}
      </div>
    `;

    this.bindEvents();
  }

  /**
   * Render a single error item
   * @param {Object} error - Error object
   * @returns {string} HTML string
   */
  renderErrorItem(error) {
    const safeMessage = escapeHTML(error.message || 'Unknown error');
    const safeComponent = escapeHTML(error.component || 'unknown');
    const timestamp = new Date(error.timestamp).toLocaleString();
    const safeStack = error.stack ? escapeHTML(error.stack) : '';
    const contextStr = error.context ? JSON.stringify(error.context, null, 2) : '';
    const safeContext = contextStr ? escapeHTML(contextStr) : '';

    return `
      <div class="error-list-panel__item ${error.acknowledged ? 'error-list-panel__item--acknowledged' : ''}" data-error-id="${error.id}">
        <div class="error-list-panel__item-header">
          <div class="error-list-panel__item-info">
            <div class="error-list-panel__item-message">${safeMessage}</div>
            <div class="error-list-panel__item-meta">
              <span class="error-list-panel__item-component">${safeComponent}</span>
              <span class="error-list-panel__item-timestamp">${timestamp}</span>
            </div>
          </div>
          <div class="error-list-panel__item-actions">
            ${!error.acknowledged ? `
              <button class="error-list-panel__item-button" data-action="acknowledge" data-error-id="${error.id}" title="Acknowledge">
                ✓
              </button>
            ` : ''}
            <button class="error-list-panel__item-button" data-action="copy" data-error-id="${error.id}" title="Copy details">
              📋
            </button>
          </div>
        </div>
        
        ${safeStack || safeContext ? `
          <details class="error-list-panel__item-details">
            <summary>Technical Details</summary>
            <div class="error-list-panel__item-details-content">
              ${safeStack ? `
                <div class="error-list-panel__item-section">
                  <strong>Stack Trace:</strong>
                  <pre class="error-list-panel__item-code">${safeStack}</pre>
                </div>
              ` : ''}
              ${safeContext ? `
                <div class="error-list-panel__item-section">
                  <strong>Context:</strong>
                  <pre class="error-list-panel__item-code">${safeContext}</pre>
                </div>
              ` : ''}
            </div>
          </details>
        ` : ''}
      </div>
    `;
  }

  /**
   * Bind event handlers
   */
  bindEvents() {
    // Close button
    const closeBtn = this.element.querySelector('.error-list-panel__close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }

    // Copy all logs button
    const copyAllBtn = this.element.querySelector('#error-list-copy-all');
    if (copyAllBtn) {
      copyAllBtn.addEventListener('click', () => this.copyAllLogs());
    }

    // Clear all button
    const clearAllBtn = this.element.querySelector('#error-list-clear-all');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => this.clearAll());
    }

    // Acknowledge all button
    const acknowledgeAllBtn = this.element.querySelector('#error-list-acknowledge-all');
    if (acknowledgeAllBtn) {
      acknowledgeAllBtn.addEventListener('click', () => this.acknowledgeAll());
    }

    // Individual error actions
    const actionButtons = this.element.querySelectorAll('.error-list-panel__item-button');
    actionButtons.forEach(btn => {
      const action = btn.getAttribute('data-action');
      const errorIdStr = btn.getAttribute('data-error-id');
      // Convert string to number since error IDs are stored as numbers
      const errorId = errorIdStr ? parseFloat(errorIdStr) : errorIdStr;

      btn.addEventListener('click', () => {
        if (action === 'acknowledge') {
          this.acknowledgeError(errorId);
        } else if (action === 'copy') {
          this.copyErrorDetails(errorId);
        }
      });
    });
  }

  /**
   * Open error list panel
   */
  open() {
    this._panelVisible = true;
    this.render();
    this.logger?.info('ErrorListPanel: Opened');
  }

  /**
   * Close error list panel
   */
  close() {
    this._panelVisible = false;
    this.render();
    this.logger?.info('ErrorListPanel: Closed');
  }

  /**
   * Acknowledge a single error
   * @param {string|number} errorId - Error ID
   */
  acknowledgeError(errorId) {
    if (this.uiState) {
      this.uiState.acknowledgeError(errorId);
      this.logger?.info('ErrorListPanel: Acknowledged error', { errorId });
    }
  }

  /**
   * Acknowledge all errors
   */
  acknowledgeAll() {
    if (this.uiState) {
      this.uiState.acknowledgeAllErrors();
      this.logger?.info('ErrorListPanel: Acknowledged all errors');
    }
  }

  /**
   * Clear all errors
   */
  clearAll() {
    if (this.uiState) {
      this.uiState.clearAllErrors();
      this.logger?.info('ErrorListPanel: Cleared all errors');
    }
  }

  /**
   * Copy details of a single error
   * @param {string|number} errorId - Error ID
   */
  async copyErrorDetails(errorId) {
    const error = this.errors.find(e => e.id === errorId);
    if (!error) return;

    const text = this.formatErrorForClipboard(error);
    
    try {
      await navigator.clipboard.writeText(text);
      this.showCopySuccess(errorId);
      this.logger?.info('ErrorListPanel: Copied error details', { errorId });
    } catch (err) {
      this.logger?.error('ErrorListPanel: Failed to copy error details', err?.message || err);
    }
  }

  /**
   * Copy all error logs
   */
  async copyAllLogs() {
    const text = this.errors.map(e => this.formatErrorForClipboard(e)).join('\n\n---\n\n');
    
    try {
      await navigator.clipboard.writeText(text);
      this.showCopyAllSuccess();
      this.logger?.info('ErrorListPanel: Copied all error logs');
    } catch (err) {
      this.logger?.error('ErrorListPanel: Failed to copy all logs', err?.message || err);
    }
  }

  /**
   * Format error for clipboard
   * @param {Object} error - Error object
   * @returns {string} Formatted text
   */
  formatErrorForClipboard(error) {
    const lines = [];
    lines.push(`Error: ${error.message}`);
    lines.push(`Component: ${error.component || 'unknown'}`);
    lines.push(`Timestamp: ${new Date(error.timestamp).toISOString()}`);
    
    if (error.stack) {
      lines.push('\nStack Trace:');
      lines.push(error.stack);
    }
    
    if (error.context) {
      lines.push('\nContext:');
      lines.push(JSON.stringify(error.context, null, 2));
    }
    
    return lines.join('\n');
  }

  /**
   * Show copy success feedback for single error
   * @param {string|number} errorId - Error ID
   */
  showCopySuccess(errorId) {
    const btn = this.element.querySelector(`[data-action="copy"][data-error-id="${errorId}"]`);
    if (btn) {
      const originalText = btn.textContent;
      btn.textContent = '✓';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 1000);
    }
  }

  /**
   * Show copy all success feedback
   */
  showCopyAllSuccess() {
    const btn = this.element.querySelector('#error-list-copy-all');
    if (btn) {
      const originalText = btn.textContent;
      btn.textContent = '✓ Copied!';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2000);
    }
  }
}

