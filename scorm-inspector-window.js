"use strict";

// SCORM Inspector Window JavaScript
// Handles the display and management of SCORM package inspection data

import rendererLogger from '../../src/renderer/utils/renderer-logger.js';

class ScormInspectorWindow {
    constructor() {
        // Removed: console.log('SCORM Inspector: Initializing window...');
        
        this.apiHistory = [];
        this.scormErrors = [];
        this.dataModel = {};
        this.dataModelHistory = new Map();
        this.isLoading = false;
        this.filterText = '';

        // Debouncing for data model updates to prevent race conditions
        this.dataModelUpdateTimeout = null;
        this.lastDataModelUpdate = 0;
        this.isUpdatingDataModel = false;
        
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
    }

    setupEventListeners() {
        // Button event listeners
        this.clearHistoryBtn?.addEventListener('click', () => this.clearHistory());
        this.refreshBtn?.addEventListener('click', () => this.refreshData());

        // Data Model event listeners
        this.dataFilterInput?.addEventListener('input', (e) => this.filterDataModel(e.target.value));
        this.clearFilterBtn?.addEventListener('click', () => this.clearFilter());
        this.expandAllDataBtn?.addEventListener('click', () => this.expandAllCategories());
        this.collapseAllDataBtn?.addEventListener('click', () => this.collapseAllCategories());
        this.exportDataBtn?.addEventListener('click', () => this.exportDataModel());

        // Enhanced Inspector event listeners
        this.refreshActivityTreeBtn?.addEventListener('click', () => this.refreshActivityTree());
        this.expandAllActivitiesBtn?.addEventListener('click', () => this.expandAllActivities());
        this.collapseAllActivitiesBtn?.addEventListener('click', () => this.collapseAllActivities());
        this.refreshNavigationBtn?.addEventListener('click', () => this.refreshNavigation());
        this.expandAllNavBtn?.addEventListener('click', () => this.expandAllNavigation());
        this.collapseAllNavBtn?.addEventListener('click', () => this.collapseAllNavigation());
        this.refreshObjectivesBtn?.addEventListener('click', () => this.refreshObjectives());
        this.exportObjectivesBtn?.addEventListener('click', () => this.exportObjectives());
        this.refreshSspBtn?.addEventListener('click', () => this.refreshSSP());
        this.exportSspBtn?.addEventListener('click', () => this.exportSSP());
        this.clearEnhancedLogBtn?.addEventListener('click', () => this.clearEnhancedLog());
        this.exportEnhancedLogBtn?.addEventListener('click', () => this.exportEnhancedLog());
        this.expandAllLogBtn?.addEventListener('click', () => this.expandAllLog());

        // Log filter event listeners
        this.logControlFilter?.addEventListener('change', () => this.filterEnhancedLog());
        this.logRuntimeFilter?.addEventListener('change', () => this.filterEnhancedLog());
        this.logSequencingFilter?.addEventListener('change', () => this.filterEnhancedLog());
        this.logPcodeFilter?.addEventListener('change', () => this.filterEnhancedLog());

        // Set up IPC event listeners after electronAPI is available
        this.setupIpcEventListeners();
        
        // Set up course and session event listeners
        this.setupCourseEventListeners();
    }

