// @ts-check

/**
 * Error Dialog Component
 * 
 * Modal dialog for catastrophic errors that block core functionality.
 * Displays error details, stack trace, and provides log export functionality.
 * 
 * @fileoverview Error dialog component for catastrophic errors
 */

import { BaseComponent } from '../base-component.js';
import { escapeHTML } from '../../utils/escape.js';

export class ErrorDialog extends BaseComponent {
  constructor(elementId = 'error-dialog') {
    super(elementId, {
      className: 'error-dialog',
      attributes: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'error-dialog-title'
      }
    });

    this.currentError = null;
    this._dialogVisible = false;
  }

  /**
   * Initialize component
   */
  async initialize() {
    await super.initialize();

    // Subscribe to catastrophic errors from UIState
    const unsubscribe = this.uiState.subscribe((errors) => {
      if (errors && errors.length > 0) {
        // Show the most recent unacknowledged error
        const unacknowledged = errors.filter(e => !e.acknowledged);
        if (unacknowledged.length > 0) {
          this.showError(unacknowledged[unacknowledged.length - 1]);
        }
      }
    }, 'ui.catastrophicErrors');

    this.unsubscribeFunctions.push(unsubscribe);

    // Listen for catastrophic error events via EventBus
    if (this.eventBus) {
      const unsubscribeEventBus = this.eventBus.on('error:catastrophic', (data) => {
        if (data && data.data) {
          this.showError(data.data);
        }
      });
      this.unsubscribeFunctions.push(unsubscribeEventBus);
    }
  }

  /**
   * Render component content
   */
  renderContent() {
    if (!this.element) return;

    if (!this._dialogVisible || !this.currentError) {
      this.element.style.display = 'none';
      return;
    }

    this.element.style.display = 'flex';

    const safeMessage = escapeHTML(this.currentError.message || 'An error occurred');
    const safeStack = this.currentError.stack ? escapeHTML(this.currentError.stack) : '';
    const contextStr = this.currentError.context ? JSON.stringify(this.currentError.context, null, 2) : '';
    const safeContext = contextStr ? escapeHTML(contextStr) : '';

    this.element.innerHTML = `
      <div class="error-dialog__overlay"></div>
      <div class="error-dialog__content">
        <div class="error-dialog__header">
          <h2 id="error-dialog-title" class="error-dialog__title">
            <span class="error-dialog__icon">❌</span>
            Critical Error
          </h2>
        </div>
        
        <div class="error-dialog__body">
          <div class="error-dialog__message">
            ${safeMessage}
          </div>
          
          ${safeStack || safeContext ? `
            <details class="error-dialog__details">
              <summary>Technical Details</summary>
              <div class="error-dialog__details-content">
                ${safeStack ? `
                  <div class="error-dialog__section">
                    <h4>Stack Trace:</h4>
                    <pre class="error-dialog__code">${safeStack}</pre>
                  </div>
                ` : ''}
                ${safeContext ? `
                  <div class="error-dialog__section">
                    <h4>Context:</h4>
                    <pre class="error-dialog__code">${safeContext}</pre>
                  </div>
                ` : ''}
              </div>
            </details>
          ` : ''}
        </div>
        
        <div class="error-dialog__footer">
          <button class="error-dialog__button error-dialog__button--secondary" id="error-dialog-copy-logs">
            Copy Logs
          </button>
          <button class="error-dialog__button error-dialog__button--primary" id="error-dialog-close">
            Close
          </button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  /**
   * Bind event handlers
   */
  bindEvents() {
    const closeBtn = this.element.querySelector('#error-dialog-close');
    const copyLogsBtn = this.element.querySelector('#error-dialog-copy-logs');
    const overlay = this.element.querySelector('.error-dialog__overlay');

    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }

    if (copyLogsBtn) {
      copyLogsBtn.addEventListener('click', () => this.copyLogs());
    }

    if (overlay) {
      overlay.addEventListener('click', () => this.close());
    }

    // ESC key to close
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && this.isVisible) {
        this.close();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    
    // Store handler for cleanup
    this._keyDownHandler = handleKeyDown;
  }

  /**
   * Show error dialog
   * @param {Object} error - Error object
   */
  showError(error) {
    this.currentError = error;
    this._dialogVisible = true;
    this.render();
    
    // Focus the dialog for accessibility
    setTimeout(() => {
      const closeBtn = this.element.querySelector('#error-dialog-close');
      if (closeBtn) {
        closeBtn.focus();
      }
    }, 100);

    this.logger?.error('ErrorDialog: Displaying catastrophic error', {
      message: error.message,
      context: error.context
    });
  }

  /**
   * Close error dialog
   */
  close() {
    this._dialogVisible = false;
    this.render();
    
    // Mark error as acknowledged in UIState
    if (this.currentError && this.uiState) {
      // Remove from catastrophic errors list
      const catastrophicErrors = (this.uiState.state.ui?.catastrophicErrors || [])
        .map(e => e.id === this.currentError.id ? { ...e, acknowledged: true } : e);
      this.uiState.updateUI({ catastrophicErrors });
    }
    
    this.currentError = null;
  }

  /**
   * Copy logs to clipboard
   */
  async copyLogs() {
    try {
      // Request logs from main process via IPC
      const ipcClient = await import('../../services/ipc-client.js').then(m => m.ipcClient);
      const logs = await ipcClient.invoke('get-error-logs', {
        errorId: this.currentError?.id,
        includeContext: true
      });

      // Format logs for clipboard
      const logText = this.formatLogsForClipboard(logs);

      // Copy to clipboard
      await navigator.clipboard.writeText(logText);

      // Show success feedback
      this.showCopySuccess();
      
      this.logger?.info('ErrorDialog: Logs copied to clipboard');
    } catch (error) {
      this.logger?.error('ErrorDialog: Failed to copy logs', error?.message || error);
      this.showCopyError();
    }
  }

  /**
   * Format logs for clipboard
   * @param {Object} logs - Logs data from main process
   * @returns {string} Formatted log text
   */
  formatLogsForClipboard(logs) {
    const lines = [];
    
    lines.push('=== SCORM Tester Error Report ===');
    lines.push(`Timestamp: ${new Date().toISOString()}`);
    lines.push('');
    
    if (this.currentError) {
      lines.push('=== Error Details ===');
      lines.push(`Message: ${this.currentError.message}`);
      if (this.currentError.stack) {
        lines.push('Stack Trace:');
        lines.push(this.currentError.stack);
      }
      if (this.currentError.context) {
        lines.push('Context:');
        lines.push(JSON.stringify(this.currentError.context, null, 2));
      }
      lines.push('');
    }
    
    if (logs && logs.entries) {
      lines.push('=== Recent Log Entries ===');
      logs.entries.forEach(entry => {
        // NDJSON format uses 'ts' (millisecond timestamp), 'level', and 'msg' properties
        const timestamp = entry.ts ? new Date(entry.ts).toISOString() : (entry.timestamp || 'unknown');
        const level = entry.level || 'unknown';
        const message = entry.msg || entry.message || 'no message';
        lines.push(`[${timestamp}] ${level}: ${message}`);
      });
    }
    
    return lines.join('\n');
  }

  /**
   * Show copy success feedback
   */
  showCopySuccess() {
    const btn = this.element.querySelector('#error-dialog-copy-logs');
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

  /**
   * Show copy error feedback
   */
  showCopyError() {
    const btn = this.element.querySelector('#error-dialog-copy-logs');
    if (btn) {
      const originalText = btn.textContent;
      btn.textContent = '✗ Failed';
      
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    }
  }

  /**
   * Cleanup component
   */
  destroy() {
    if (this._keyDownHandler) {
      document.removeEventListener('keydown', this._keyDownHandler);
    }
    super.destroy();
  }
}

