"use strict";

// SCORM Inspector Window JavaScript
// Handles the display and management of SCORM package inspection data

class ScormInspectorWindow {
    constructor() {
        this.apiHistory = [];
        this.scormErrors = [];
        this.isLoading = false;
        
        this.apiTimelineElement = document.getElementById('api-timeline');
        this.errorListElement = document.getElementById('error-list');
        this.clearHistoryBtn = document.getElementById('clear-history-btn');
        this.refreshBtn = document.getElementById('refresh-btn');
        
        this.setupEventListeners();
        this.loadInitialHistory();
    }

    setupEventListeners() {
        // Button event listeners
        this.clearHistoryBtn?.addEventListener('click', () => this.clearHistory());
        this.refreshBtn?.addEventListener('click', () => this.refreshData());

        // Listen for real-time updates from main process
        if (window.electronAPI) {
            // Listen for SCORM Inspector data updates
            window.electronAPI.ipcRenderer?.on('scorm-inspector-data-updated', (event, data) => {
                this.addApiCall(data);
            });

            // Listen for SCORM Inspector error updates
            window.electronAPI.ipcRenderer?.on('scorm-inspector-error-updated', (event, errorData) => {
                this.addError(errorData);
            });
        }
    }

    async loadInitialHistory() {
        try {
            this.setLoading(true);
            
            if (!window.electronAPI?.ipcRenderer) {
                console.warn('SCORM Inspector: ElectronAPI not available');
                return;
            }

            // Request history from SCORM Inspector telemetry store
            const response = await window.electronAPI.ipcRenderer.invoke('scorm-inspector-get-history', {
                limit: 1000
            });

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