    async setupIpcEventListeners() {
        try {
            // Wait for electronAPI to be available
            await this.waitForElectronAPI();

            // Listen for real-time updates from main process
            if (window.electronAPI.onScormInspectorDataUpdated) {
                window.electronAPI.onScormInspectorDataUpdated((data) => {
                    // Removed: console.log('SCORM Inspector: Received API call update', data);
                    this.addApiCall(data);
 
                    // Note: Data model updates are handled by onScormDataModelUpdated listener
                    // to avoid race conditions. We don't need to refresh here.
                });
                // Removed: console.log('SCORM Inspector: Data update listener registered');
            }
 
            // Listen for SCORM Inspector error updates
            if (window.electronAPI.onScormInspectorErrorUpdated) {
                window.electronAPI.onScormInspectorErrorUpdated((errorData) => {
                    // Removed: console.log('SCORM Inspector: Received error update', errorData);
                    this.addError(errorData);
                });
                // Removed: console.log('SCORM Inspector: Error update listener registered');
            }
 
            // Listen for SCORM Data Model updates
            if (window.electronAPI.onScormDataModelUpdated) {
                window.electronAPI.onScormDataModelUpdated((dataModel) => {
                    // Removed: console.log('SCORM Inspector: Received data model update', dataModel);
                    this.updateDataModel(dataModel);
                });
                // Removed: console.log('SCORM Inspector: Data model update listener registered');
            }
        } catch (error) {
            rendererLogger.error('SCORM Inspector: Failed to setup IPC event listeners:', error);
        }
    }

    async setupCourseEventListeners() {
        try {
            // Wait for electronAPI to be available
            await this.waitForElectronAPI();

            // Listen for course loaded events
            if (window.electronAPI.onCourseLoaded) {
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
            }
 
            // Listen for session state changes
            if (window.electronAPI.onSessionStateChanged) {
                window.electronAPI.onSessionStateChanged(() => {
                    // Removed: console.log('SCORM Inspector: Session state changed, refreshing data');
                    // Refresh inspector data when session state changes
                    setTimeout(() => {
                        this.refreshData();
                    }, 100);
                });
                // Removed: console.log('SCORM Inspector: Session state change listener registered');
            }
        } catch (error) {
            rendererLogger.error('SCORM Inspector: Failed to setup course event listeners:', error);
        }
    }

