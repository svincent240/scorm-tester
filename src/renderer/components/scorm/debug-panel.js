/**
 * Debug Panel Component
 * 
 * Provides real-time SCORM API monitoring, data model inspection,
 * and debugging tools for SCORM content development and testing.
 * 
 * @fileoverview SCORM debug panel component
 */

import { BaseComponent } from '../base-component.js';
import { uiState as uiStatePromise } from '../../services/ui-state.js';
import { scormClient } from '../../services/scorm-client.js';

/**
 * Debug Panel Class
 */
class DebugPanel extends BaseComponent {
  constructor(elementId, options = {}) {
    super(elementId, options);
    
    this.activeTab = 'api-calls';
    this.apiCalls = [];
    this.maxApiCalls = 1000;
    this.uiState = null; // Will be set in doInitialize
  }

  async doInitialize() {
    // Resolve the uiState promise
    this.uiState = await uiStatePromise;
    
    // Call parent's doInitialize
    await super.doInitialize();
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
    // Use existing HTML structure and just get references to elements
    // This eliminates conflicts between HTML and component-generated content
    
    this.clearBtn = this.element.querySelector('#debug-clear');
    this.exportBtn = this.element.querySelector('#debug-export');
    this.closeBtn = this.element.querySelector('#debug-close');
    this.apiLog = this.element.querySelector('#api-calls-log');
    this.dataModelView = this.element.querySelector('#data-model-view');
    this.sessionInfo = this.element.querySelector('#session-info');
    this.errorLog = this.element.querySelector('#errors-log');
    
    // Verify we have the elements we need
    if (!this.clearBtn || !this.exportBtn || !this.closeBtn) {
      console.warn('DebugPanel: Some control buttons not found in HTML structure');
    }
    
    if (!this.apiLog || !this.dataModelView || !this.sessionInfo || !this.errorLog) {
      console.warn('DebugPanel: Some content areas not found in HTML structure');
    }
    
    // Initialize the panel with empty state
    this.refreshActiveTab();
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
    console.log('Debug Panel: Adding API call to log:', apiCall);
    
    this.apiCalls.push({
      ...apiCall,
      timestamp: apiCall.timestamp || Date.now(),
      id: Date.now() + Math.random()
    });
    
    if (this.apiCalls.length > this.maxApiCalls) {
      this.apiCalls.shift();
    }
    
    console.log('Debug Panel: Total API calls logged:', this.apiCalls.length);
    
    if (this.activeTab === 'api-calls') {
      this.refreshApiCallsView();
    }
  }

  refreshApiCallsView() {
    // Safety check: ensure element references are available
    if (!this.apiLog) {
      console.log('DEBUG PANEL: apiLog element not yet available, skipping refresh');
      return;
    }
    
    if (this.apiCalls.length === 0) {
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
    // Safety check: ensure element references are available
    if (!this.dataModelView) {
      console.log('DEBUG PANEL: dataModelView element not yet available, skipping refresh');
      return;
    }
    
    if (!scormClient.getInitialized()) {
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
    // Safety check: ensure element references are available
    if (!this.sessionInfo) {
      console.log('DEBUG PANEL: sessionInfo element not yet available, skipping refresh');
      return;
    }
    
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
    // Safety check: ensure element references are available
    if (!this.errorLog) {
      console.log('DEBUG PANEL: errorLog element not yet available, skipping refresh');
      return;
    }
    
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
    if (!this.uiState) {
      console.warn('DebugPanel: uiState not yet initialized, skipping API call history load');
      return;
    }
    const history = this.uiState.getState('apiCallHistory') || [];
    this.apiCalls = history;
    this.refreshActiveTab();
  }

  handleApiCall(data) {
    console.log('Debug Panel: Received API call event:', data);
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

export { DebugPanel };