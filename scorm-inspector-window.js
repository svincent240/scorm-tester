"use strict";

// SCORM Inspector Window JavaScript
// Handles the display and management of SCORM package inspection data

import { rendererLogger } from 'scorm-app://app/src/renderer/utils/renderer-logger.js';
import { escapeHTML } from 'scorm-app://app/src/renderer/utils/escape.js';

// Centralized logger adapter (no console fallbacks)
const safeLogger = {
  error: (...args) => { try { rendererLogger.error(...args); } catch (_) {} },
  warn:  (...args) => { try { rendererLogger.warn(...args); } catch (_) {} },
  log:   (...args) => { try { rendererLogger.info(...args); } catch (_) {} },
};

// Utility function for safe JSON stringification (prevents circular references)
const safeJsonStringify = (obj, replacer = null, space = null) => {
    const seen = new WeakSet();
    
    const jsonReplacer = (key, value) => {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
                return '[Circular Reference]';
            }
            seen.add(value);
        }
        
        // Apply custom replacer if provided
        if (typeof replacer === 'function') {
            return replacer(key, value);
        }
        
        return value;
    };
    
    try {
        return JSON.stringify(obj, jsonReplacer, space);
    } catch (error) {
        safeLogger.error('Failed to stringify object:', error);
        return JSON.stringify({ error: 'Failed to serialize data', type: typeof obj }, null, space);
    }
};

class ScormInspectorWindow {
    constructor() {
        // Removed: console.log('SCORM Inspector: Initializing window...');
        
        this.apiHistory = [];
        this.scormErrors = [];
        this.dataModel = {};
        this.dataModelHistory = new Map();
        this.isLoading = false;
        this.filterText = '';
        this.isDestroyed = false;
        this.eventListeners = [];
        this.logRenderTimeout = null;

        // Use WeakMap for DOM element references to prevent memory leaks
        this.domElementCache = new WeakMap();
        this.renderingInProgress = new WeakSet();

        // Animation frame for smooth rendering
        this.animationFrame = null;

        // Rendering debounce flags
        this.isRenderingTimeline = false;
        this.isRenderingErrors = false;
        this.isRenderingDataModel = false;
        this.isRenderingLog = false;

        // Debouncing for data model updates to prevent race conditions
        this.dataModelUpdateTimeout = null;
        this.lastDataModelUpdate = 0;
        this.isUpdatingDataModel = false;
        this.pendingDataModel = null;
        
        this.apiTimelineElement = document.getElementById('api-timeline');
        this.errorListElement = document.getElementById('error-list');
        this.dataModelElement = document.getElementById('data-model');
        this.clearHistoryBtn = document.getElementById('clear-history-btn');
        this.refreshBtn = document.getElementById('refresh-btn');
        
        // Data Model controls
        this.dataFilterInput = document.getElementById('data-filter');
        this.clearFilterBtn = document.getElementById('clear-filter');
        this.expandAllDataBtn = document.getElementById('expand-all-data');
        this.collapseAllDataBtn = document.getElementById('collapse-all-data');
        this.exportDataBtn = document.getElementById('export-data');

        // Enhanced Inspector elements
        this.activityTreeElement = document.getElementById('activity-tree');
        this.navigationAnalysisElement = document.getElementById('navigation-analysis');
        this.globalObjectivesElement = document.getElementById('global-objectives');
        this.sspBucketsElement = document.getElementById('ssp-buckets');
        this.enhancedLogElement = document.getElementById('enhanced-log');

        // Enhanced Inspector controls
        this.refreshActivityTreeBtn = document.getElementById('refresh-activity-tree');
        this.expandAllActivitiesBtn = document.getElementById('expand-all-activities');
        this.collapseAllActivitiesBtn = document.getElementById('collapse-all-activities');
        this.refreshNavigationBtn = document.getElementById('refresh-navigation');
        this.expandAllNavBtn = document.getElementById('expand-all-nav');
        this.collapseAllNavBtn = document.getElementById('collapse-all-nav');
        this.refreshObjectivesBtn = document.getElementById('refresh-objectives');
        this.exportObjectivesBtn = document.getElementById('export-objectives');
        this.refreshSspBtn = document.getElementById('refresh-ssp');
        this.exportSspBtn = document.getElementById('export-ssp');
        this.clearEnhancedLogBtn = document.getElementById('clear-enhanced-log');
        this.exportEnhancedLogBtn = document.getElementById('export-enhanced-log');
        this.expandAllLogBtn = document.getElementById('expand-all-log');

        // Log category filters
        this.logControlFilter = document.getElementById('log-control');
        this.logRuntimeFilter = document.getElementById('log-runtime');
        this.logSequencingFilter = document.getElementById('log-sequencing');
        this.logPcodeFilter = document.getElementById('log-pcode');

        // Enhanced data storage
        this.activityTree = {};
        this.navigationRequests = [];
        this.globalObjectives = [];
        this.sspBuckets = [];
        this.enhancedLogEntries = [];
        
        // Removed: console.log('SCORM Inspector: Elements found:', { ... });
        
        this.setupEventListeners();
        this.loadInitialHistory();

        // Load enhanced inspector data on initialization
        this.loadEnhancedInspectorData();
    }

    setupEventListeners() {
        // Initialize event listeners array if not exists
        if (!this.eventListeners) {
            this.eventListeners = [];
        }

        // Button event listeners with proper cleanup tracking
        this.addEventListenerSafe(this.clearHistoryBtn, 'click', () => this.clearHistory());
        this.addEventListenerSafe(this.refreshBtn, 'click', () => this.refreshData());

        // Data Model event listeners
        this.addEventListenerSafe(this.dataFilterInput, 'input', (e) => this.filterDataModel(e.target.value));
        this.addEventListenerSafe(this.clearFilterBtn, 'click', () => this.clearFilter());
        this.addEventListenerSafe(this.expandAllDataBtn, 'click', () => this.expandAllCategories());
        this.addEventListenerSafe(this.collapseAllDataBtn, 'click', () => this.collapseAllCategories());
        this.addEventListenerSafe(this.exportDataBtn, 'click', () => this.exportDataModel());

        // Enhanced Inspector event listeners
        this.addEventListenerSafe(this.refreshActivityTreeBtn, 'click', () => this.refreshActivityTree());
        this.addEventListenerSafe(this.expandAllActivitiesBtn, 'click', () => this.expandAllActivities());
        this.addEventListenerSafe(this.collapseAllActivitiesBtn, 'click', () => this.collapseAllActivities());
        this.addEventListenerSafe(this.refreshNavigationBtn, 'click', () => this.refreshNavigation());
        this.addEventListenerSafe(this.expandAllNavBtn, 'click', () => this.expandAllNavigation());
        this.addEventListenerSafe(this.collapseAllNavBtn, 'click', () => this.collapseAllNavigation());
        this.addEventListenerSafe(this.refreshObjectivesBtn, 'click', () => this.refreshObjectives());
        this.addEventListenerSafe(this.exportObjectivesBtn, 'click', () => this.exportObjectives());
        this.addEventListenerSafe(this.refreshSspBtn, 'click', () => this.refreshSSP());
        this.addEventListenerSafe(this.exportSspBtn, 'click', () => this.exportSSP());
        this.addEventListenerSafe(this.clearEnhancedLogBtn, 'click', () => this.clearEnhancedLog());
        this.addEventListenerSafe(this.exportEnhancedLogBtn, 'click', () => this.exportEnhancedLog());
        this.addEventListenerSafe(this.expandAllLogBtn, 'click', () => this.expandAllLog());

        // Log filter event listeners
        this.addEventListenerSafe(this.logControlFilter, 'change', () => this.filterEnhancedLog());
        this.addEventListenerSafe(this.logRuntimeFilter, 'change', () => this.filterEnhancedLog());
        this.addEventListenerSafe(this.logSequencingFilter, 'change', () => this.filterEnhancedLog());
        this.addEventListenerSafe(this.logPcodeFilter, 'change', () => this.filterEnhancedLog());

        // Set up IPC event listeners after electronAPI is available
        this.setupIpcEventListeners();

        // Set up course and session event listeners
        this.setupCourseEventListeners();

        // Set up cleanup handlers
        this.setupCleanupHandlers();
    }