    async loadInitialHistory() {
        try {
            this.setLoading(true);
            
            // Wait for electronAPI to be available
            await this.waitForElectronAPI();
            
            if (!window.electronAPI?.getScormInspectorHistory) {
                rendererLogger.error('SCORM Inspector: getScormInspectorHistory method not available');
                return;
            }
 
            // Request history from SCORM Inspector telemetry store
            // Removed: console.log('SCORM Inspector: Calling getScormInspectorHistory...');
            let response;
            try {
                response = await window.electronAPI.getScormInspectorHistory();
                // Removed: console.log('SCORM Inspector: getScormInspectorHistory response:', JSON.stringify(response, null, 2));
            } catch (error) {
                rendererLogger.error('SCORM Inspector: getScormInspectorHistory failed:', error);
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
            rendererLogger.error('SCORM Inspector: Error loading initial history', error);
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
        
        // Removed: console.log('SCORM Inspector: electronAPI is now available');
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
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ==================== DATA MODEL FUNCTIONALITY ====================

    updateDataModel(newDataModel) {
        if (!newDataModel) return;

        // Prevent race conditions by debouncing rapid updates
        const now = Date.now();
        if (this.isUpdatingDataModel || (now - this.lastDataModelUpdate) < 50) {
            // Clear any pending update and schedule a new one
            if (this.dataModelUpdateTimeout) {
                clearTimeout(this.dataModelUpdateTimeout);
            }
            this.dataModelUpdateTimeout = setTimeout(() => {
                this.updateDataModel(newDataModel);
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
            rendererLogger.warn('SCORM Inspector: Ignoring empty data model update to prevent overwriting existing data');
            this.isUpdatingDataModel = false;
            return;
        }
 
        // Track changes for highlighting (simplified for structured data)
        const changedKeys = new Set();

        // For structured data, we'll do a simple deep comparison
        const oldDataStr = JSON.stringify(this.dataModel);
        const newDataStr = JSON.stringify(newDataModel);

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
    }

    renderDataModel(changedKeys = new Set()) {
        if (!this.dataModelElement) return;

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
                        for (const [key, value] of Object.entries(interaction)) {
                            const fullKey = `interactions[${index}].${key}`;
                            categories['Interactions'].items[fullKey] = value;
                        }
                    }
                });
            }

            // Process objectives array
            if (this.dataModel.objectives && Array.isArray(this.dataModel.objectives)) {
                this.dataModel.objectives.forEach((objective, index) => {
                    if (objective && typeof objective === 'object') {
                        for (const [key, value] of Object.entries(objective)) {
                            const fullKey = `objectives[${index}].${key}`;
                            categories['Objectives'].items[fullKey] = value;
                        }
                    }
                });
            }

            // Process comments from learner
            if (this.dataModel.commentsFromLearner && Array.isArray(this.dataModel.commentsFromLearner)) {
                this.dataModel.commentsFromLearner.forEach((comment, index) => {
                    if (comment && typeof comment === 'object') {
                        for (const [key, value] of Object.entries(comment)) {
                            const fullKey = `commentsFromLearner[${index}].${key}`;
                            categories['Comments'].items[fullKey] = value;
                        }
                    }
                });
            }

            // Process comments from LMS
            if (this.dataModel.commentsFromLms && Array.isArray(this.dataModel.commentsFromLms)) {
                this.dataModel.commentsFromLms.forEach((comment, index) => {
                    if (comment && typeof comment === 'object') {
                        for (const [key, value] of Object.entries(comment)) {
                            const fullKey = `commentsFromLms[${index}].${key}`;
                            categories['Comments'].items[fullKey] = value;
                        }
                    }
                });
            }
        } else {
            // Fallback: handle flat data model format (backward compatibility)
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
        if (valueType === 'object-value') return this.escapeHtml(JSON.stringify(value));
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
        return localStorage.getItem(`scorm-inspector-category-${categoryName}`) === 'true';
    }

    setCategoryCollapsedState(categoryName, collapsed) {
        localStorage.setItem(`scorm-inspector-category-${categoryName}`, collapsed.toString());
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

        const dataStr = JSON.stringify(exportData, null, 2);
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
                rendererLogger.error('Failed to refresh activity tree:', error);
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
        return localStorage.getItem(`scorm-inspector-activity-${activityId}`) === 'true';
    }

    setActivityNodeCollapsedState(activityId, collapsed) {
        localStorage.setItem(`scorm-inspector-activity-${activityId}`, collapsed.toString());
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
                rendererLogger.error('Failed to refresh navigation requests:', error);
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
        return localStorage.getItem(`scorm-inspector-nav-${navId}`) === 'true';
    }

    setNavigationRequestExpandedState(navId, expanded) {
        localStorage.setItem(`scorm-inspector-nav-${navId}`, expanded.toString());
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
                rendererLogger.error('Failed to refresh global objectives:', error);
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
                rendererLogger.error('Failed to refresh SSP buckets:', error);
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
        if (!entry) return;

        // Add to enhanced log (maintain maximum size)
        this.enhancedLogEntries.unshift(entry);
        if (this.enhancedLogEntries.length > 5000) {
            this.enhancedLogEntries = this.enhancedLogEntries.slice(0, 5000);
        }

        this.renderEnhancedLog();
    }

    renderEnhancedLog() {
        if (!this.enhancedLogElement) return;

        const filteredEntries = this.getFilteredLogEntries();

        if (filteredEntries.length === 0) {
            this.enhancedLogElement.innerHTML = `
                <div class="no-data">No log entries available. Load a SCORM package to view detailed logs.</div>
            `;
            return;
        }

        const html = filteredEntries.map(entry => this.renderLogEntry(entry)).join('');
        this.enhancedLogElement.innerHTML = html;
        this.bindLogEvents();
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
                        <pre>${this.escapeHtml(JSON.stringify(entry.details, null, 2))}</pre>
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
        return localStorage.getItem(`scorm-inspector-log-${logId}`) === 'true';
    }

    setLogEntryExpandedState(logId, expanded) {
        localStorage.setItem(`scorm-inspector-log-${logId}`, expanded.toString());
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
        const dataStr = JSON.stringify(data, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.scormInspector = new ScormInspectorWindow();
});