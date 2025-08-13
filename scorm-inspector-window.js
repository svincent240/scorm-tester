"use strict";

// SCORM Inspector Window JavaScript
// Handles the display and management of SCORM package inspection data

class ScormInspectorWindow {
    constructor() {
        console.log('SCORM Inspector: Initializing window...');
        
        this.apiHistory = [];
        this.scormErrors = [];
        this.isLoading = false;
        
        this.apiTimelineElement = document.getElementById('api-timeline');
        this.errorListElement = document.getElementById('error-list');
        this.clearHistoryBtn = document.getElementById('clear-history-btn');
        this.refreshBtn = document.getElementById('refresh-btn');
        
        console.log('SCORM Inspector: Elements found:', {
            apiTimelineElement: !!this.apiTimelineElement,
            errorListElement: !!this.errorListElement,
            clearHistoryBtn: !!this.clearHistoryBtn,
            refreshBtn: !!this.refreshBtn,
            electronAPI: !!window.electronAPI
        });
        
        this.setupEventListeners();
        this.loadInitialHistory();
    }

    setupEventListeners() {
        // Button event listeners
        this.clearHistoryBtn?.addEventListener('click', () => this.clearHistory());
        this.refreshBtn?.addEventListener('click', () => this.refreshData());

        // Set up IPC event listeners after electronAPI is available
        this.setupIpcEventListeners();
    }

    async setupIpcEventListeners() {
        try {
            // Wait for electronAPI to be available
            await this.waitForElectronAPI();

            // Listen for real-time updates from main process
            if (window.electronAPI.onScormInspectorDataUpdated) {
                window.electronAPI.onScormInspectorDataUpdated((event, data) => {
                    console.log('SCORM Inspector: Received API call update', data);
                    this.addApiCall(data);
                });
                console.log('SCORM Inspector: Data update listener registered');
            }

            // Listen for SCORM Inspector error updates
            if (window.electronAPI.onScormInspectorErrorUpdated) {
                window.electronAPI.onScormInspectorErrorUpdated((event, errorData) => {
                    console.log('SCORM Inspector: Received error update', errorData);
                    this.addError(errorData);
                });
                console.log('SCORM Inspector: Error update listener registered');
            }
        } catch (error) {
            console.error('SCORM Inspector: Failed to setup IPC event listeners:', error);
        }
    }

    async loadInitialHistory() {
        try {
            this.setLoading(true);
            
            // Wait for electronAPI to be available
            await this.waitForElectronAPI();
            
            if (!window.electronAPI?.getScormInspectorHistory) {
                console.error('SCORM Inspector: getScormInspectorHistory method not available');
                return;
            }

            // Request history from SCORM Inspector telemetry store
            const response = await window.electronAPI.getScormInspectorHistory();

            if (response.success && response.data) {
                const { history = [], errors = [] } = response.data;
                
                // Load API call history
                this.apiHistory = history;
                this.renderApiTimeline();

                // Load error history
                this.scormErrors = errors;
                this.renderErrorList();

                console.log(`SCORM Inspector: Loaded ${history.length} API calls and ${errors.length} errors`);
            } else {
                console.warn('SCORM Inspector: Failed to load history', response.error);
            }
        } catch (error) {
            console.error('SCORM Inspector: Error loading initial history', error);
        } finally {
            this.setLoading(false);
        }
    }