    async setupIpcEventListeners() {
        try {
            // Wait for electronAPI to be available
            const apiAvailable = await this.waitForElectronAPI();
            if (!apiAvailable || !window.electronAPI) {
                safeLogger.error('SCORM Inspector: electronAPI not available after wait');
                return;
            }

            // Listen for real-time updates from main process
            if (typeof window.electronAPI.onScormInspectorDataUpdated === 'function') {
                try {
                    window.electronAPI.onScormInspectorDataUpdated((data) => {
                        // Removed: console.log('SCORM Inspector: Received API call update', data);
                        this.addApiCall(data);
 
                        // Note: Data model updates are handled by onScormDataModelUpdated listener
                        // to avoid race conditions. We don't need to refresh here.
                    });
                    // Removed: console.log('SCORM Inspector: Data update listener registered');
                } catch (error) {
                    safeLogger.error('SCORM Inspector: Failed to register data update listener:', error);
                }
            } else {
                safeLogger.warn('SCORM Inspector: onScormInspectorDataUpdated method not available');
            }
 
            // Listen for SCORM Inspector error updates
            if (typeof window.electronAPI.onScormInspectorErrorUpdated === 'function') {
                try {
                    window.electronAPI.onScormInspectorErrorUpdated((errorData) => {
                        // Removed: console.log('SCORM Inspector: Received error update', errorData);
                        this.addError(errorData);
                    });
                    // Removed: console.log('SCORM Inspector: Error update listener registered');
                } catch (error) {
                    safeLogger.error('SCORM Inspector: Failed to register error update listener:', error);
                }
            } else {
                safeLogger.warn('SCORM Inspector: onScormInspectorErrorUpdated method not available');
            }
 
            // Listen for SCORM Data Model updates
            if (typeof window.electronAPI.onScormDataModelUpdated === 'function') {
                try {
                    window.electronAPI.onScormDataModelUpdated((dataModel) => {
                        // Removed: console.log('SCORM Inspector: Received data model update', dataModel);
                        this.updateDataModel(dataModel);
                    });
                    // Removed: console.log('SCORM Inspector: Data model update listener registered');
                } catch (error) {
                    safeLogger.error('SCORM Inspector: Failed to register data model update listener:', error);
                }
            } else {
                safeLogger.warn('SCORM Inspector: onScormDataModelUpdated method not available');
            }
        } catch (error) {
            safeLogger.error('SCORM Inspector: Failed to setup IPC event listeners:', error);
        }
    }

    async setupCourseEventListeners() {
        try {
            // Wait for electronAPI to be available
            const apiAvailable = await this.waitForElectronAPI();
            if (!apiAvailable || !window.electronAPI) {
                safeLogger.error('SCORM Inspector: electronAPI not available after wait');
                return;
            }

            // Listen for course loaded events
            if (typeof window.electronAPI.onCourseLoaded === 'function') {
                try {
                    window.electronAPI.onCourseLoaded(() => {
                        // Removed: console.log('SCORM Inspector: Course loaded, refreshing data');
                        // Refresh all inspector data when a new course is loaded
                        setTimeout(() => {
                            this.refreshData();
                            this.refreshActivityTree();
                            this.refreshNavigation();
                            this.refreshObjectives();
                            this.refreshSSP();
                        }, 500); // Small delay to allow session creation
                    });
                    // Removed: console.log('SCORM Inspector: Course loaded listener registered');
                } catch (error) {
                    safeLogger.error('SCORM Inspector: Failed to register course loaded listener:', error);
                }
            } else {
                safeLogger.warn('SCORM Inspector: onCourseLoaded method not available');
            }
 
            // Listen for session state changes
            if (typeof window.electronAPI.onSessionStateChanged === 'function') {
                try {
                    window.electronAPI.onSessionStateChanged(() => {
                        // Removed: console.log('SCORM Inspector: Session state changed, refreshing data');
                        // Refresh inspector data when session state changes
                        setTimeout(() => {
                            this.refreshData();
                        }, 100);
                    });
                    // Removed: console.log('SCORM Inspector: Session state change listener registered');
                } catch (error) {
                    safeLogger.error('SCORM Inspector: Failed to register session state change listener:', error);
                }
            } else {
                safeLogger.warn('SCORM Inspector: onSessionStateChanged method not available');
            }
        } catch (error) {
            safeLogger.error('SCORM Inspector: Failed to setup course event listeners:', error);
        }
    }

    async loadInitialHistory() {
        try {
            this.setLoading(true);
            
            // Wait for electronAPI to be available
            const apiAvailable = await this.waitForElectronAPI();
            if (!apiAvailable || !window.electronAPI?.getScormInspectorHistory) {
                safeLogger.error('SCORM Inspector: getScormInspectorHistory method not available');
                return;
            }
 
            // Request history from SCORM Inspector telemetry store
            // Removed: console.log('SCORM Inspector: Calling getScormInspectorHistory...');
            let response;
            try {
                response = await window.electronAPI.getScormInspectorHistory();
                // Removed: console.log('SCORM Inspector: getScormInspectorHistory response:', JSON.stringify(response, null, 2));
            } catch (error) {
                safeLogger.error('SCORM Inspector: getScormInspectorHistory failed:', error);
                this.setLoading(false);
                return;
            }
 
            if (response.success && response.data) {
                const { history = [], errors = [], dataModel = {} } = response.data;
                // Removed: console.log('SCORM Inspector: Response data breakdown:', JSON.stringify({ ... }, null, 2));
 
                // Load API call history
                this.apiHistory = history;
                this.renderApiTimeline();
 
                // Load error history
                this.scormErrors = errors;
                this.renderErrorList();
 
                // Load data model (only if it contains actual data)
                const hasDataModelData = dataModel && Object.keys(dataModel).length > 0 &&
                    (dataModel.coreData || dataModel.interactions ||
                     dataModel.objectives || dataModel.commentsFromLearner ||
                     dataModel.commentsFromLms);
 
                if (hasDataModelData) {
                    this.dataModel = dataModel;
                    this.renderDataModel();
                } else {
                    // Removed: console.log('SCORM Inspector: Skipping empty data model from initial load');
                    // Only render if we don't have existing data
                    if (!this.dataModel || Object.keys(this.dataModel).length === 0) {
                        this.renderDataModel();
                    }
                }
 
                // Removed: console.log(`SCORM Inspector: Loaded ${history.length} API calls, ${errors.length} errors, and ${Object.keys(dataModel).length} data model elements`);
            } else {
                // Removed: console.warn('SCORM Inspector: Failed to load history', response.error);
            }
        } catch (error) {
            safeLogger.error('SCORM Inspector: Error loading initial history', error);
        } finally {
            this.setLoading(false);
        }
    }

    async loadEnhancedInspectorData() {
        try {
            // Wait for electronAPI to be available
            const apiAvailable = await this.waitForElectronAPI();
            if (!apiAvailable) {
                safeLogger.warn('SCORM Inspector: Enhanced inspector features will not be available (electronAPI timeout)');
                return;
            }

            // Load activity tree data
            this.refreshActivityTree();

            // Load other enhanced inspector data
            this.refreshNavigation();
            this.refreshObjectives();
            this.refreshSSP();

        } catch (error) {
            safeLogger.error('SCORM Inspector: Error loading enhanced inspector data', error);
        }
    }
 
