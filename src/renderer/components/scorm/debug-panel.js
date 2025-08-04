/**
 * Debug Panel Component
 * 
 * Provides real-time SCORM API monitoring, data model inspection,
 * and debugging tools for SCORM content development and testing.
 * 
 * @fileoverview SCORM debug panel component
 */

const BaseComponent = require('../base-component');
const uiState = require('../../services/ui-state');
const scormClient = require('../../services/scorm-client');

/**
 * Debug Panel Class
 */
class DebugPanel extends BaseComponent {
  constructor(elementId, options = {}) {
    super(elementId, options);
    
    this.activeTab = 'api-calls';
    this.apiCalls = [];
    this.maxApiCalls = 1000;
  }

  getDefaultOptions() {
    return {
      ...super.getDefaultOptions(),
      className: 'debug-panel',
      showTimestamps: true,
      enableExport: true,
      attributes: { 'data-component': 'debug-panel' }
    };
  }

  async setup() {
    this.loadApiCallHistory();
  }

  renderContent() {
    this.element.innerHTML = `
      <div class="debug-panel__container">
        <div class="debug-panel__header">
          <h3>SCORM Debug Panel</h3>
          <div class="debug-panel__controls">
            <button class="debug-btn" id="${this.elementId}-clear" title="Clear Log">🗑️</button>
            <button class="debug-btn" id="${this.elementId}-export" title="Export Log">📄</button>
            <button class="debug-btn" id="${this.elementId}-close" title="Close Panel">✕</button>
          </div>
        </div>
        
        <div class="debug-panel__tabs">
          <button class="debug-tab debug-tab--active" data-tab="api-calls">API Calls</button>
          <button class="debug-tab" data-tab="data-model">Data Model</button>
          <button class="debug-tab" data-tab="session">Session</button>
          <button class="debug-tab" data-tab="errors">Errors</button>
        </div>
        
        <div class="debug-panel__content">
          <div class="debug-content debug-content--active" id="debug-api-calls">
            <div class="debug-log" id="${this.elementId}-api-log">
              <div class="debug-log__empty">No API calls recorded</div>
            </div>
          </div>
          
          <div class="debug-content" id="debug-data-model">
            <div class="debug-data" id="${this.elementId}-data-model">
              <div class="debug-data__empty">No data model loaded</div>
            </div>
          </div>
          
          <div class="debug-content" id="debug-session">
            <div class="debug-info" id="${this.elementId}-session-info">
              <div class="debug-info__item">
                <span class="debug-info__label">Status:</span>
                <span class="debug-info__value">Not Connected</span>
              </div>
            </div>
          </div>
          
          <div class="debug-content" id="debug-errors">
            <div class="debug-log" id="${this.elementId}-error-log">
              <div class="debug-log__empty">No errors recorded</div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Get element references
    this.clearBtn = this.find(`#${this.elementId}-clear`);
    this.exportBtn = this.find(`#${this.elementId}-export`);
    this.closeBtn = this.find(`#${this.elementId}-close`);
    this.apiLog = this.find(`#${this.elementId}-api-log`);
    this.dataModelView = this.find(`#${this.elementId}-data-model`);
    this.sessionInfo = this.find(`#${this.elementId}-session-info`);
    this.errorLog = this.find(`#${this.elementId}-error-log`);
  }

  setupEventSubscriptions() {
    this.subscribe('api:call', this.handleApiCall);
    this.subscribe('scorm:error', this.handleScormError);
    this.subscribe('scorm:initialized', this.handleScormInitialized);
    this.subscribe('scorm:dataChanged', this.handleDataChanged);
  }

  bindEvents() {
    super.bindEvents();
    
    if (this.clearBtn) this.clearBtn.addEventListener('click', this.clearLog);
    if (this.exportBtn) this.exportBtn.addEventListener('click', this.exportLog);
    if (this.closeBtn) this.closeBtn.addEventListener('click', this.closePanel);
    
    // Tab switching
    this.findAll('.debug-tab').forEach(tab => {
      tab.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
    });
  }

  switchTab(tabName) {
    this.activeTab = tabName;
    
    // Update tab buttons
    this.findAll('.debug-tab').forEach(tab => {
      tab.classList.toggle('debug-tab--active', tab.dataset.tab === tabName);
    });
    
    // Update content panels
    this.findAll('.debug-content').forEach(content => {
      content.classList.toggle('debug-content--active', content.id === `debug-${tabName}`);
    });
    
    this.refreshActiveTab();
  }