    async waitForElectronAPI(timeout = 5000) {
        const startTime = Date.now();
        
        while (!window.electronAPI) {
            if (Date.now() - startTime > timeout) {
                throw new Error('Timeout waiting for electronAPI to be available');
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        console.log('SCORM Inspector: electronAPI is now available');
    }

    addApiCall(data) {
        if (!data) return;

        // Add to history (maintain maximum size)
        this.apiHistory.unshift(data);
        if (this.apiHistory.length > 2000) {
            this.apiHistory = this.apiHistory.slice(0, 2000);
        }

        // Re-render timeline
        this.renderApiTimeline();

        // Check if this is an error call
        if (data.errorCode && data.errorCode !== '0') {
            this.addError(data);
        }
    }

    addError(errorData) {
        if (!errorData) return;

        // Add to error list (maintain maximum size)
        this.scormErrors.unshift(errorData);
        if (this.scormErrors.length > 500) {
            this.scormErrors = this.scormErrors.slice(0, 500);
        }

        // Re-render error list
        this.renderErrorList();
    }

    renderApiTimeline() {
        if (!this.apiTimelineElement) return;

        if (this.apiHistory.length === 0) {
            this.apiTimelineElement.innerHTML = `
                <div class="no-data">No SCORM API calls recorded yet. Load a SCORM package to begin inspection.</div>
            `;
            return;
        }

        const entriesHtml = this.apiHistory.map(entry => this.createApiEntryHtml(entry)).join('');
        this.apiTimelineElement.innerHTML = entriesHtml;
    }

    createApiEntryHtml(entry) {
        const isError = entry.errorCode && entry.errorCode !== '0';
        const cssClass = isError ? 'error' : 'success';
        const timestamp = new Date(entry.timestamp).toLocaleTimeString();
        
        const parametersStr = Array.isArray(entry.parameters) 
            ? entry.parameters.map(p => JSON.stringify(p)).join(', ')
            : '';

        return `
            <div class="api-entry ${cssClass}">
                <div>
                    <span class="api-method">${this.escapeHtml(entry.method || 'Unknown')}</span>
                    ${parametersStr ? `(<span class="api-params">${this.escapeHtml(parametersStr)}</span>)` : '()'}
                    →
                    <span class="api-result">${this.escapeHtml(entry.result || '')}</span>
                </div>
                ${isError ? `
                    <div class="api-error">
                        Error ${entry.errorCode}: ${this.escapeHtml(entry.errorMessage || 'Unknown error')}
                    </div>
                ` : ''}
                <div class="api-timestamp">
                    ${timestamp} | Session: ${this.escapeHtml(entry.sessionId || 'unknown')}
                    ${entry.durationMs !== undefined ? ` | ${entry.durationMs}ms` : ''}
                </div>
            </div>
        `;
    }

    renderErrorList() {
        if (!this.errorListElement) return;

        if (this.scormErrors.length === 0) {
            this.errorListElement.innerHTML = `
                <div class="no-data">No SCORM errors detected.</div>
            `;
            return;
        }

        const errorsHtml = this.scormErrors.map(error => this.createErrorEntryHtml(error)).join('');
        this.errorListElement.innerHTML = errorsHtml;
    }

    createErrorEntryHtml(error) {
        const timestamp = new Date(error.timestamp).toLocaleTimeString();
        const severity = error.severity || 'low';
        const troubleshootingSteps = error.troubleshootingSteps || [];

        return `
            <div class="error-entry">
                <div>
                    <span class="error-severity ${severity}">${severity}</span>
                    <span style="margin-left: 8px;">
                        ${error.method ? `${this.escapeHtml(error.method)} - ` : ''}
                        Error ${error.errorCode || 'Unknown'}
                    </span>
                </div>
                <div class="error-message">${this.escapeHtml(error.errorMessage || error.message || 'Unknown error')}</div>
                ${troubleshootingSteps.length > 0 ? `
                    <div class="troubleshooting-steps">
                        <strong>Troubleshooting:</strong>
                        <ul>
                            ${troubleshootingSteps.map(step => `<li>${this.escapeHtml(step)}</li>`).join('')}
                        </ul>
                    </div>
                ` : ''}
                <div class="api-timestamp">
                    ${timestamp} | Session: ${this.escapeHtml(error.sessionId || 'unknown')}
                </div>
            </div>
        `;
    }

    clearHistory() {
        this.apiHistory = [];
        this.scormErrors = [];
        this.renderApiTimeline();
        this.renderErrorList();
        console.log('SCORM Inspector: History cleared');
    }

    async refreshData() {
        await this.loadInitialHistory();
        console.log('SCORM Inspector: Data refreshed');
    }

    setLoading(loading) {
        this.isLoading = loading;
        if (this.refreshBtn) {
            this.refreshBtn.disabled = loading;
            this.refreshBtn.textContent = loading ? 'Loading...' : 'Refresh';
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.scormInspector = new ScormInspectorWindow();
});