    async waitForElectronAPI(timeout = 5000) {
        const startTime = Date.now();
        
        while (!window.electronAPI) {
            if (Date.now() - startTime > timeout) {
                safeLogger.error('SCORM Inspector: Timeout waiting for electronAPI to be available');
                // Return false instead of throwing to allow graceful degradation
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        // Removed: console.log('SCORM Inspector: electronAPI is now available');
        return true;
    }
 
    addApiCall(data) {
        if (!data || this.isDestroyed) return;

        // Add to history (maintain maximum size) - optimize memory usage
        this.apiHistory.push(data);
        if (this.apiHistory.length > 2000) {
            // Use shift() for better memory management than splice
            const removeCount = this.apiHistory.length - 2000;
            for (let i = 0; i < removeCount; i++) {
                this.apiHistory.shift();
            }
        }

        // Re-render timeline
        this.renderApiTimeline();

        // Check if this is an error call
        if (data.errorCode && data.errorCode !== '0') {
            this.addError(data);
        }
    }

    addError(errorData) {
        if (!errorData || this.isDestroyed) return;

        // Add to error list (maintain maximum size) - optimize memory usage
        this.scormErrors.push(errorData);
        if (this.scormErrors.length > 500) {
            // Use shift() for better memory management than splice
            const removeCount = this.scormErrors.length - 500;
            for (let i = 0; i < removeCount; i++) {
                this.scormErrors.shift();
            }
        }

        // Re-render error list
        this.renderErrorList();
    }

    renderApiTimeline() {
        if (!this.apiTimelineElement || this.isDestroyed || this.isRenderingTimeline) return;

        this.isRenderingTimeline = true;

        try {
            // Use animation frame for smooth rendering
            if (this.animationFrame) {
                cancelAnimationFrame(this.animationFrame);
            }

            this.animationFrame = requestAnimationFrame(() => {
                try {
                    // Reverse array for display (newest first) without mutating original
                    const displayHistory = [...this.apiHistory].reverse();

                    if (this.apiHistory.length === 0) {
                        this.apiTimelineElement.innerHTML = `
                            <div class="no-data">No SCORM API calls recorded yet. Load a SCORM package to begin inspection.</div>
                        `;
                        return;
                    }

                    // Limit rendered entries to prevent DOM overload
                    const maxEntries = 1000;
                    const limitedHistory = displayHistory.slice(0, maxEntries);
                    const entriesHtml = limitedHistory.map(entry => this.createApiEntryHtml(entry)).join('');

                    this.apiTimelineElement.innerHTML = entriesHtml;

                    if (displayHistory.length > maxEntries) {
                        const notice = document.createElement('div');
                        notice.className = 'data-filter-stats';
                        notice.textContent = `Showing ${maxEntries} of ${displayHistory.length} entries`;
                        this.apiTimelineElement.insertBefore(notice, this.apiTimelineElement.firstChild);
                    }
                } finally {
                    this.isRenderingTimeline = false;
                    this.animationFrame = null;
                }
            });
        } catch (error) {
            safeLogger.error('Error rendering API timeline:', error);
            this.isRenderingTimeline = false;
        }
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
        if (!this.errorListElement || this.isDestroyed || this.isRenderingErrors) return;

        this.isRenderingErrors = true;

        try {
            // Use requestAnimationFrame for smooth rendering
            requestAnimationFrame(() => {
                try {
                    // Reverse array for display (newest first) without mutating original
                    const displayErrors = [...this.scormErrors].reverse();

                    if (this.scormErrors.length === 0) {
                        this.errorListElement.innerHTML = `
                            <div class="no-data">No SCORM errors detected.</div>
                        `;
                        return;
                    }

                    // Limit rendered errors to prevent DOM overload
                    const maxErrors = 500;
                    const limitedErrors = displayErrors.slice(0, maxErrors);
                    const errorsHtml = limitedErrors.map(error => this.createErrorEntryHtml(error)).join('');

                    this.errorListElement.innerHTML = errorsHtml;

                    if (displayErrors.length > maxErrors) {
                        const notice = document.createElement('div');
                        notice.className = 'data-filter-stats';
                        notice.textContent = `Showing ${maxErrors} of ${displayErrors.length} errors`;
                        this.errorListElement.insertBefore(notice, this.errorListElement.firstChild);
                    }
                } finally {
                    this.isRenderingErrors = false;
                }
            });
        } catch (error) {
            safeLogger.error('Error rendering error list:', error);
            this.isRenderingErrors = false;
        }
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
        this.dataModel = {};
        this.dataModelHistory.clear();
        this.renderApiTimeline();
        this.renderErrorList();
        this.renderDataModel();
        // Removed: console.log('SCORM Inspector: History cleared');
    }
 
    async refreshData() {
        await this.loadInitialHistory();
        // Removed: console.log('SCORM Inspector: Data refreshed');
    }
 
    setLoading(loading) {
        this.isLoading = loading;
        if (this.refreshBtn) {
            this.refreshBtn.disabled = loading;
            this.refreshBtn.textContent = loading ? 'Loading...' : 'Refresh';
        }
    }

    escapeHtml(text) {
        // Delegate to shared utility
        return escapeHTML(text);
    }

    /* Removed legacy body:
        if (typeof text !== 'string') {
            text = String(text);
        }
        try {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        } catch (error) {
            // Fallback for environments where DOM manipulation is restricted
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }
    }

    // ==================== DATA MODEL FUNCTIONALITY ====================

    updateDataModel(newDataModel) {
        if (!newDataModel) return;

        // Prevent race conditions by debouncing rapid updates using a flag-based approach
        const now = Date.now();
        if (this.isUpdatingDataModel) {
            // If already updating, store the latest data and return
            this.pendingDataModel = newDataModel;
            return;
        }
        
        // If we received an update too recently, debounce it
        if ((now - this.lastDataModelUpdate) < 50) {
            // Clear any pending update and schedule a new one
            if (this.dataModelUpdateTimeout) {
                clearTimeout(this.dataModelUpdateTimeout);
            }
            this.dataModelUpdateTimeout = setTimeout(() => {
                // Use the most recent pending data if available
                const dataToUpdate = this.pendingDataModel || newDataModel;
                this.pendingDataModel = null;
                this.updateDataModel(dataToUpdate);
            }, 100);
            return;
        }

        this.isUpdatingDataModel = true;
        this.lastDataModelUpdate = now;

        // Validate that we're not overwriting good data with empty data
        const hasExistingData = this.dataModel && Object.keys(this.dataModel).length > 0;
        const isNewDataEmpty = !newDataModel || Object.keys(newDataModel).length === 0 ||
            (!newDataModel.coreData && !newDataModel.interactions &&
             !newDataModel.objectives && !newDataModel.commentsFromLearner &&
             !newDataModel.commentsFromLms);
 
        if (hasExistingData && isNewDataEmpty) {
            safeLogger.warn('SCORM Inspector: Ignoring empty data model update to prevent overwriting existing data');
            this.isUpdatingDataModel = false;
            return;
        }
 
        // Track changes for highlighting (simplified for structured data)
        const changedKeys = new Set();

        // For structured data, we'll do a simple deep comparison
        const oldDataStr = safeJsonStringify(this.dataModel);
        const newDataStr = safeJsonStringify(newDataModel);

        if (oldDataStr !== newDataStr) {
            // Mark as changed - we could implement more granular change tracking later
            changedKeys.add('__data_changed__');

            // Store change history for the entire data model
            this.dataModelHistory.set('dataModel', {
                previousValue: this.dataModel,
                newValue: newDataModel,
                timestamp: Date.now()
            });
        }

        this.dataModel = newDataModel;
        this.renderDataModel(changedKeys);
        this.isUpdatingDataModel = false;
        
        // Process any pending update that arrived while we were processing
        if (this.pendingDataModel) {
            const pendingData = this.pendingDataModel;
            this.pendingDataModel = null;
            // Schedule the pending update to avoid immediate recursion
            setTimeout(() => this.updateDataModel(pendingData), 10);
        }
    }

    renderDataModel(changedKeys = new Set()) {
        if (!this.dataModelElement || this.isDestroyed || this.isRenderingDataModel) return;

        this.isRenderingDataModel = true;

        try {
            // Use requestAnimationFrame for smooth rendering
            requestAnimationFrame(() => {
                try {
                    // Check if data model is empty (handle both flat and structured formats)
                    const isEmpty = !this.dataModel ||
                        (Object.keys(this.dataModel).length === 0) ||
                        (!this.dataModel.coreData && !this.dataModel.interactions &&
                         !this.dataModel.objectives && !this.dataModel.commentsFromLearner &&
                         !this.dataModel.commentsFromLms);

                    if (isEmpty) {
                        this.dataModelElement.innerHTML = `
                            <div class="no-data">No SCORM data available. Load a SCORM package to view data model values.</div>
                        `;
                        return;
                    }

                    const categories = this.categorizeDataModel();
                    const filteredCategories = this.applyFilter(categories);

                    let html = '';
                    if (this.filterText) {
                        const totalItems = Object.values(categories).reduce((sum, cat) => sum + Object.keys(cat.items).length, 0);
                        const filteredItems = Object.values(filteredCategories).reduce((sum, cat) => sum + Object.keys(cat.items).length, 0);
                        html += `<div class="data-filter-stats">Showing ${filteredItems} of ${totalItems} data points</div>`;
                    }

                    html += Object.entries(filteredCategories)
                        .map(([categoryName, category]) => this.renderCategory(categoryName, category, changedKeys))
                        .join('');

                    this.dataModelElement.innerHTML = html;
                    this.bindCategoryEvents();
                } finally {
                    this.isRenderingDataModel = false;
                }
            });
        } catch (error) {
            safeLogger.error('Error rendering data model:', error);
            this.isRenderingDataModel = false;
        }
    }

    categorizeDataModel() {
        const categories = {
            'Core Tracking': {
                icon: '🎯',
                items: {},
                description: 'Essential completion and success tracking'
            },
            'Score & Assessment': {
                icon: '📊',
                items: {},
                description: 'Scoring and assessment data'
            },
            'Time Tracking': {
                icon: '⏱️',
                items: {},
                description: 'Session and total time data'
            },
            'Progress & Location': {
                icon: '📍',
                items: {},
                description: 'Progress and navigation data'
            },
            'Learner Information': {
                icon: '👤',
                items: {},
                description: 'Learner identity and preferences'
            },
            'Objectives': {
                icon: '🎓',
                items: {},
                description: 'Learning objectives tracking'
            },
            'Interactions': {
                icon: '💬',
                items: {},
                description: 'Learner interaction responses'
            },
            'Comments': {
                icon: '📝',
                items: {},
                description: 'Comments between learner and LMS'
            },
            'System Data': {
                icon: '⚙️',
                items: {},
                description: 'System and session management'
            }
        };

        // Handle structured data model format from getAllData()
        if (this.dataModel.coreData || this.dataModel.interactions || this.dataModel.objectives) {
            // Process coreData (flat key-value pairs)
            if (this.dataModel.coreData && typeof this.dataModel.coreData === 'object') {
                for (const [key, value] of Object.entries(this.dataModel.coreData)) {
                    let category = 'System Data'; // Default category

                    if (key.includes('completion_status') || key.includes('success_status') || key.includes('credit')) {
                        category = 'Core Tracking';
                    } else if (key.includes('score')) {
                        category = 'Score & Assessment';
                    } else if (key.includes('time') || key.includes('session_time') || key.includes('total_time')) {
                        category = 'Time Tracking';
                    } else if (key.includes('progress') || key.includes('location') || key.includes('entry') || key.includes('exit')) {
                        category = 'Progress & Location';
                    } else if (key.includes('learner')) {
                        category = 'Learner Information';
                    }

                    categories[category].items[key] = value;
                }
            }

            // Process interactions array
            if (this.dataModel.interactions && Array.isArray(this.dataModel.interactions)) {
                this.dataModel.interactions.forEach((interaction, index) => {
                    if (interaction && typeof interaction === 'object') {
                        try {
                            for (const [key, value] of Object.entries(interaction)) {
                                const fullKey = `interactions[${index}].${key}`;
                                categories['Interactions'].items[fullKey] = value;
                            }
                        } catch (error) {
                            safeLogger.error(`Failed to process interaction at index ${index}:`, error);
                            // Add a placeholder entry for the failed interaction
                            categories['Interactions'].items[`interactions[${index}]`] = '[Error processing interaction data]';
                        }
                    } else if (interaction !== null && interaction !== undefined) {
                        // Handle non-object interaction data
                        try {
                            categories['Interactions'].items[`interactions[${index}]`] = interaction;
                        } catch (error) {
                            safeLogger.error(`Failed to process interaction value at index ${index}:`, error);
                            categories['Interactions'].items[`interactions[${index}]`] = '[Error processing interaction value]';
                        }
                    }
                });
            }

            // Process objectives array
            if (this.dataModel.objectives && Array.isArray(this.dataModel.objectives)) {
                this.dataModel.objectives.forEach((objective, index) => {
                    if (objective && typeof objective === 'object') {
                        try {
                            for (const [key, value] of Object.entries(objective)) {
                                const fullKey = `objectives[${index}].${key}`;
                                categories['Objectives'].items[fullKey] = value;
                            }
                        } catch (error) {
                            safeLogger.error(`Failed to process objective at index ${index}:`, error);
                            categories['Objectives'].items[`objectives[${index}]`] = '[Error processing objective data]';
                        }
                    } else if (objective !== null && objective !== undefined) {
                        try {
                            categories['Objectives'].items[`objectives[${index}]`] = objective;
                        } catch (error) {
                            safeLogger.error(`Failed to process objective value at index ${index}:`, error);
                            categories['Objectives'].items[`objectives[${index}]`] = '[Error processing objective value]';
                        }
                    }
                });
            }

            // Process comments from learner
            if (this.dataModel.commentsFromLearner && Array.isArray(this.dataModel.commentsFromLearner)) {
                this.dataModel.commentsFromLearner.forEach((comment, index) => {
                    if (comment && typeof comment === 'object') {
                        try {
                            for (const [key, value] of Object.entries(comment)) {
                                const fullKey = `commentsFromLearner[${index}].${key}`;
                                categories['Comments'].items[fullKey] = value;
                            }
                        } catch (error) {
                            safeLogger.error(`Failed to process learner comment at index ${index}:`, error);
                            categories['Comments'].items[`commentsFromLearner[${index}]`] = '[Error processing comment data]';
                        }
                    } else if (comment !== null && comment !== undefined) {
                        categories['Comments'].items[`commentsFromLearner[${index}]`] = comment;
                    }
                });
            }

            // Process comments from LMS
            if (this.dataModel.commentsFromLms && Array.isArray(this.dataModel.commentsFromLms)) {
                this.dataModel.commentsFromLms.forEach((comment, index) => {
                    if (comment && typeof comment === 'object') {
                        try {
                            for (const [key, value] of Object.entries(comment)) {
                                const fullKey = `commentsFromLms[${index}].${key}`;
                                categories['Comments'].items[fullKey] = value;
                            }
                        } catch (error) {
                            safeLogger.error(`Failed to process LMS comment at index ${index}:`, error);
                            categories['Comments'].items[`commentsFromLms[${index}]`] = '[Error processing comment data]';
                        }
                    } else if (comment !== null && comment !== undefined) {
                        categories['Comments'].items[`commentsFromLms[${index}]`] = comment;
                    }
                });
            }
        } else {
            // Fallback: handle flat data model format (backward compatibility)
            try {
                for (const [key, value] of Object.entries(this.dataModel)) {
                    let category = 'System Data'; // Default category

                if (key.includes('completion_status') || key.includes('success_status') || key.includes('credit')) {
                    category = 'Core Tracking';
                } else if (key.includes('score')) {
                    category = 'Score & Assessment';
                } else if (key.includes('time') || key.includes('session_time') || key.includes('total_time')) {
                    category = 'Time Tracking';
                } else if (key.includes('progress') || key.includes('location') || key.includes('entry') || key.includes('exit')) {
                    category = 'Progress & Location';
                } else if (key.includes('learner')) {
                    category = 'Learner Information';
                } else if (key.includes('objectives')) {
                    category = 'Objectives';
                } else if (key.includes('interactions')) {
                    category = 'Interactions';
                } else if (key.includes('comments')) {
                    category = 'Comments';
                }

                    categories[category].items[key] = value;
                }
            } catch (error) {
                safeLogger.error('Failed to process flat data model format:', error);
                categories['System Data'].items['[Error]'] = 'Failed to process data model';
            }
        }

        // Remove empty categories
        return Object.fromEntries(
            Object.entries(categories).filter(([_, category]) => Object.keys(category.items).length > 0)
        );
    }

    applyFilter(categories) {
        if (!this.filterText) return categories;

        const filtered = {};
        const filterLower = this.filterText.toLowerCase();

        for (const [categoryName, category] of Object.entries(categories)) {
            const filteredItems = {};
            
            for (const [key, value] of Object.entries(category.items)) {
                const keyLower = key.toLowerCase();
                const valueLower = String(value).toLowerCase();
                
                if (keyLower.includes(filterLower) || valueLower.includes(filterLower)) {
                    filteredItems[key] = value;
                }
            }

            if (Object.keys(filteredItems).length > 0) {
                filtered[categoryName] = {
                    ...category,
                    items: filteredItems
                };
            }
        }

        return filtered;
    }

    renderCategory(categoryName, category, changedKeys) {
        const itemCount = Object.keys(category.items).length;
        const isCollapsed = this.getCategoryCollapsedState(categoryName);
        
        return `
            <div class="data-category ${isCollapsed ? 'collapsed' : ''}" data-category="${categoryName}">
                <div class="data-category-header">
                    <div class="data-category-title">
                        <span>${category.icon}</span>
                        <span>${categoryName}</span>
                        <span class="data-category-count">${itemCount}</span>
                    </div>
                    <span class="data-category-toggle">▼</span>
                </div>
                <div class="data-category-content">
                    ${Object.entries(category.items)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([key, value]) => this.renderDataItem(key, value, changedKeys.has(key)))
                        .join('')}
                </div>
            </div>
        `;
    }

    renderDataItem(key, value, isChanged = false) {
        const valueType = this.getValueType(value);
        const formattedValue = this.formatValue(value, valueType);
        const isFiltered = this.filterText && 
            (key.toLowerCase().includes(this.filterText.toLowerCase()) || 
             String(value).toLowerCase().includes(this.filterText.toLowerCase()));

        return `
            <div class="data-item ${isChanged ? 'data-item-changed' : ''} ${isFiltered ? 'filtered-match' : ''}" 
                 data-key="${this.escapeHtml(key)}">
                <span class="data-item-name">${this.escapeHtml(key)}</span>
                <span class="data-item-value ${valueType}">${formattedValue}</span>
                <span class="data-item-type">${valueType.replace('-value', '').replace('-', ' ')}</span>
            </div>
        `;
    }

    getValueType(value) {
        if (value === null || value === undefined) return 'null-value';
        if (typeof value === 'boolean') return value ? 'boolean-true' : 'boolean-false';
        if (typeof value === 'number') return 'number-value';
        if (typeof value === 'string') return 'string-value';
        return 'object-value';
    }

    formatValue(value, valueType) {
        if (value === null || value === undefined) return 'null';
        if (valueType === 'string-value') return `"${this.escapeHtml(value)}"`;
        if (valueType === 'object-value') return this.escapeHtml(safeJsonStringify(value));
        return this.escapeHtml(String(value));
    }

    bindCategoryEvents() {
        // Add click handlers for category toggles
        const categoryHeaders = this.dataModelElement.querySelectorAll('.data-category-header');
        categoryHeaders.forEach(header => {
            header.addEventListener('click', () => {
                const category = header.closest('.data-category');
                const categoryName = category.dataset.category;
                this.toggleCategory(categoryName);
            });
        });
    }

    toggleCategory(categoryName) {
        const category = this.dataModelElement.querySelector(`[data-category="${categoryName}"]`);
        if (category) {
            category.classList.toggle('collapsed');
            this.setCategoryCollapsedState(categoryName, category.classList.contains('collapsed'));
        }
    }

    getCategoryCollapsedState(categoryName) {
        try {
            const key = `scorm-inspector-category-${categoryName}`;
            const value = localStorage.getItem(key);
            return value === 'true';
        } catch (error) {
            safeLogger.warn('Failed to read category state from localStorage:', error);
            return false; // Default to expanded
        }
    }

    setCategoryCollapsedState(categoryName, collapsed) {
        try {
            const key = `scorm-inspector-category-${categoryName}`;
            if (collapsed) {
                localStorage.setItem(key, 'true');
            } else {
                localStorage.removeItem(key); // Save space by removing false values
            }
        } catch (error) {
            safeLogger.warn('Failed to save category state to localStorage:', error);
        }
    }

    filterDataModel(filterText) {
        this.filterText = filterText.trim();

        // Temporarily block data model updates to prevent race conditions during filtering
        const wasUpdating = this.isUpdatingDataModel;
        this.isUpdatingDataModel = true;

        this.renderDataModel();

        // Update clear button visibility
        if (this.clearFilterBtn) {
            this.clearFilterBtn.style.display = this.filterText ? 'flex' : 'none';
        }

        // Restore update state after a brief delay
        setTimeout(() => {
            this.isUpdatingDataModel = wasUpdating;
        }, 100);
    }

    clearFilter() {
        this.filterText = '';
        if (this.dataFilterInput) {
            this.dataFilterInput.value = '';
        }

        // Temporarily block data model updates to prevent race conditions
        const wasUpdating = this.isUpdatingDataModel;
        this.isUpdatingDataModel = true;

        this.renderDataModel();

        if (this.clearFilterBtn) {
            this.clearFilterBtn.style.display = 'none';
        }

        // Restore update state after a brief delay
        setTimeout(() => {
            this.isUpdatingDataModel = wasUpdating;
        }, 200);
    }

    expandAllCategories() {
        const categories = this.dataModelElement.querySelectorAll('.data-category');
        categories.forEach(category => {
            category.classList.remove('collapsed');
            const categoryName = category.dataset.category;
            this.setCategoryCollapsedState(categoryName, false);
        });
    }

    collapseAllCategories() {
        const categories = this.dataModelElement.querySelectorAll('.data-category');
        categories.forEach(category => {
            category.classList.add('collapsed');
            const categoryName = category.dataset.category;
            this.setCategoryCollapsedState(categoryName, true);
        });
    }

    exportDataModel() {
        if (Object.keys(this.dataModel).length === 0) {
            alert('No data model to export. Load a SCORM package first.');
            return;
        }

        const exportData = {
            timestamp: new Date().toISOString(),
            dataModel: this.dataModel,
            history: Object.fromEntries(this.dataModelHistory),
            metadata: {
                totalElements: Object.keys(this.dataModel).length,
                exportedBy: 'SCORM Tester Inspector',
                version: '1.0'
            }
        };

        const dataStr = safeJsonStringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `scorm-data-model-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
 
        // Removed: console.log('SCORM Inspector: Data model exported');
    }
 
    // ==================== ENHANCED INSPECTOR FUNCTIONALITY ====================
 
    // Activity Tree Methods
    refreshActivityTree() {
        // Request activity tree from main process
        if (window.electronAPI?.getActivityTree) {
            window.electronAPI.getActivityTree().then(response => {
                if (response.success) {
                    this.activityTree = response.data || {};
                    this.renderActivityTree();
                }
            }).catch(error => {
                safeLogger.error('Failed to refresh activity tree:', error);
            });
        }
    }
 
    renderActivityTree() {
        if (!this.activityTreeElement) return;

        if (!this.activityTree || Object.keys(this.activityTree).length === 0) {
            this.activityTreeElement.innerHTML = `
                <div class="no-data">No course structure available. Load a SCORM package to view activity tree.</div>
            `;
            return;
        }

        const html = this.renderActivityNode(this.activityTree, 0);
        this.activityTreeElement.innerHTML = html;
        this.bindActivityTreeEvents();
    }

    renderActivityNode(activity, depth) {
        if (!activity) return '';

        const isCollapsed = this.getActivityNodeCollapsedState(activity.id);
        const hasChildren = activity.children && activity.children.length > 0;
        const indent = depth * 20;
        
        let html = `
            <div class="activity-node ${isCollapsed ? 'collapsed' : ''}" data-activity-id="${activity.id}">
                <div class="activity-header" style="padding-left: ${indent + 12}px;">
                    ${hasChildren ? `<span class="activity-toggle">▼</span>` : `<span class="activity-toggle" style="visibility: hidden;">▼</span>`}
                    <span class="activity-icon">${this.getActivityIcon(activity)}</span>
                    <span class="activity-title">${this.escapeHtml(activity.title || activity.id)}</span>
                    <span class="activity-id">${this.escapeHtml(activity.id)}</span>
                    <span class="activity-status ${this.getActivityStatusClass(activity.status)}">${activity.status || 'unknown'}</span>
                </div>
                <div class="activity-content">
        `;

        // Add detailed activity information
        if (activity.details) {
            html += this.renderActivityDetails(activity.details);
        }

        // Add children
        if (hasChildren) {
            activity.children.forEach(child => {
                html += this.renderActivityNode(child, depth + 1);
            });
        }

        html += `
                </div>
            </div>
        `;

        return html;
    }

    renderActivityDetails(details) {
        return `
            <div class="activity-details">
                <div class="activity-detail-group">
                    <div class="activity-detail-title">Tracking Data</div>
                    <div class="activity-detail-item">
                        <span class="activity-detail-label">Completion Status:</span>
                        <span class="activity-detail-value">${details.completionStatus || 'unknown'}</span>
                    </div>
                    <div class="activity-detail-item">
                        <span class="activity-detail-label">Success Status:</span>
                        <span class="activity-detail-value">${details.successStatus || 'unknown'}</span>
                    </div>
                    <div class="activity-detail-item">
                        <span class="activity-detail-label">Progress Measure:</span>
                        <span class="activity-detail-value">${details.progressMeasure || 'unknown'}</span>
                    </div>
                    <div class="activity-detail-item">
                        <span class="activity-detail-label">Attempted:</span>
                        <span class="activity-detail-value">${details.attempted ? 'true' : 'false'}</span>
                    </div>
                </div>
                ${details.objectives ? `
                    <div class="activity-detail-group">
                        <div class="activity-detail-title">Activity Objectives (${details.objectives.length})</div>
                        ${details.objectives.map(obj => `
                            <div class="activity-detail-item">
                                <span class="activity-detail-label">${this.escapeHtml(obj.id || 'Objective')}:</span>
                                <span class="activity-detail-value">${obj.status || 'unknown'}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                ${details.sequencingDefinition ? `
                    <div class="activity-detail-group">
                        <div class="activity-detail-title">Sequencing Definition</div>
                        <div class="activity-detail-item">
                            <span class="activity-detail-label">Choice:</span>
                            <span class="activity-detail-value">${details.sequencingDefinition.choice ? 'enabled' : 'disabled'}</span>
                        </div>
                        <div class="activity-detail-item">
                            <span class="activity-detail-label">Flow:</span>
                            <span class="activity-detail-value">${details.sequencingDefinition.flow ? 'enabled' : 'disabled'}</span>
                        </div>
                        <div class="activity-detail-item">
                            <span class="activity-detail-label">Forward Only:</span>
                            <span class="activity-detail-value">${details.sequencingDefinition.forwardOnly ? 'true' : 'false'}</span>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    getActivityIcon(activity) {
        if (activity.type === 'sco') return '🎓';
        if (activity.type === 'asset') return '📄';
        if (activity.children && activity.children.length > 0) return '📁';
        return '📋';
    }

    getActivityStatusClass(status) {
        switch (status?.toLowerCase()) {
            case 'completed': return 'completed';
            case 'incomplete': return 'incomplete';
            case 'not attempted': return 'not-attempted';
            default: return 'not-attempted';
        }
    }

    bindActivityTreeEvents() {
        const headers = this.activityTreeElement.querySelectorAll('.activity-header');
        headers.forEach(header => {
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                const node = header.closest('.activity-node');
                const activityId = node.dataset.activityId;
                this.toggleActivityNode(activityId);
            });
        });
    }

    toggleActivityNode(activityId) {
        const node = this.activityTreeElement.querySelector(`[data-activity-id="${activityId}"]`);
        if (node) {
            node.classList.toggle('collapsed');
            this.setActivityNodeCollapsedState(activityId, node.classList.contains('collapsed'));
        }
    }

    getActivityNodeCollapsedState(activityId) {
        try {
            const key = `scorm-inspector-activity-${activityId}`;
            const value = localStorage.getItem(key);
            return value === 'true';
        } catch (error) {
            return false; // Default to expanded
        }
    }

    setActivityNodeCollapsedState(activityId, collapsed) {
        try {
            const key = `scorm-inspector-activity-${activityId}`;
            if (collapsed) {
                localStorage.setItem(key, 'true');
            } else {
                localStorage.removeItem(key);
            }
        } catch (error) {
            // Ignore localStorage errors for UI state
        }
    }

    expandAllActivities() {
        const nodes = this.activityTreeElement.querySelectorAll('.activity-node');
        nodes.forEach(node => {
            node.classList.remove('collapsed');
            const activityId = node.dataset.activityId;
            this.setActivityNodeCollapsedState(activityId, false);
        });
    }

    collapseAllActivities() {
        const nodes = this.activityTreeElement.querySelectorAll('.activity-node');
        nodes.forEach(node => {
            node.classList.add('collapsed');
            const activityId = node.dataset.activityId;
            this.setActivityNodeCollapsedState(activityId, true);
        });
    }

    // Navigation Analysis Methods
    refreshNavigation() {
        if (window.electronAPI?.getNavigationRequests) {
            window.electronAPI.getNavigationRequests().then(response => {
                if (response.success) {
                    this.navigationRequests = response.data || [];
                    this.renderNavigationAnalysis();
                }
            }).catch(error => {
                safeLogger.error('Failed to refresh navigation requests:', error);
            });
        }
    }
 
    renderNavigationAnalysis() {
        if (!this.navigationAnalysisElement) return;

        if (!this.navigationRequests || this.navigationRequests.length === 0) {
            this.navigationAnalysisElement.innerHTML = `
                <div class="no-data">No navigation data available. Load a SCORM package to view navigation analysis.</div>
            `;
            return;
        }

        const html = this.navigationRequests.map(request => this.renderNavigationRequest(request)).join('');
        this.navigationAnalysisElement.innerHTML = html;
        this.bindNavigationEvents();
    }

    renderNavigationRequest(request) {
        const isExpanded = this.getNavigationRequestExpandedState(request.id || request.type);
        
        return `
            <div class="nav-request ${isExpanded ? 'expanded' : ''}" data-nav-id="${request.id || request.type}">
                <div class="nav-request-header">
                    <span class="nav-request-name">Navigation Request: ${this.escapeHtml(request.type || 'Unknown')}</span>
                    <span class="nav-request-status ${request.disabled ? 'disabled' : 'enabled'}">
                        ${request.disabled ? 'Disabled' : 'Enabled'}
                    </span>
                </div>
                <div class="nav-request-details">
                    ${request.targetActivityId ? `
                        <div class="activity-detail-item">
                            <span class="activity-detail-label">Target Activity:</span>
                            <span class="activity-detail-value">${this.escapeHtml(request.targetActivityId)}</span>
                        </div>
                    ` : ''}
                    ${request.exception ? `
                        <div class="activity-detail-item">
                            <span class="activity-detail-label">Exception:</span>
                            <span class="activity-detail-value" style="color: var(--danger-color, #f14c4c);">${this.escapeHtml(request.exception)}</span>
                        </div>
                    ` : ''}
                    ${request.exceptionText ? `
                        <div class="activity-detail-item">
                            <span class="activity-detail-label">Exception Text:</span>
                            <span class="activity-detail-value">${this.escapeHtml(request.exceptionText)}</span>
                        </div>
                    ` : ''}
                    <div class="activity-detail-item">
                        <span class="activity-detail-label">Will Always Succeed:</span>
                        <span class="activity-detail-value">${request.willAlwaysSucceed ? 'true' : 'false'}</span>
                    </div>
                    <div class="activity-detail-item">
                        <span class="activity-detail-label">Will Never Succeed:</span>
                        <span class="activity-detail-value">${request.willNeverSucceed ? 'true' : 'false'}</span>
                    </div>
                    <div class="activity-detail-item">
                        <span class="activity-detail-label">Hidden:</span>
                        <span class="activity-detail-value">${request.hidden ? 'true' : 'false'}</span>
                    </div>
                </div>
            </div>
        `;
    }

    bindNavigationEvents() {
        const headers = this.navigationAnalysisElement.querySelectorAll('.nav-request-header');
        headers.forEach(header => {
            header.addEventListener('click', () => {
                const request = header.closest('.nav-request');
                const navId = request.dataset.navId;
                this.toggleNavigationRequest(navId);
            });
        });
    }

    toggleNavigationRequest(navId) {
        const request = this.navigationAnalysisElement.querySelector(`[data-nav-id="${navId}"]`);
        if (request) {
            request.classList.toggle('expanded');
            this.setNavigationRequestExpandedState(navId, request.classList.contains('expanded'));
        }
    }

    getNavigationRequestExpandedState(navId) {
        try {
            return localStorage.getItem(`scorm-inspector-nav-${navId}`) === 'true';
        } catch (error) {
            return false;
        }
    }

    setNavigationRequestExpandedState(navId, expanded) {
        try {
            const key = `scorm-inspector-nav-${navId}`;
            if (expanded) {
                localStorage.setItem(key, 'true');
            } else {
                localStorage.removeItem(key);
            }
        } catch (error) {
            // Ignore localStorage errors
        }
    }

    expandAllNavigation() {
        const requests = this.navigationAnalysisElement.querySelectorAll('.nav-request');
        requests.forEach(request => {
            request.classList.add('expanded');
            const navId = request.dataset.navId;
            this.setNavigationRequestExpandedState(navId, true);
        });
    }

    collapseAllNavigation() {
        const requests = this.navigationAnalysisElement.querySelectorAll('.nav-request');
        requests.forEach(request => {
            request.classList.remove('expanded');
            const navId = request.dataset.navId;
            this.setNavigationRequestExpandedState(navId, false);
        });
    }

    // Global Objectives Methods
    refreshObjectives() {
        if (window.electronAPI?.getGlobalObjectives) {
            window.electronAPI.getGlobalObjectives().then(response => {
                if (response.success) {
                    this.globalObjectives = response.data || [];
                    this.renderGlobalObjectives();
                }
            }).catch(error => {
                safeLogger.error('Failed to refresh global objectives:', error);
            });
        }
    }
 
    renderGlobalObjectives() {
        if (!this.globalObjectivesElement) return;

        if (!this.globalObjectives || this.globalObjectives.length === 0) {
            this.globalObjectivesElement.innerHTML = `
                <div class="no-data">No global objectives found.</div>
            `;
            return;
        }

        const html = this.globalObjectives.map(objective => `
            <div class="objective-item">
                <div class="objective-header">
                    <span class="objective-id">${this.escapeHtml(objective.id || 'Unknown')}</span>
                    <span class="objective-status ${this.getObjectiveStatusClass(objective.status)}">
                        ${objective.status || 'unknown'}
                    </span>
                </div>
                ${objective.score !== undefined ? `
                    <div class="activity-detail-item">
                        <span class="activity-detail-label">Score:</span>
                        <span class="activity-detail-value">${objective.score}</span>
                    </div>
                ` : ''}
                ${objective.progressMeasure !== undefined ? `
                    <div class="activity-detail-item">
                        <span class="activity-detail-label">Progress:</span>
                        <span class="activity-detail-value">${objective.progressMeasure}</span>
                    </div>
                ` : ''}
            </div>
        `).join('');

        this.globalObjectivesElement.innerHTML = html;
    }

    getObjectiveStatusClass(status) {
        switch (status?.toLowerCase()) {
            case 'satisfied': return 'completed';
            case 'not satisfied': return 'incomplete';
            default: return 'not-attempted';
        }
    }

    exportObjectives() {
        if (!this.globalObjectives || this.globalObjectives.length === 0) {
            alert('No global objectives to export.');
            return;
        }

        const exportData = {
            timestamp: new Date().toISOString(),
            objectives: this.globalObjectives,
            metadata: {
                totalObjectives: this.globalObjectives.length,
                exportedBy: 'SCORM Tester Inspector',
                version: '1.0'
            }
        };

        this.downloadJSON(exportData, 'scorm-global-objectives');
    }

    // SSP Buckets Methods
    refreshSSP() {
        if (window.electronAPI?.getSSPBuckets) {
            window.electronAPI.getSSPBuckets().then(response => {
                if (response.success) {
                    this.sspBuckets = response.data || [];
                    this.renderSSPBuckets();
                }
            }).catch(error => {
                safeLogger.error('Failed to refresh SSP buckets:', error);
            });
        }
    }
 
    renderSSPBuckets() {
        if (!this.sspBucketsElement) return;

        if (!this.sspBuckets || this.sspBuckets.length === 0) {
            this.sspBucketsElement.innerHTML = `
                <div class="no-data">No SSP buckets found.</div>
            `;
            return;
        }

        const html = this.sspBuckets.map(bucket => `
            <div class="ssp-item">
                <div class="ssp-header">
                    <span class="ssp-id">${this.escapeHtml(bucket.id || 'Unknown')}</span>
                </div>
                <div class="activity-detail-item">
                    <span class="activity-detail-label">Size:</span>
                    <span class="activity-detail-value">${bucket.size || 0} bytes</span>
                </div>
                <div class="activity-detail-item">
                    <span class="activity-detail-label">Persistence:</span>
                    <span class="activity-detail-value">${bucket.persistence || 'unknown'}</span>
                </div>
                ${bucket.data ? `
                    <div class="activity-detail-item">
                        <span class="activity-detail-label">Preview:</span>
                        <span class="activity-detail-value">${this.escapeHtml(String(bucket.data).substring(0, 50))}${String(bucket.data).length > 50 ? '...' : ''}</span>
                    </div>
                ` : ''}
            </div>
        `).join('');

        this.sspBucketsElement.innerHTML = html;
    }

    exportSSP() {
        if (!this.sspBuckets || this.sspBuckets.length === 0) {
            alert('No SSP buckets to export.');
            return;
        }

        const exportData = {
            timestamp: new Date().toISOString(),
            sspBuckets: this.sspBuckets,
            metadata: {
                totalBuckets: this.sspBuckets.length,
                exportedBy: 'SCORM Tester Inspector',
                version: '1.0'
            }
        };

        this.downloadJSON(exportData, 'scorm-ssp-buckets');
    }

    // Enhanced Log Methods
    addEnhancedLogEntry(entry) {
        if (!entry || this.isDestroyed) return;

        // Add to enhanced log (maintain maximum size) - optimize memory usage
        this.enhancedLogEntries.push(entry);
        if (this.enhancedLogEntries.length > 5000) {
            // Use shift() for better memory management than splice
            const removeCount = this.enhancedLogEntries.length - 5000;
            for (let i = 0; i < removeCount; i++) {
                this.enhancedLogEntries.shift();
            }
        }

        // Throttle rendering to prevent UI thrashing with better control
        if (this.logRenderTimeout) {
            clearTimeout(this.logRenderTimeout);
        }

        this.logRenderTimeout = setTimeout(() => {
            if (!this.isDestroyed) {
                this.renderEnhancedLog();
            }
            this.logRenderTimeout = null;
        }, 100);
    }

    renderEnhancedLog() {
        if (!this.enhancedLogElement || this.isDestroyed || this.isRenderingLog) return;

        this.isRenderingLog = true;

        try {
            // Clear the render timeout since we're rendering now
            if (this.logRenderTimeout) {
                clearTimeout(this.logRenderTimeout);
                this.logRenderTimeout = null;
            }

            // Use requestAnimationFrame for smooth rendering
            requestAnimationFrame(() => {
                try {
                    const filteredEntries = this.getFilteredLogEntries();

                    if (filteredEntries.length === 0) {
                        this.enhancedLogElement.innerHTML = `
                            <div class="no-data">No log entries available. Load a SCORM package to view detailed logs.</div>
                        `;
                        return;
                    }

                    // Reverse for display (newest first) and limit to prevent DOM overload
                    const maxEntries = 1000;
                    const displayEntries = [...filteredEntries].reverse().slice(0, maxEntries);
                    const html = displayEntries.map(entry => this.renderLogEntry(entry)).join('');

                    this.enhancedLogElement.innerHTML = html;

                    if (filteredEntries.length > maxEntries) {
                        const notice = document.createElement('div');
                        notice.className = 'data-filter-stats';
                        notice.textContent = `Showing ${maxEntries} of ${filteredEntries.length} log entries`;
                        this.enhancedLogElement.insertBefore(notice, this.enhancedLogElement.firstChild);
                    }

                    this.bindLogEvents();
                } finally {
                    this.isRenderingLog = false;
                }
            });
        } catch (error) {
            safeLogger.error('Error rendering enhanced log:', error);
            this.isRenderingLog = false;
        }
    }

    renderLogEntry(entry) {
        const isExpanded = this.getLogEntryExpandedState(entry.id);
        const timestamp = new Date(entry.timestamp).toLocaleTimeString();
        
        return `
            <div class="log-entry ${isExpanded ? 'expanded' : ''}" data-log-id="${entry.id}">
                <div class="log-entry-header">
                    <div class="log-entry-info">
                        <span class="log-entry-timestamp">[${timestamp}]</span>
                        <span class="log-entry-category ${entry.category?.toLowerCase()}">${entry.category || 'General'}</span>
                        <span class="log-entry-message">${this.escapeHtml(entry.message || '')}</span>
                    </div>
                    ${entry.duration ? `<span class="log-entry-duration">${entry.duration}ms</span>` : ''}
                </div>
                ${entry.details ? `
                    <div class="log-entry-details">
                        <pre>${this.escapeHtml(safeJsonStringify(entry.details, null, 2))}</pre>
                    </div>
                ` : ''}
            </div>
        `;
    }

    getFilteredLogEntries() {
        if (!this.enhancedLogEntries) return [];

        return this.enhancedLogEntries.filter(entry => {
            const category = entry.category?.toLowerCase();
            
            if (category === 'control' && !this.logControlFilter?.checked) return false;
            if (category === 'runtime' && !this.logRuntimeFilter?.checked) return false;
            if (category === 'sequencing' && !this.logSequencingFilter?.checked) return false;
            if (category === 'pcode' && !this.logPcodeFilter?.checked) return false;
            
            return true;
        });
    }

    filterEnhancedLog() {
        this.renderEnhancedLog();
    }

    bindLogEvents() {
        const headers = this.enhancedLogElement.querySelectorAll('.log-entry-header');
        headers.forEach(header => {
            header.addEventListener('click', () => {
                const entry = header.closest('.log-entry');
                const logId = entry.dataset.logId;
                this.toggleLogEntry(logId);
            });
        });
    }

    toggleLogEntry(logId) {
        const entry = this.enhancedLogElement.querySelector(`[data-log-id="${logId}"]`);
        if (entry) {
            entry.classList.toggle('expanded');
            this.setLogEntryExpandedState(logId, entry.classList.contains('expanded'));
        }
    }

    getLogEntryExpandedState(logId) {
        try {
            return localStorage.getItem(`scorm-inspector-log-${logId}`) === 'true';
        } catch (error) {
            return false;
        }
    }

    setLogEntryExpandedState(logId, expanded) {
        try {
            const key = `scorm-inspector-log-${logId}`;
            if (expanded) {
                localStorage.setItem(key, 'true');
            } else {
                localStorage.removeItem(key);
            }
        } catch (error) {
            // Ignore localStorage errors
        }
    }

    expandAllLog() {
        const entries = this.enhancedLogElement.querySelectorAll('.log-entry');
        entries.forEach(entry => {
            entry.classList.add('expanded');
            const logId = entry.dataset.logId;
            this.setLogEntryExpandedState(logId, true);
        });
    }

    clearEnhancedLog() {
        this.enhancedLogEntries = [];
        this.renderEnhancedLog();
        // Removed: console.log('SCORM Inspector: Enhanced log cleared');
    }
 
    exportEnhancedLog() {
        if (!this.enhancedLogEntries || this.enhancedLogEntries.length === 0) {
            alert('No log entries to export.');
            return;
        }

        const exportData = {
            timestamp: new Date().toISOString(),
            logEntries: this.enhancedLogEntries,
            filters: {
                control: this.logControlFilter?.checked,
                runtime: this.logRuntimeFilter?.checked,
                sequencing: this.logSequencingFilter?.checked,
                pcode: this.logPcodeFilter?.checked
            },
            metadata: {
                totalEntries: this.enhancedLogEntries.length,
                exportedBy: 'SCORM Tester Inspector',
                version: '1.0'
            }
        };

        this.downloadJSON(exportData, 'scorm-enhanced-log');
    }

    // Utility method for downloading JSON
    downloadJSON(data, filenamePrefix) {
        try {
            const dataStr = safeJsonStringify(data, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            
            // Check if URL.createObjectURL is available (may fail in some contexts)
            if (typeof URL === 'undefined' || !URL.createObjectURL) {
                throw new Error('URL.createObjectURL not available');
            }
            
            const url = URL.createObjectURL(dataBlob);
            
            // Ensure document.body exists
            if (!document.body) {
                throw new Error('document.body not available');
            }
            
            const link = document.createElement('a');
            link.href = url;
            
            // Sanitize filename to remove invalid characters
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
            const sanitizedPrefix = filenamePrefix.replace(/[^a-zA-Z0-9-_]/g, '-');
            link.download = `${sanitizedPrefix}-${timestamp}.json`;
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            safeLogger.error('Failed to download JSON:', error);
            
            // Fallback: try to copy to clipboard or show alert
            try {
                const dataStr = safeJsonStringify(data, null, 2);
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(dataStr).then(() => {
                        alert('Download failed, but data has been copied to clipboard.');
                    }).catch(() => {
                        alert('Download failed. Export data will be truncated in logs.');
                        try { rendererLogger.info('Export data (truncated):', dataStr.slice(0, 2048)); } catch (_) {}
                    });
                } else {
                    alert('Download failed. Export data will be truncated in logs.');
                    try { rendererLogger.info('Export data (truncated):', dataStr.slice(0, 2048)); } catch (_) {}
                }
            } catch (fallbackError) {
                safeLogger.error('Fallback export also failed:', fallbackError);
                alert('Export failed completely. Please check the console for errors.');
            }
        }
    }

    setupCleanupHandlers() {
        // Handle page unload/reload with proper cleanup
        const beforeUnloadHandler = () => {
            this.destroy();
        };

        const unloadHandler = () => {
            this.destroy();
        };

        // Use addEventListenerSafe to ensure proper tracking
        this.addEventListenerSafe(window, 'beforeunload', beforeUnloadHandler);
        this.addEventListenerSafe(window, 'unload', unloadHandler);

        // Also handle visibility change to pause/resume operations
        const visibilityChangeHandler = () => {
            if (document.hidden) {
                // Pause any expensive operations when tab is hidden
                this.pauseOperations();
            } else {
                // Resume operations when tab becomes visible
                this.resumeOperations();
            }
        };

        this.addEventListenerSafe(document, 'visibilitychange', visibilityChangeHandler);
    }

    pauseOperations() {
        // Clear any pending timeouts to save resources
        if (this.dataModelUpdateTimeout) {
            clearTimeout(this.dataModelUpdateTimeout);
            this.dataModelUpdateTimeout = null;
        }

        if (this.logRenderTimeout) {
            clearTimeout(this.logRenderTimeout);
            this.logRenderTimeout = null;
        }
    }

    resumeOperations() {
        // Resume operations if needed when tab becomes visible again
        if (this.pendingDataModel && !this.isUpdatingDataModel) {
            setTimeout(() => {
                this.updateDataModel(this.pendingDataModel);
            }, 100);
        }
    }

    destroy() {
        if (this.isDestroyed) return;

        try {
            // Clear all timeouts and intervals
            if (this.dataModelUpdateTimeout) {
                clearTimeout(this.dataModelUpdateTimeout);
                this.dataModelUpdateTimeout = null;
            }

            if (this.logRenderTimeout) {
                clearTimeout(this.logRenderTimeout);
                this.logRenderTimeout = null;
            }

            // Clear any pending animation frames
            if (this.animationFrame) {
                cancelAnimationFrame(this.animationFrame);
                this.animationFrame = null;
            }

            // Remove all event listeners including IPC listeners
            this.removeAllEventListeners();

            // Clear data structures and prevent memory leaks
            this.clearDataStructures();

            // Clean up DOM references
            this.clearDomReferences();

            // Clean up localStorage entries to prevent accumulation
            this.cleanupLocalStorage();

            // Mark as destroyed
            this.isDestroyed = true;

        } catch (error) {
            safeLogger.error('Error during ScormInspectorWindow destruction:', error);
        }
    }

    removeAllEventListeners() {
        // Remove tracked event listeners
        if (this.eventListeners) {
            this.eventListeners.forEach(({ element, type, handler }) => {
                try {
                    element.removeEventListener(type, handler);
                } catch (error) {
                    safeLogger.warn('Failed to remove event listener:', error);
                }
            });
            this.eventListeners = [];
        }

        // Remove IPC listeners if electronAPI is available
        if (window.electronAPI) {
            try {
                // Remove all IPC listeners to prevent memory leaks
                if (typeof window.electronAPI.removeAllListeners === 'function') {
                    window.electronAPI.removeAllListeners();
                }
            } catch (error) {
                safeLogger.warn('Failed to remove IPC listeners:', error);
            }
        }
    }

    clearDataStructures() {
        // Clear arrays and maps
        if (this.apiHistory) {
            this.apiHistory.length = 0;
            this.apiHistory = null;
        }

        if (this.scormErrors) {
            this.scormErrors.length = 0;
            this.scormErrors = null;
        }

        if (this.enhancedLogEntries) {
            this.enhancedLogEntries.length = 0;
            this.enhancedLogEntries = null;
        }

        if (this.navigationRequests) {
            this.navigationRequests.length = 0;
            this.navigationRequests = null;
        }

        if (this.globalObjectives) {
            this.globalObjectives.length = 0;
            this.globalObjectives = null;
        }

        if (this.sspBuckets) {
            this.sspBuckets.length = 0;
            this.sspBuckets = null;
        }

        // Clear objects and maps
        this.dataModel = null;
        this.activityTree = null;
        this.pendingDataModel = null;

        if (this.dataModelHistory) {
            this.dataModelHistory.clear();
            this.dataModelHistory = null;
        }
    }

    clearDomReferences() {
        // Clear DOM element references to prevent memory leaks
        this.apiTimelineElement = null;
        this.errorListElement = null;
        this.dataModelElement = null;
        this.clearHistoryBtn = null;
        this.refreshBtn = null;
        this.dataFilterInput = null;
        this.clearFilterBtn = null;
        this.expandAllDataBtn = null;
        this.collapseAllDataBtn = null;
        this.exportDataBtn = null;
        this.activityTreeElement = null;
        this.navigationAnalysisElement = null;
        this.globalObjectivesElement = null;
        this.sspBucketsElement = null;
        this.enhancedLogElement = null;

        // Clear enhanced inspector control references
        this.refreshActivityTreeBtn = null;
        this.expandAllActivitiesBtn = null;
        this.collapseAllActivitiesBtn = null;
        this.refreshNavigationBtn = null;
        this.expandAllNavBtn = null;
        this.collapseAllNavBtn = null;
        this.refreshObjectivesBtn = null;
        this.exportObjectivesBtn = null;
        this.refreshSspBtn = null;
        this.exportSspBtn = null;
        this.clearEnhancedLogBtn = null;
        this.exportEnhancedLogBtn = null;
        this.expandAllLogBtn = null;

        // Clear log filter references
        this.logControlFilter = null;
        this.logRuntimeFilter = null;
        this.logSequencingFilter = null;
        this.logPcodeFilter = null;
    }

    cleanupLocalStorage() {
        try {
            // Clean up category states
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.startsWith('scorm-inspector-category-') ||
                           key.startsWith('scorm-inspector-activity-') ||
                           key.startsWith('scorm-inspector-nav-') ||
                           key.startsWith('scorm-inspector-log-'))) {
                    keysToRemove.push(key);
                }
            }

            // Only keep the most recent 100 entries to prevent localStorage bloat
            if (keysToRemove.length > 100) {
                const toDelete = keysToRemove.slice(0, keysToRemove.length - 100);
                toDelete.forEach(key => {
                    try {
                        localStorage.removeItem(key);
                    } catch (error) {
                        // Ignore individual removal errors
                    }
                });
            }
        } catch (error) {
            safeLogger.warn('Failed to cleanup localStorage:', error);
        }
    }

    // Performance memory cleanup method
    performMemoryCleanup() {
        try {
            // Limit array sizes to prevent memory bloat
            if (this.apiHistory && this.apiHistory.length > 1000) {
                this.apiHistory.splice(0, this.apiHistory.length - 1000);
            }

            if (this.scormErrors && this.scormErrors.length > 250) {
                this.scormErrors.splice(0, this.scormErrors.length - 250);
            }

            if (this.enhancedLogEntries && this.enhancedLogEntries.length > 2500) {
                this.enhancedLogEntries.splice(0, this.enhancedLogEntries.length - 2500);
            }

            // Clear old data model history entries
            if (this.dataModelHistory && this.dataModelHistory.size > 100) {
                const entries = Array.from(this.dataModelHistory.entries());
                const toKeep = entries.slice(-50); // Keep only the 50 most recent entries
                this.dataModelHistory.clear();
                toKeep.forEach(([key, value]) => this.dataModelHistory.set(key, value));
            }

            // Clean up localStorage to prevent accumulation
            this.cleanupLocalStorage();

            // Force garbage collection if available
            if (window.gc && typeof window.gc === 'function') {
                window.gc();
            }

            safeLogger.log('Memory cleanup completed');
        } catch (error) {
            safeLogger.error('Error during memory cleanup:', error);
        }
    }

    // Method to safely add event listeners with automatic cleanup tracking
    addEventListenerSafe(element, type, handler) {
        if (this.isDestroyed || !element) return;

        try {
            // Create a wrapper handler that checks if component is destroyed
            const safeHandler = (...args) => {
                if (this.isDestroyed) return;
                return handler(...args);
            };

            element.addEventListener(type, safeHandler);
            this.eventListeners.push({ element, type, handler: safeHandler });
        } catch (error) {
            safeLogger.error(`Failed to add ${type} event listener:`, error);
        }
    }
}

// Initialize when DOM is loaded with memory leak prevention
document.addEventListener('DOMContentLoaded', () => {
    // Clean up any existing instance to prevent memory leaks
    if (window.scormInspector && typeof window.scormInspector.destroy === 'function') {
        window.scormInspector.destroy();
    }

    // Clear any existing references
    window.scormInspector = null;

    // Create new instance
    window.scormInspector = new ScormInspectorWindow();

    // Set up memory monitoring
    if (typeof window.performance !== 'undefined' && window.performance.memory) {
        const checkMemory = () => {
            const memory = window.performance.memory;
            if (memory.usedJSHeapSize > memory.jsHeapSizeLimit * 0.9) {
                safeLogger.warn('High memory usage detected, cleaning up...');
                if (window.scormInspector && typeof window.scormInspector.performMemoryCleanup === 'function') {
                    window.scormInspector.performMemoryCleanup();
                }
            }
        };

        // Check memory every 30 seconds
        setInterval(checkMemory, 30000);
    }
});