  addApiCall(apiCall) {
    this.apiCalls.push({
      ...apiCall,
      timestamp: Date.now(),
      id: Date.now() + Math.random()
    });
    
    if (this.apiCalls.length > this.maxApiCalls) {
      this.apiCalls.shift();
    }
    
    if (this.activeTab === 'api-calls') {
      this.refreshApiCallsView();
    }
  }

  refreshApiCallsView() {
    if (!this.apiLog || this.apiCalls.length === 0) {
      this.apiLog.innerHTML = '<div class="debug-log__empty">No API calls recorded</div>';
      return;
    }
    
    const html = this.apiCalls.slice(-50).map(call => this.formatApiCall(call)).join('');
    this.apiLog.innerHTML = html;
    this.apiLog.scrollTop = this.apiLog.scrollHeight;
  }

  formatApiCall(call) {
    const timestamp = this.options.showTimestamps ? 
      new Date(call.timestamp).toLocaleTimeString() : '';
    const isError = call.errorCode && call.errorCode !== '0';
    const statusClass = isError ? 'debug-call--error' : 'debug-call--success';
    
    return `
      <div class="debug-call ${statusClass}">
        <div class="debug-call__header">
          <span class="debug-call__method">${call.method}</span>
          ${timestamp ? `<span class="debug-call__time">${timestamp}</span>` : ''}
        </div>
        <div class="debug-call__details">
          <div class="debug-call__param">${call.parameter || ''}</div>
          <div class="debug-call__result">→ ${call.result}</div>
          ${isError ? `<div class="debug-call__error">Error: ${call.errorCode}</div>` : ''}
        </div>
      </div>
    `;
  }

  refreshDataModelView() {
    if (!this.dataModelView || !scormClient.getInitialized()) {
      this.dataModelView.innerHTML = '<div class="debug-data__empty">SCORM not initialized</div>';
      return;
    }
    
    const elements = [
      'cmi.completion_status', 'cmi.success_status', 'cmi.score.raw',
      'cmi.progress_measure', 'cmi.location', 'cmi.session_time'
    ];
    
    const html = elements.map(element => {
      const value = scormClient.getCachedValue(element) || '--';
      return `
        <div class="debug-data__item">
          <span class="debug-data__element">${element}</span>
          <span class="debug-data__value">${value}</span>
        </div>
      `;
    }).join('');
    
    this.dataModelView.innerHTML = html;
  }

  refreshSessionInfo() {
    if (!this.sessionInfo) return;
    
    const sessionId = scormClient.getSessionId() || '--';
    const status = scormClient.getInitialized() ? 'Connected' : 'Not Connected';
    
    this.sessionInfo.innerHTML = `
      <div class="debug-info__item">
        <span class="debug-info__label">Status:</span>
        <span class="debug-info__value">${status}</span>
      </div>
      <div class="debug-info__item">
        <span class="debug-info__label">Session ID:</span>
        <span class="debug-info__value">${sessionId}</span>
      </div>
    `;
  }

  refreshActiveTab() {
    switch (this.activeTab) {
      case 'api-calls':
        this.refreshApiCallsView();
        break;
      case 'data-model':
        this.refreshDataModelView();
        break;
      case 'session':
        this.refreshSessionInfo();
        break;
      case 'errors':
        this.refreshErrorsView();
        break;
    }
  }

  refreshErrorsView() {
    const errorCalls = this.apiCalls.filter(call => call.errorCode && call.errorCode !== '0');
    
    if (errorCalls.length === 0) {
      this.errorLog.innerHTML = '<div class="debug-log__empty">No errors recorded</div>';
      return;
    }
    
    const html = errorCalls.map(call => this.formatApiCall(call)).join('');
    this.errorLog.innerHTML = html;
  }

  clearLog() {
    this.apiCalls = [];
    this.refreshActiveTab();
    this.emit('logCleared');
  }

  exportLog() {
    const data = {
      timestamp: new Date().toISOString(),
      sessionId: scormClient.getSessionId(),
      apiCalls: this.apiCalls
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scorm-debug-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  closePanel() {
    this.hide();
    this.emit('panelClosed');
  }

  loadApiCallHistory() {
    const history = uiState.getState('apiCallHistory') || [];
    this.apiCalls = history;
    this.refreshActiveTab();
  }

  handleApiCall(data) {
    this.addApiCall(data.data || data);
  }

  handleScormError(data) {
    this.addApiCall({
      method: 'Error',
      parameter: data.errorCode,
      result: data.message,
      errorCode: data.errorCode
    });
  }

  handleScormInitialized() {
    this.refreshSessionInfo();
  }

  handleDataChanged() {
    if (this.activeTab === 'data-model') {
      this.refreshDataModelView();
    }
  }

  destroy() {
    this.clearLog();
    super.destroy();
  }
}

module.exports = DebugPanel;