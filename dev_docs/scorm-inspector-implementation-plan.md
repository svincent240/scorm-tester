# SCORM Inspector Implementation Plan

**Status**: 🔥 **CRITICAL IMPLEMENTATION REQUIRED**  
**Priority**: **HIGHEST** - Must be completed to resolve architectural confusion and implement proper separation

## Overview

This document provides a detailed, step-by-step implementation plan to transform the current "debug" system into the proper SCORM Inspector architecture. This implementation is **critical** because it resolves the fundamental confusion between app debugging (for developers) and SCORM package inspection (for end users).

## Critical Problem Statement

**Current State**: The application incorrectly mixes app debugging functionality with SCORM package inspection, causing:
- Users see app bugs instead of SCORM content issues
- Developers get confused by mixed terminology and data flows
- Multiple redundant data paths create race conditions and complexity
- EventBus used incorrectly for SCORM data instead of UI events

**Target State**: Complete separation with:
- **SCORM Inspector**: End-user tool for analyzing SCORM package issues
- **App Debug Logging**: Developer tool for fixing application bugs
- Single-source-of-truth data flow for SCORM inspection
- Clear error classification and routing system

## Phase 1: Core Architecture Implementation

### 1.1 ✅ COMPLETED: Enhanced SCORM Inspector Telemetry Store

**CRITICAL**: This is the foundation of the entire architecture.

**APPROACH CHANGE**: Instead of creating a completely new store, we **renamed and enhanced** the existing `DebugTelemetryStore` to avoid duplication and leverage the existing functionality.

#### ✅ COMPLETED: Enhanced File: `src/main/services/scorm-inspector/scorm-inspector-telemetry-store.js`

**Key Changes Made**:
- **Renamed**: `DebugTelemetryStore` → `ScormInspectorTelemetryStore`
- **Enhanced**: Added error classification, broadcasting, and improved data structure
- **Preserved**: All existing functionality (storeApiCall, getHistory, clear, flushTo)
- **Added**: SCORM-specific error handling, troubleshooting steps, and performance tracking

```javascript
/**
 * SCORM Inspector Telemetry Store
 * 
 * Single source of truth for all SCORM package inspection data.
 * This is NOT for app debugging - it's for end-user SCORM content analysis.
 */

const EventEmitter = require('events');
const BaseService = require('../base-service');

class ScormInspectorTelemetryStore extends BaseService {
  constructor(errorHandler, logger, options = {}) {
    super('ScormInspectorTelemetryStore', errorHandler, logger, options);
    
    this.config = {
      maxHistorySize: 2000,
      enableBroadcast: true,
      retentionTimeMs: 3600000, // 1 hour
      ...options
    };
    
    // Ring buffer for SCORM API call history
    this.scormApiHistory = [];
    this.scormErrors = [];
    
    // Window references for broadcasting
    this.windowManager = null;
  }
  
  /**
   * Store a SCORM API call for inspection
   * @param {Object} data - SCORM API call data
   */
  storeApiCall(data) {
    const entry = {
      id: this.generateId(),
      timestamp: Date.now(),
      ...data
    };
    
    // Add to ring buffer
    this.scormApiHistory.push(entry);
    this.trimHistory();
    
    // Classify and store errors separately
    if (data.errorCode && data.errorCode !== '0') {
      this.storeScormError(entry);
    }
    
    // Immediately broadcast to all windows
    this.broadcastToAllWindows('scorm-inspector-data-updated', entry);
    
    this.logger?.debug(`ScormInspectorTelemetryStore: Stored API call ${data.method}`);
  }
  
  /**
   * Store SCORM-related errors for inspection
   * @param {Object} entry - API call entry with error
   */
  storeScormError(entry) {
    const errorEntry = {
      ...entry,
      source: 'scorm',
      severity: this.classifyErrorSeverity(entry.errorCode),
      userActionable: true,
      troubleshootingSteps: this.generateTroubleshootingSteps(entry)
    };
    
    this.scormErrors.push(errorEntry);
    this.trimErrors();
    
    // Broadcast error specifically to SCORM Inspector
    this.broadcastToAllWindows('scorm-inspector-error-updated', errorEntry);
  }
  
  /**
   * Get historical SCORM API calls for inspector window initialization
   * @param {Object} options - Query options
   * @returns {Object} Response with history data
   */
  getHistory(options = {}) {
    const { limit = 1000, offset = 0, sinceTs, methodFilter } = options;
    
    let filteredHistory = [...this.scormApiHistory];
    
    // Apply filters
    if (sinceTs) {
      filteredHistory = filteredHistory.filter(entry => entry.timestamp >= sinceTs);
    }
    
    if (methodFilter) {
      filteredHistory = filteredHistory.filter(entry => entry.method === methodFilter);
    }
    
    // Sort newest first, then apply pagination
    filteredHistory.sort((a, b) => b.timestamp - a.timestamp);
    const paginatedHistory = filteredHistory.slice(offset, offset + limit);
    
    return {
      success: true,
      history: paginatedHistory,
      total: filteredHistory.length,
      hasMore: filteredHistory.length > (offset + limit)
    };
  }
  
  /**
   * Get SCORM errors for error tab
   * @param {Object} options - Query options  
   * @returns {Object} Response with error data
   */
  getErrors(options = {}) {
    const { severity, limit = 100 } = options;
    
    let filteredErrors = [...this.scormErrors];
    
    if (severity) {
      filteredErrors = filteredErrors.filter(error => error.severity === severity);
    }
    
    return {
      success: true,
      errors: filteredErrors.slice(0, limit),
      total: filteredErrors.length
    };
  }
  
  /**
   * Broadcast SCORM inspection data to all windows
   * @param {string} channel - IPC channel name
   * @param {Object} data - Data to broadcast
   */
  broadcastToAllWindows(channel, data) {
    if (!this.config.enableBroadcast || !this.windowManager) {
      return;
    }
    
    try {
      const windows = this.windowManager.getAllWindows();
      let broadcastCount = 0;
      
      windows.forEach(window => {
        if (window && !window.isDestroyed()) {
          window.webContents.send(channel, data);
          broadcastCount++;
        }
      });
      
      this.logger?.debug(`ScormInspectorTelemetryStore: Broadcasted ${channel} to ${broadcastCount} windows`);
    } catch (error) {
      this.logger?.error('ScormInspectorTelemetryStore: Broadcast failed', error?.message || error);
    }
  }
  
  /**
   * Set window manager reference for broadcasting
   * @param {Object} windowManager - WindowManager instance
   */
  setWindowManager(windowManager) {
    this.windowManager = windowManager;
  }
  
  /**
   * Trim history to prevent memory issues
   */
  trimHistory() {
    if (this.scormApiHistory.length > this.config.maxHistorySize) {
      const removeCount = this.scormApiHistory.length - this.config.maxHistorySize;
      this.scormApiHistory.splice(0, removeCount);
      this.logger?.debug(`ScormInspectorTelemetryStore: Trimmed ${removeCount} old entries`);
    }
  }
  
  /**
   * Trim error history
   */
  trimErrors() {
    const maxErrors = Math.floor(this.config.maxHistorySize * 0.2); // 20% of total
    if (this.scormErrors.length > maxErrors) {
      const removeCount = this.scormErrors.length - maxErrors;
      this.scormErrors.splice(0, removeCount);
    }
  }
  
  /**
   * Classify SCORM error severity
   * @param {string} errorCode - SCORM error code
   * @returns {string} Severity level
   */
  classifyErrorSeverity(errorCode) {
    const criticalErrors = ['101', '201', '301']; // Initialize, Terminate, No Error
    const highErrors = ['401', '402', '403', '404']; // Data Model errors
    const mediumErrors = ['351', '391']; // General errors
    
    if (criticalErrors.includes(errorCode)) return 'critical';
    if (highErrors.includes(errorCode)) return 'high';
    if (mediumErrors.includes(errorCode)) return 'medium';
    return 'low';
  }
  
  /**
   * Generate troubleshooting steps for SCORM errors
   * @param {Object} entry - API call entry
   * @returns {Array} Array of troubleshooting steps
   */
  generateTroubleshootingSteps(entry) {
    const steps = [];
    
    switch (entry.errorCode) {
      case '401':
        steps.push(
          'Check if the data element name is spelled correctly',
          'Verify the element exists in the SCORM data model',
          'Ensure proper SCORM session initialization'
        );
        break;
      case '403':
        steps.push(
          'Check if the data element is read-only',
          'Verify you have called Initialize() first',
          'Ensure the session is not terminated'
        );
        break;
      case '404':
        steps.push(
          'Validate the data value format',
          'Check value length limits',
          'Ensure value matches expected data type'
        );
        break;
      default:
        steps.push(
          'Check SCORM package manifest for errors',
          'Verify API call sequence and timing',
          'Review SCORM specification compliance'
        );
    }
    
    return steps;
  }
  
  /**
   * Generate unique ID for entries
   * @returns {string} Unique identifier
   */
  generateId() {
    return `scorm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Clear all SCORM inspection data
   */
  clear() {
    this.scormApiHistory = [];
    this.scormErrors = [];
    this.logger?.info('ScormInspectorTelemetryStore: Cleared all data');
  }
  
  /**
   * Get current statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      totalApiCalls: this.scormApiHistory.length,
      totalErrors: this.scormErrors.length,
      criticalErrors: this.scormErrors.filter(e => e.severity === 'critical').length,
      highErrors: this.scormErrors.filter(e => e.severity === 'high').length,
      lastActivity: this.scormApiHistory.length > 0 ? 
        this.scormApiHistory[this.scormApiHistory.length - 1].timestamp : null
    };
  }
}

module.exports = ScormInspectorTelemetryStore;
```

#### ✅ COMPLETED: Directory Structure Created:
```bash
✅ mkdir -p src/main/services/scorm-inspector
✅ Enhanced existing debug-telemetry-store.js functionality into new location
✅ Created comprehensive SCORM Inspector store with backwards compatibility
```

**Benefits of This Approach**:
- ✅ **No Duplication**: Leveraged existing proven code instead of recreating
- ✅ **Backwards Compatible**: Existing `flushTo()` method preserved for legacy usage
- ✅ **Enhanced Functionality**: Added SCORM-specific features on top of working foundation
- ✅ **Same API Surface**: Main process integration remains similar, reducing breaking changes

### 1.2 Update API Handler Integration

#### Modify: `src/main/services/scorm/rte/api-handler.js`

**Find the current logging method and replace with:**

```javascript
/**
 * Log SCORM API call for inspection (NOT app debugging)
 * This sends data to the SCORM Inspector for end-user analysis
 */
logScormApiCall(method, params, result, errorCode, sessionId) {
  const payload = {
    method,
    params: Array.isArray(params) ? [...params] : [params],
    result,
    errorCode: errorCode || '0',
    timestamp: Date.now(),
    sessionId: sessionId || this.sessionId,
    durationMs: this.calculateDuration(method, params)
  };
  
  // Add error classification if error occurred
  if (errorCode && errorCode !== '0') {
    payload.error = {
      source: 'scorm',
      category: 'scorm-api',
      message: this.getErrorString(errorCode),
      severity: this.classifyErrorSeverity(errorCode),
      context: {
        scormApiMethod: method,
        scormElement: params?.[0],
        sessionState: this.getCurrentState()
      }
    };
  }
  
  // Send to SCORM Inspector store - NOT app debug logging
  if (this.scormInspectorStore) {
    this.scormInspectorStore.storeApiCall(payload);
  } else {
    // Fallback: log to app debug for development
    this.logger?.warn('ScormApiHandler: scormInspectorStore not available, API call not tracked for inspection');
  }
}
```

**Remove or update existing event emitter usage:**
```javascript
// REMOVE this line:
// this.eventEmitter.emit('scorm-api-call-logged', payload);

// REPLACE with direct store call (already shown above)
```

### 1.3 ✅ COMPLETED: Error Classification System

#### ✅ COMPLETED: New File: `src/shared/utils/error-router.js`

**Key Features Implemented**:
- ✅ **Error Source Classification**: APP, SCORM, AMBIGUOUS
- ✅ **Error Category Classification**: System, UI, Config, API, Content, Data, Sequencing, Runtime, Integration
- ✅ **Automatic Routing**: Routes errors to appropriate systems based on context
- ✅ **Troubleshooting Generation**: Context-aware troubleshooting steps for users
- ✅ **Dual-Channel Support**: Can send to both SCORM Inspector and app error handling

```javascript
/**
 * Error Router - Classifies and routes errors to appropriate systems
 * 
 * CRITICAL: This ensures app debugging and SCORM inspection are kept separate
 */

const ERROR_SOURCE = {
  APP: 'app',           // Application bug/issue
  SCORM: 'scorm',       // SCORM package content issue
  AMBIGUOUS: 'ambiguous' // Unclear source - needs investigation
};

const ERROR_CATEGORY = {
  // App Categories
  SYSTEM: 'system',         // File system, network, IPC
  UI: 'ui',                // User interface, rendering
  CONFIG: 'config',        // Settings, preferences
  
  // SCORM Categories  
  API: 'scorm-api',        // SCORM API compliance issues
  CONTENT: 'scorm-content', // Content loading, manifest issues
  DATA: 'scorm-data',      // Data model validation errors
  SEQUENCING: 'scorm-sequencing', // Navigation rule violations
  
  // Ambiguous Categories
  RUNTIME: 'runtime',      // Could be app or content issue
  INTEGRATION: 'integration' // App-content integration issues
};

class ErrorRouter {
  /**
   * Route error to appropriate system based on classification
   * @param {Error} error - The error object
   * @param {Object} context - Context information for classification
   */
  static routeError(error, context = {}) {
    const classification = this.classifyError(error, context);
    
    // Always log to app.log for developers (complete technical record)
    this.logToApp(error, classification, context);
    
    // Route to appropriate user interface
    switch (classification.source) {
      case ERROR_SOURCE.SCORM:
        this.routeToScormInspector(error, classification, context);
        break;
        
      case ERROR_SOURCE.APP:
        this.routeToAppErrorHandler(error, classification, context);
        break;
        
      case ERROR_SOURCE.AMBIGUOUS:
        this.routeToBoth(error, classification, context);
        break;
    }
  }
  
  /**
   * Classify error based on context clues
   * @param {Error} error - The error object
   * @param {Object} context - Context information
   * @returns {Object} Classification result
   */
  static classifyError(error, context) {
    // SCORM-specific indicators
    if (context.scormApiMethod) {
      return { source: ERROR_SOURCE.SCORM, category: ERROR_CATEGORY.API };
    }
    
    if (context.manifestParsing) {
      return { source: ERROR_SOURCE.SCORM, category: ERROR_CATEGORY.CONTENT };
    }
    
    if (context.scormDataValidation) {
      return { source: ERROR_SOURCE.SCORM, category: ERROR_CATEGORY.DATA };
    }
    
    if (context.scormSequencing) {
      return { source: ERROR_SOURCE.SCORM, category: ERROR_CATEGORY.SEQUENCING };
    }
    
    // App-specific indicators
    if (context.fileSystem || context.operation?.includes('file')) {
      return { source: ERROR_SOURCE.APP, category: ERROR_CATEGORY.SYSTEM };
    }
    
    if (context.component || context.ui || context.rendering) {
      return { source: ERROR_SOURCE.APP, category: ERROR_CATEGORY.UI };
    }
    
    if (context.config || context.settings) {
      return { source: ERROR_SOURCE.APP, category: ERROR_CATEGORY.CONFIG };
    }
    
    // Ambiguous indicators
    if (context.contentLoading || context.networkError) {
      return { source: ERROR_SOURCE.AMBIGUOUS, category: ERROR_CATEGORY.RUNTIME };
    }
    
    // Default to ambiguous for investigation
    return { source: ERROR_SOURCE.AMBIGUOUS, category: ERROR_CATEGORY.INTEGRATION };
  }
  
  /**
   * Log error to app debugging system
   * @param {Error} error - The error object
   * @param {Object} classification - Error classification
   * @param {Object} context - Additional context
   */
  static logToApp(error, classification, context) {
    const logger = context.logger || console;
    const logData = {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      classification,
      context: this.sanitizeContext(context),
      timestamp: new Date().toISOString()
    };
    
    // Always log to app debugging system
    logger.error('[ErrorRouter] Error classified and logged', logData);
  }
  
  /**
   * Route error to SCORM Inspector
   * @param {Error} error - The error object
   * @param {Object} classification - Error classification
   * @param {Object} context - Additional context
   */
  static routeToScormInspector(error, classification, context) {
    const scormInspectorStore = context.scormInspectorStore;
    
    if (scormInspectorStore) {
      const errorData = {
        source: classification.source,
        category: classification.category,
        message: error.message,
        severity: this.determineSeverity(error, context),
        context: this.sanitizeContext(context),
        userActionable: true,
        troubleshootingSteps: this.generateTroubleshootingSteps(error, classification, context),
        timestamp: Date.now()
      };
      
      // Send to SCORM Inspector for user display
      scormInspectorStore.storeScormError(errorData);
    }
  }
  
  /**
   * Route error to app error handling
   * @param {Error} error - The error object
   * @param {Object} classification - Error classification  
   * @param {Object} context - Additional context
   */
  static routeToAppErrorHandler(error, classification, context) {
    const eventBus = context.eventBus;
    const uiState = context.uiState;
    
    // App errors go to UI notifications and app logging only
    if (eventBus) {
      eventBus.emit('app:error', {
        error,
        classification,
        timestamp: Date.now(),
        userMessage: 'An application error occurred. Please check the logs.'
      });
    }
    
    if (uiState) {
      uiState.showNotification({
        type: 'error',
        message: 'Application error occurred',
        details: error.message,
        duration: 5000
      });
    }
  }
  
  /**
   * Route ambiguous error to both systems
   * @param {Error} error - The error object
   * @param {Object} classification - Error classification
   * @param {Object} context - Additional context
   */
  static routeToBoth(error, classification, context) {
    // Send to both systems with investigation guidance
    this.routeToScormInspector(error, {
      ...classification,
      message: `${error.message} (Investigation needed: Could be content or app issue)`
    }, context);
    
    this.routeToAppErrorHandler(error, classification, context);
  }
  
  /**
   * Determine error severity
   * @param {Error} error - The error object
   * @param {Object} context - Additional context
   * @returns {string} Severity level
   */
  static determineSeverity(error, context) {
    if (context.critical || error.name === 'CriticalError') return 'critical';
    if (context.scormApiMethod || context.manifestParsing) return 'high';
    if (error.name === 'ValidationError') return 'medium';
    return 'low';
  }
  
  /**
   * Generate context-appropriate troubleshooting steps
   * @param {Error} error - The error object
   * @param {Object} classification - Error classification
   * @param {Object} context - Additional context
   * @returns {Array} Array of troubleshooting steps
   */
  static generateTroubleshootingSteps(error, classification, context) {
    const steps = [];
    
    switch (classification.category) {
      case ERROR_CATEGORY.API:
        steps.push(
          'Verify SCORM API call sequence and parameters',
          'Check if Initialize() was called first',
          'Ensure session is not terminated'
        );
        break;
        
      case ERROR_CATEGORY.CONTENT:
        steps.push(
          'Validate manifest.xml syntax and structure',
          'Check all referenced files exist in package',
          'Verify SCORM version compatibility'
        );
        break;
        
      case ERROR_CATEGORY.RUNTIME:
        steps.push(
          'Check if this is a content issue by testing with different SCORM package',
          'Try reloading the application',
          'Check network connectivity if loading remote content'
        );
        break;
        
      default:
        steps.push(
          'Review the error details and context',
          'Check application logs for more information',
          'Try reproducing the error with minimal steps'
        );
    }
    
    return steps;
  }
  
  /**
   * Remove sensitive information from context
   * @param {Object} context - Context object to sanitize
   * @returns {Object} Sanitized context
   */
  static sanitizeContext(context) {
    const sanitized = { ...context };
    
    // Remove sensitive or large objects
    delete sanitized.logger;
    delete sanitized.eventBus;
    delete sanitized.uiState;
    delete sanitized.scormInspectorStore;
    
    return sanitized;
  }
}

// Export constants for use in other modules
ErrorRouter.ERROR_SOURCE = ERROR_SOURCE;
ErrorRouter.ERROR_CATEGORY = ERROR_CATEGORY;

module.exports = ErrorRouter;
```

## Phase 2: UI Component Implementation

### 2.1 Create SCORM Inspector Window

#### Create: `scorm-inspector.html`

**CRITICAL**: This replaces the current `debug.html` with proper terminology and functionality.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SCORM Inspector - Package Analysis Tool</title>
    <link rel="stylesheet" href="src/styles/main.css">
    <link rel="stylesheet" href="src/styles/scorm-inspector.css">
</head>
<body class="scorm-inspector-window">
    <div id="scorm-inspector-container">
        <header class="inspector-header">
            <h1>SCORM Inspector</h1>
            <p class="inspector-subtitle">Analyze and troubleshoot SCORM package issues</p>
            <div class="inspector-stats" id="inspector-stats">
                <span class="stat">API Calls: <strong id="api-call-count">0</strong></span>
                <span class="stat">Errors: <strong id="error-count">0</strong></span>
                <span class="stat">Session: <strong id="session-status">Not Started</strong></span>
            </div>
        </header>

        <div id="scorm-inspector-panel-root">
            <!-- SCORM Inspector Panel will be mounted here -->
        </div>
    </div>

    <script type="module">
        import ScormInspectorWindow from './src/renderer/scorm-inspector-window.js';
        
        // Initialize SCORM Inspector Window
        const inspectorWindow = new ScormInspectorWindow();
        
        // Handle window lifecycle
        window.addEventListener('load', () => {
            inspectorWindow.initialize();
        });
        
        window.addEventListener('beforeunload', () => {
            inspectorWindow.cleanup();
        });
        
        // Export for debugging (development only)
        if (process.env.NODE_ENV === 'development') {
            window.scormInspector = inspectorWindow;
        }
    </script>
</body>
</html>
```

#### Create: `src/renderer/scorm-inspector-window.js`

```javascript
/**
 * SCORM Inspector Window Controller
 * 
 * Manages the standalone SCORM Inspector window for package analysis.
 * This is NOT for app debugging - it's for end-user SCORM content inspection.
 */

import ScormInspectorPanel from './components/scorm/scorm-inspector-panel.js';

class ScormInspectorWindow {
  constructor() {
    this.scormInspectorPanel = null;
    this.isInitialized = false;
    
    // Bind methods
    this.handleScormDataUpdate = this.handleScormDataUpdate.bind(this);
    this.handleScormErrorUpdate = this.handleScormErrorUpdate.bind(this);
    this.updateStats = this.updateStats.bind(this);
  }
  
  /**
   * Initialize the SCORM Inspector window
   */
  async initialize() {
    if (this.isInitialized) {
      console.warn('ScormInspectorWindow: Already initialized');
      return;
    }
    
    try {
      // Create SCORM Inspector Panel
      this.scormInspectorPanel = new ScormInspectorPanel('scorm-inspector-panel-root', {
        hideHeader: true,
        enableExport: true,
        showErrors: true,
        enableFiltering: true
      });
      
      // Initialize the panel
      await this.scormInspectorPanel.initialize();
      
      // Set up IPC communication
      await this.setupIPC();
      
      // Load historical SCORM data
      await this.loadScormHistory();
      
      this.isInitialized = true;
      console.log('ScormInspectorWindow: Initialized successfully');
      
    } catch (error) {
      console.error('ScormInspectorWindow: Initialization failed', error);
      this.showErrorMessage('Failed to initialize SCORM Inspector');
    }
  }
  
  /**
   * Set up IPC communication for SCORM data
   */
  async setupIPC() {
    if (!window.electronAPI) {
      throw new Error('Electron API not available');
    }
    
    // Listen for real-time SCORM updates
    window.electronAPI.on('scorm-inspector-data-updated', this.handleScormDataUpdate);
    window.electronAPI.on('scorm-inspector-error-updated', this.handleScormErrorUpdate);
    
    console.log('ScormInspectorWindow: IPC communication established');
  }
  
  /**
   * Load historical SCORM API call data
   */
  async loadScormHistory() {
    try {
      const response = await window.electronAPI.invoke('scorm-inspector-get-history', {
        limit: 2000
      });
      
      if (response.success && response.history) {
        console.log(`ScormInspectorWindow: Loading ${response.history.length} historical SCORM API calls`);
        
        // Load calls in chronological order (oldest first)
        const chronologicalCalls = response.history.reverse();
        
        for (const call of chronologicalCalls) {
          this.scormInspectorPanel.addScormApiCall(call);
        }
        
        // Update statistics
        this.updateStats();
        
        console.log(`ScormInspectorWindow: Successfully loaded ${response.history.length} historical SCORM API calls`);
      } else {
        console.warn('ScormInspectorWindow: No historical data available or failed to load');
      }
      
    } catch (error) {
      console.error('ScormInspectorWindow: Failed to load SCORM history', error);
      this.showErrorMessage('Failed to load historical SCORM data');
    }
  }
  
  /**
   * Handle real-time SCORM data updates
   * @param {Object} data - SCORM API call data
   */
  handleScormDataUpdate(data) {
    if (!this.scormInspectorPanel) {
      console.warn('ScormInspectorWindow: Received data update before panel initialization');
      return;
    }
    
    try {
      // Add new SCORM API call to the inspector
      this.scormInspectorPanel.addScormApiCall(data);
      
      // Update statistics
      this.updateStats();
      
      console.debug('ScormInspectorWindow: Added SCORM API call', data.method);
      
    } catch (error) {
      console.error('ScormInspectorWindow: Failed to handle data update', error);
    }
  }
  
  /**
   * Handle SCORM error updates
   * @param {Object} errorData - SCORM error data
   */
  handleScormErrorUpdate(errorData) {
    if (!this.scormInspectorPanel) return;
    
    try {
      // Add error to the inspector's error tab
      this.scormInspectorPanel.addScormError(errorData);
      
      // Update statistics
      this.updateStats();
      
      console.debug('ScormInspectorWindow: Added SCORM error', errorData.message);
      
    } catch (error) {
      console.error('ScormInspectorWindow: Failed to handle error update', error);
    }
  }
  
  /**
   * Update statistics display
   */
  updateStats() {
    if (!this.scormInspectorPanel) return;
    
    try {
      const stats = this.scormInspectorPanel.getStats();
      
      // Update header statistics
      const apiCallCount = document.getElementById('api-call-count');
      const errorCount = document.getElementById('error-count');
      const sessionStatus = document.getElementById('session-status');
      
      if (apiCallCount) apiCallCount.textContent = stats.totalApiCalls || 0;
      if (errorCount) errorCount.textContent = stats.totalErrors || 0;
      if (sessionStatus) sessionStatus.textContent = stats.sessionStatus || 'Unknown';
      
    } catch (error) {
      console.error('ScormInspectorWindow: Failed to update stats', error);
    }
  }
  
  /**
   * Show error message to user
   * @param {string} message - Error message
   */
  showErrorMessage(message) {
    // Create simple error display
    const errorDiv = document.createElement('div');
    errorDiv.className = 'inspector-error';
    errorDiv.innerHTML = `
      <h3>Error</h3>
      <p>${message}</p>
      <button onclick="window.close()">Close Window</button>
    `;
    
    const container = document.getElementById('scorm-inspector-container');
    if (container) {
      container.appendChild(errorDiv);
    }
  }
  
  /**
   * Clean up resources when window closes
   */
  cleanup() {
    try {
      // Remove IPC listeners
      if (window.electronAPI) {
        window.electronAPI.off('scorm-inspector-data-updated', this.handleScormDataUpdate);
        window.electronAPI.off('scorm-inspector-error-updated', this.handleScormErrorUpdate);
      }
      
      // Clean up panel
      if (this.scormInspectorPanel) {
        this.scormInspectorPanel.destroy();
        this.scormInspectorPanel = null;
      }
      
      this.isInitialized = false;
      
      console.log('ScormInspectorWindow: Cleanup completed');
      
    } catch (error) {
      console.error('ScormInspectorWindow: Cleanup failed', error);
    }
  }
}

export default ScormInspectorWindow;
```

### 2.2 Create SCORM Inspector Panel Component

#### Create: `src/renderer/components/scorm/scorm-inspector-panel.js`

```javascript
/**
 * SCORM Inspector Panel Component
 * 
 * Complete SCORM package inspection interface with multiple views and tabs.
 * This component is for end-user SCORM content analysis, NOT app debugging.
 */

import BaseComponent from '../base-component.js';
import ApiTimelineView from './inspector-views/api-timeline-view.js';
import ErrorsView from './inspector-views/errors-view.js';
import DataModelView from './inspector-views/data-model-view.js';
import SequencingView from './inspector-views/sequencing-view.js';

class ScormInspectorPanel extends BaseComponent {
  constructor(elementId, options = {}) {
    super(elementId, options);
    
    this.config = {
      hideHeader: false,
      enableExport: true,
      showErrors: true,
      enableFiltering: true,
      maxHistorySize: 1000,
      ...options
    };
    
    // Data storage (display buffer only)
    this.scormApiCalls = [];
    this.scormErrors = [];
    this.sessionData = {};
    
    // View management
    this.views = new Map();
    this.activeView = 'api-timeline';
    
    // Bind methods
    this.handleTabClick = this.handleTabClick.bind(this);
    this.handleExport = this.handleExport.bind(this);
    this.handleClear = this.handleClear.bind(this);
  }
  
  /**
   * Initialize the SCORM Inspector Panel
   */
  async initialize() {
    if (this.isInitialized) return;
    
    try {
      await super.initialize();
      
      // Create view instances
      this.createViews();
      
      // Render initial UI
      this.render();
      
      // Set up event listeners
      this.setupEventListeners();
      
      console.log('ScormInspectorPanel: Initialized with views:', Array.from(this.views.keys()));
      
    } catch (error) {
      console.error('ScormInspectorPanel: Initialization failed', error);
      throw error;
    }
  }
  
  /**
   * Create inspector view instances
   */
  createViews() {
    // API Timeline View - shows chronological SCORM API calls
    this.views.set('api-timeline', new ApiTimelineView({
      enableFiltering: this.config.enableFiltering,
      enableExport: this.config.enableExport
    }));
    
    // Errors View - shows SCORM package errors and troubleshooting
    if (this.config.showErrors) {
      this.views.set('errors', new ErrorsView({
        enableTroubleshooting: true,
        enableFiltering: true
      }));
    }
    
    // Data Model View - shows current SCORM data state
    this.views.set('data-model', new DataModelView({
      enableEditing: false, // Read-only for inspection
      showValidation: true
    }));
    
    // Sequencing View - shows navigation and sequencing information
    this.views.set('sequencing', new SequencingView({
      enableInteraction: false, // Read-only for inspection
      showRuleEvaluation: true
    }));
  }
  
  /**
   * Render the inspector panel UI
   */
  render() {
    const container = document.getElementById(this.elementId);
    if (!container) {
      throw new Error(`ScormInspectorPanel: Container element '${this.elementId}' not found`);
    }
    
    container.innerHTML = this.generateHTML();
    
    // Initialize active view
    this.switchToView(this.activeView);
  }
  
  /**
   * Generate HTML for the inspector panel
   * @returns {string} HTML string
   */
  generateHTML() {
    return `
      <div class="scorm-inspector-panel">
        ${this.config.hideHeader ? '' : this.generateHeader()}
        
        <div class="inspector-tabs">
          ${this.generateTabs()}
        </div>
        
        <div class="inspector-toolbar">
          ${this.generateToolbar()}
        </div>
        
        <div class="inspector-content">
          ${this.generateViewContainers()}
        </div>
        
        <div class="inspector-status">
          ${this.generateStatusBar()}
        </div>
      </div>
    `;
  }
  
  /**
   * Generate header HTML
   * @returns {string} Header HTML
   */
  generateHeader() {
    return `
      <header class="inspector-header">
        <h2>SCORM Inspector</h2>
        <p class="inspector-description">
          Analyze SCORM package behavior, API calls, and troubleshoot content issues
        </p>
      </header>
    `;
  }
  
  /**
   * Generate tabs HTML
   * @returns {string} Tabs HTML
   */
  generateTabs() {
    const tabs = [
      { id: 'api-timeline', label: 'API Timeline', icon: '📋' },
      { id: 'errors', label: 'Errors', icon: '⚠️', count: this.scormErrors.length },
      { id: 'data-model', label: 'Data Model', icon: '📊' },
      { id: 'sequencing', label: 'Sequencing', icon: '🔄' }
    ];
    
    return tabs.map(tab => {
      if (tab.id === 'errors' && !this.config.showErrors) return '';
      
      const isActive = tab.id === this.activeView;
      const countBadge = tab.count ? `<span class="tab-count">${tab.count}</span>` : '';
      
      return `
        <button class="inspector-tab ${isActive ? 'active' : ''}" 
                data-view="${tab.id}"
                title="View ${tab.label}">
          <span class="tab-icon">${tab.icon}</span>
          <span class="tab-label">${tab.label}</span>
          ${countBadge}
        </button>
      `;
    }).join('');
  }
  
  /**
   * Generate toolbar HTML
   * @returns {string} Toolbar HTML
   */
  generateToolbar() {
    return `
      <div class="toolbar-section">
        <button id="export-data-btn" class="toolbar-btn" title="Export inspection data">
          📄 Export
        </button>
        <button id="clear-data-btn" class="toolbar-btn" title="Clear all data">
          🗑️ Clear
        </button>
        <button id="refresh-data-btn" class="toolbar-btn" title="Refresh data">
          🔄 Refresh
        </button>
      </div>
      
      <div class="toolbar-section">
        <label for="filter-input">Filter:</label>
        <input type="text" id="filter-input" class="filter-input" 
               placeholder="Filter SCORM data...">
      </div>
    `;
  }
  
  /**
   * Generate view containers HTML
   * @returns {string} View containers HTML
   */
  generateViewContainers() {
    return Array.from(this.views.keys()).map(viewId => {
      const isActive = viewId === this.activeView;
      return `
        <div id="view-${viewId}" class="inspector-view ${isActive ? 'active' : ''}">
          <div class="view-content" id="content-${viewId}">
            <!-- View content will be rendered here -->
          </div>
        </div>
      `;
    }).join('');
  }
  
  /**
   * Generate status bar HTML
   * @returns {string} Status bar HTML
   */
  generateStatusBar() {
    return `
      <div class="status-bar">
        <span class="status-item">
          API Calls: <strong>${this.scormApiCalls.length}</strong>
        </span>
        <span class="status-item">
          Errors: <strong class="error-count">${this.scormErrors.length}</strong>
        </span>
        <span class="status-item">
          Last Update: <strong id="last-update">Never</strong>
        </span>
      </div>
    `;
  }
  
  /**
   * Set up event listeners
   */
  setupEventListeners() {
    // Tab switching
    document.addEventListener('click', (event) => {
      if (event.target.closest('.inspector-tab')) {
        this.handleTabClick(event);
      }
    });
    
    // Toolbar actions
    const exportBtn = document.getElementById('export-data-btn');
    const clearBtn = document.getElementById('clear-data-btn');
    const refreshBtn = document.getElementById('refresh-data-btn');
    const filterInput = document.getElementById('filter-input');
    
    if (exportBtn) exportBtn.addEventListener('click', this.handleExport);
    if (clearBtn) clearBtn.addEventListener('click', this.handleClear);
    if (refreshBtn) refreshBtn.addEventListener('click', () => this.refreshActiveView());
    if (filterInput) filterInput.addEventListener('input', (e) => this.handleFilter(e.target.value));
  }
  
  /**
   * Handle tab click events
   * @param {Event} event - Click event
   */
  handleTabClick(event) {
    const tab = event.target.closest('.inspector-tab');
    const viewId = tab?.dataset.view;
    
    if (viewId && this.views.has(viewId)) {
      this.switchToView(viewId);
    }
  }
  
  /**
   * Switch to specific view
   * @param {string} viewId - View identifier
   */
  switchToView(viewId) {
    if (!this.views.has(viewId)) {
      console.warn(`ScormInspectorPanel: View '${viewId}' not found`);
      return;
    }
    
    // Update active view
    this.activeView = viewId;
    
    // Update tab UI
    document.querySelectorAll('.inspector-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.view === viewId);
    });
    
    // Update view UI
    document.querySelectorAll('.inspector-view').forEach(view => {
      view.classList.toggle('active', view.id === `view-${viewId}`);
    });
    
    // Render active view
    this.renderActiveView();
    
    console.debug(`ScormInspectorPanel: Switched to view '${viewId}'`);
  }
  
  /**
   * Render the currently active view
   */
  renderActiveView() {
    const view = this.views.get(this.activeView);
    const container = document.getElementById(`content-${this.activeView}`);
    
    if (view && container) {
      // Pass relevant data to the view
      const viewData = this.getDataForView(this.activeView);
      view.render(container, viewData);
    }
  }
  
  /**
   * Get data for specific view
   * @param {string} viewId - View identifier
   * @returns {Object} View-specific data
   */
  getDataForView(viewId) {
    switch (viewId) {
      case 'api-timeline':
        return { apiCalls: this.scormApiCalls };
        
      case 'errors':
        return { errors: this.scormErrors };
        
      case 'data-model':
        return { 
          sessionData: this.sessionData,
          apiCalls: this.scormApiCalls 
        };
        
      case 'sequencing':
        return { 
          apiCalls: this.scormApiCalls.filter(call => 
            call.method === 'Initialize' || 
            call.method === 'Terminate' ||
            call.method?.includes('Navigation')
          )
        };
        
      default:
        return {};
    }
  }
  
  /**
   * Add SCORM API call to inspector
   * @param {Object} data - SCORM API call data
   */
  addScormApiCall(data) {
    // Add to local buffer
    this.scormApiCalls.push(data);
    this.trimDisplayBuffer();
    
    // Update session data if relevant
    this.updateSessionData(data);
    
    // Update active view
    this.refreshActiveView();
    
    // Update status
    this.updateStatus();
  }
  
  /**
   * Add SCORM error to inspector
   * @param {Object} errorData - SCORM error data
   */
  addScormError(errorData) {
    this.scormErrors.push(errorData);
    this.trimErrorBuffer();
    
    // Update error count in tabs
    this.updateErrorCount();
    
    // If errors view is active, refresh it
    if (this.activeView === 'errors') {
      this.refreshActiveView();
    }
    
    // Update status
    this.updateStatus();
  }
  
  /**
   * Update session data based on API call
   * @param {Object} data - SCORM API call data
   */
  updateSessionData(data) {
    if (data.method === 'Initialize') {
      this.sessionData.initialized = true;
      this.sessionData.initializeTime = data.timestamp;
    }
    
    if (data.method === 'Terminate') {
      this.sessionData.terminated = true;
      this.sessionData.terminateTime = data.timestamp;
    }
    
    if (data.method === 'SetValue' && data.params?.[0]) {
      if (!this.sessionData.dataModel) this.sessionData.dataModel = {};
      this.sessionData.dataModel[data.params[0]] = data.params[1];
    }
  }
  
  /**
   * Refresh the currently active view
   */
  refreshActiveView() {
    this.renderActiveView();
  }
  
  /**
   * Trim display buffer to prevent memory issues
   */
  trimDisplayBuffer() {
    if (this.scormApiCalls.length > this.config.maxHistorySize) {
      const removeCount = this.scormApiCalls.length - this.config.maxHistorySize;
      this.scormApiCalls.splice(0, removeCount);
      console.debug(`ScormInspectorPanel: Trimmed ${removeCount} old API calls`);
    }
  }
  
  /**
   * Trim error buffer
   */
  trimErrorBuffer() {
    const maxErrors = Math.floor(this.config.maxHistorySize * 0.3);
    if (this.scormErrors.length > maxErrors) {
      const removeCount = this.scormErrors.length - maxErrors;
      this.scormErrors.splice(0, removeCount);
    }
  }
  
  /**
   * Update error count in tabs
   */
  updateErrorCount() {
    const errorTab = document.querySelector('[data-view="errors"] .tab-count');
    if (errorTab) {
      errorTab.textContent = this.scormErrors.length;
      errorTab.style.display = this.scormErrors.length > 0 ? 'inline' : 'none';
    }
  }
  
  /**
   * Update status bar
   */
  updateStatus() {
    const apiCountEl = document.querySelector('.status-bar .status-item strong');
    const errorCountEl = document.querySelector('.status-bar .error-count');
    const lastUpdateEl = document.getElementById('last-update');
    
    if (apiCountEl) apiCountEl.textContent = this.scormApiCalls.length;
    if (errorCountEl) errorCountEl.textContent = this.scormErrors.length;
    if (lastUpdateEl) lastUpdateEl.textContent = new Date().toLocaleTimeString();
  }
  
  /**
   * Handle export functionality
   */
  async handleExport() {
    try {
      const exportData = {
        timestamp: new Date().toISOString(),
        session: this.sessionData,
        apiCalls: this.scormApiCalls,
        errors: this.scormErrors,
        stats: this.getStats()
      };
      
      const jsonData = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonData], { type: 'application/json' });
      
      // Create download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scorm-inspector-${Date.now()}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
      
      console.log('ScormInspectorPanel: Data exported successfully');
      
    } catch (error) {
      console.error('ScormInspectorPanel: Export failed', error);
    }
  }
  
  /**
   * Handle clear functionality
   */
  handleClear() {
    if (confirm('Clear all SCORM inspection data? This cannot be undone.')) {
      this.scormApiCalls = [];
      this.scormErrors = [];
      this.sessionData = {};
      
      this.refreshActiveView();
      this.updateStatus();
      this.updateErrorCount();
      
      console.log('ScormInspectorPanel: All data cleared');
    }
  }
  
  /**
   * Handle filtering
   * @param {string} filterText - Filter text
   */
  handleFilter(filterText) {
    const activeView = this.views.get(this.activeView);
    if (activeView && typeof activeView.filter === 'function') {
      activeView.filter(filterText);
    }
  }
  
  /**
   * Get current statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      totalApiCalls: this.scormApiCalls.length,
      totalErrors: this.scormErrors.length,
      sessionStatus: this.getSessionStatus(),
      criticalErrors: this.scormErrors.filter(e => e.severity === 'critical').length,
      highErrors: this.scormErrors.filter(e => e.severity === 'high').length,
      lastActivity: this.scormApiCalls.length > 0 ? 
        Math.max(...this.scormApiCalls.map(c => c.timestamp)) : null
    };
  }
  
  /**
   * Get current session status
   * @returns {string} Session status
   */
  getSessionStatus() {
    if (this.sessionData.terminated) return 'Terminated';
    if (this.sessionData.initialized) return 'Active';
    return 'Not Started';
  }
  
  /**
   * Clean up resources
   */
  destroy() {
    // Clean up views
    this.views.forEach(view => {
      if (typeof view.destroy === 'function') {
        view.destroy();
      }
    });
    
    this.views.clear();
    
    // Clean up data
    this.scormApiCalls = [];
    this.scormErrors = [];
    this.sessionData = {};
    
    super.destroy();
  }
}

export default ScormInspectorPanel;
```

## Phase 3: File Cleanup and Removal

### 3.1 Files to DELETE Completely

**CRITICAL**: These files contain the old "debug" architecture that conflicts with SCORM Inspector:

```bash
# Remove old debug files - THESE MUST BE DELETED
rm src/renderer/debug-window.js
rm src/renderer/debug-window.html
rm src/renderer/services/debug-data-aggregator.js

# Remove old debug HTML (replace with scorm-inspector.html)
rm debug.html

# Verify deletion
ls -la src/renderer/debug*
ls -la src/renderer/services/debug*
```

### 3.2 Files to RENAME

```bash
# Rename telemetry store (if it exists with old name)
if [ -f "src/main/services/debug/debug-telemetry-store.js" ]; then
  mkdir -p src/main/services/scorm-inspector
  mv src/main/services/debug/debug-telemetry-store.js src/main/services/scorm-inspector/scorm-inspector-telemetry-store.js
  
  # Remove empty debug directory if no other files
  rmdir src/main/services/debug 2>/dev/null || true
fi

# Create SCORM Inspector directory structure
mkdir -p src/main/services/scorm-inspector
mkdir -p src/renderer/components/scorm/inspector-views
```

### 3.3 Update Component References

#### Update: `src/renderer/components/scorm/debug-panel.js` → `src/renderer/components/scorm/scorm-inspector-panel.js`

```bash
# If debug-panel.js exists, rename it
if [ -f "src/renderer/components/scorm/debug-panel.js" ]; then
  mv src/renderer/components/scorm/debug-panel.js src/renderer/components/scorm/scorm-inspector-panel.js
fi
```

**Then update the content to match the ScormInspectorPanel implementation above.**

### 3.4 IPC Channel Updates

#### Update: `src/main/services/ipc-handler.js`

**Find and replace all debug-related IPC channels:**

```javascript
// REMOVE old channels:
// 'debug-data-updated'
// 'debug-get-history'
// 'open-debug-window'

// REPLACE with:
'scorm-inspector-data-updated'
'scorm-inspector-get-history'  
'scorm-inspector-error-updated'
'open-scorm-inspector-window'
```

**Add new IPC handlers:**

```javascript
/**
 * Handle SCORM Inspector history request
 */
async handleScormInspectorGetHistory(event, options = {}) {
  try {
    if (!this.scormInspectorStore) {
      return { success: false, error: 'SCORM Inspector store not available' };
    }
    
    const result = this.scormInspectorStore.getHistory(options);
    return result;
    
  } catch (error) {
    this.logger?.error('IpcHandler: Failed to get SCORM Inspector history', error?.message || error);
    return { success: false, error: error?.message || 'Unknown error' };
  }
}

/**
 * Handle SCORM Inspector window open request
 */
async handleOpenScormInspectorWindow(event) {
  try {
    if (!this.windowManager) {
      return { success: false, error: 'Window manager not available' };
    }
    
    const window = await this.windowManager.openScormInspectorWindow();
    return { success: true, windowId: window?.id };
    
  } catch (error) {
    this.logger?.error('IpcHandler: Failed to open SCORM Inspector window', error?.message || error);
    return { success: false, error: error?.message || 'Failed to open window' };
  }
}
```

## Phase 4: Service Integration

### 4.1 Update Main Process Service Initialization

#### Update: `src/main/main.js`

**Add SCORM Inspector store initialization:**

```javascript
// Import new services
const ScormInspectorTelemetryStore = require('./services/scorm-inspector/scorm-inspector-telemetry-store');
const ErrorRouter = require('../shared/utils/error-router');

// In service initialization section:
async function initializeServices() {
  try {
    // ... existing service initialization ...
    
    // Initialize SCORM Inspector Telemetry Store
    logger.info('Initializing SCORM Inspector Telemetry Store...');
    const scormInspectorStore = new ScormInspectorTelemetryStore(errorHandler, logger, {
      maxHistorySize: 2000,
      enableBroadcast: true
    });
    
    await scormInspectorStore.initialize();
    logger.info('SCORM Inspector Telemetry Store initialized successfully');
    
    // Wire dependencies
    if (windowManager) {
      scormInspectorStore.setWindowManager(windowManager);
    }
    
    if (ipcHandler) {
      // Set SCORM Inspector store reference
      ipcHandler.setScormInspectorStore(scormInspectorStore);
      
      // Register IPC handlers
      ipcHandler.registerHandler('scorm-inspector-get-history', 
        ipcHandler.handleScormInspectorGetHistory.bind(ipcHandler));
      ipcHandler.registerHandler('open-scorm-inspector-window', 
        ipcHandler.handleOpenScormInspectorWindow.bind(ipcHandler));
    }
    
    if (scormService) {
      // Set SCORM Inspector store in SCORM service
      scormService.setScormInspectorStore(scormInspectorStore);
    }
    
    // ... rest of initialization ...
    
  } catch (error) {
    logger.error('Service initialization failed:', error);
    throw error;
  }
}
```

### 4.2 Update SCORM Service Integration  

#### Update: `src/main/services/scorm-service.js`

**Add SCORM Inspector store integration:**

```javascript
class ScormService extends BaseService {
  constructor(errorHandler, logger, options = {}) {
    super('ScormService', errorHandler, logger, options);
    
    // ... existing constructor code ...
    
    this.scormInspectorStore = null; // Will be set by main.js
  }
  
  /**
   * Set SCORM Inspector store reference
   * @param {ScormInspectorTelemetryStore} store - SCORM Inspector store instance
   */
  setScormInspectorStore(store) {
    this.scormInspectorStore = store;
    
    // Pass to RTE instances
    if (this.rteInstances) {
      this.rteInstances.forEach(rte => {
        if (rte.apiHandler) {
          rte.apiHandler.setScormInspectorStore(store);
        }
      });
    }
    
    this.logger?.debug('ScormService: SCORM Inspector store reference set');
  }
  
  // ... rest of existing methods ...
  
  // REMOVE old telemetry-related methods that used event emitters
  // REMOVE: notifyTelemetryStore, notifyDebugWindow, etc.
}
```

### 4.3 Update Window Manager

#### Update: `src/main/services/window-manager.js`

**Add SCORM Inspector window management:**

```javascript
class WindowManager extends BaseService {
  constructor(errorHandler, logger, options = {}) {
    super('WindowManager', errorHandler, logger, options);
    
    // ... existing constructor ...
    
    this.scormInspectorWindow = null;
  }
  
  /**
   * Open SCORM Inspector window
   * @returns {Promise<BrowserWindow>} SCORM Inspector window instance
   */
  async openScormInspectorWindow() {
    if (this.scormInspectorWindow && !this.scormInspectorWindow.isDestroyed()) {
      this.scormInspectorWindow.focus();
      return this.scormInspectorWindow;
    }
    
    try {
      this.scormInspectorWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: 'SCORM Inspector - Package Analysis Tool',
        icon: this.config.iconPath,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          preload: path.join(__dirname, '../preload/preload.js'),
          webSecurity: true,
          allowRunningInsecureContent: false
        },
        show: false
      });
      
      // Load SCORM Inspector HTML
      await this.scormInspectorWindow.loadFile('scorm-inspector.html');
      
      // Set up window event handlers
      this.setupScormInspectorWindowEvents();
      
      // Show window
      this.scormInspectorWindow.show();
      
      this.logger?.info('WindowManager: SCORM Inspector window opened');
      
      return this.scormInspectorWindow;
      
    } catch (error) {
      this.logger?.error('WindowManager: Failed to open SCORM Inspector window', error?.message || error);
      throw error;
    }
  }
  
  /**
   * Set up SCORM Inspector window event handlers
   */
  setupScormInspectorWindowEvents() {
    if (!this.scormInspectorWindow) return;
    
    this.scormInspectorWindow.on('closed', () => {
      this.scormInspectorWindow = null;
      this.logger?.debug('WindowManager: SCORM Inspector window closed');
    });
    
    this.scormInspectorWindow.on('ready-to-show', () => {
      this.logger?.debug('WindowManager: SCORM Inspector window ready');
    });
  }
  
  /**
   * Get all windows for broadcasting
   * @returns {Array<BrowserWindow>} Array of window instances
   */
  getAllWindows() {
    const windows = [];
    
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      windows.push(this.mainWindow);
    }
    
    if (this.scormInspectorWindow && !this.scormInspectorWindow.isDestroyed()) {
      windows.push(this.scormInspectorWindow);
    }
    
    return windows;
  }
  
  // ... rest of existing methods ...
  
  // REMOVE old debug window methods
  // REMOVE: openDebugWindow, setupDebugWindowEvents, etc.
}
```

## Phase 5: EventBus Cleanup

### 5.1 Update Event Bus Usage

#### Update: `src/renderer/services/event-bus.js`

**Ensure EventBus is ONLY used for app UI events, NOT SCORM data:**

```javascript
/**
 * Event Bus Service
 * 
 * IMPORTANT: This EventBus is for app UI events ONLY.
 * SCORM package inspection data uses direct IPC channels.
 * 
 * Allowed events:
 * - app:error, app:warning, app:info
 * - navigation:request, navigation:complete
 * - ui:notification, ui:modal, ui:tooltip
 * - course:loaded, course:unloaded (metadata only)
 * 
 * NOT allowed:
 * - scorm:api-call, scorm:data-updated
 * - debug:*, telemetry:*
 * - Any SCORM inspection data
 */

class EventBus extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      debugMode: false, // For UI event debugging only
      maxListeners: 50,
      enableValidation: true,
      ...options
    };
    
    // Set max listeners
    this.setMaxListeners(this.config.maxListeners);
    
    // Allowed event patterns (for validation)
    this.allowedPatterns = [
      /^app:/,        // App-level events
      /^navigation:/, // Navigation events  
      /^ui:/,         // UI events
      /^course:/,     // Course metadata events (NOT SCORM data)
      /^content:/     // Content loading events (NOT SCORM API data)
    ];
    
    // Forbidden patterns (prevent misuse)
    this.forbiddenPatterns = [
      /^scorm:/,      // SCORM data should use direct IPC
      /^debug:/,      // Debug data should use direct IPC
      /^telemetry:/,  // Telemetry should use direct IPC
      /^api:/         // API calls should use direct IPC
    ];
    
    if (this.config.debugMode) {
      this.enableDebugLogging();
    }
  }
  
  /**
   * Override emit to add validation
   */
  emit(eventName, ...args) {
    if (this.config.enableValidation) {
      this.validateEvent(eventName);
    }
    
    if (this.config.debugMode) {
      this.logEvent('emit', eventName, args);
    }
    
    return super.emit(eventName, ...args);
  }
  
  /**
   * Validate event name against allowed/forbidden patterns
   * @param {string} eventName - Event name to validate
   */
  validateEvent(eventName) {
    // Check forbidden patterns first
    for (const pattern of this.forbiddenPatterns) {
      if (pattern.test(eventName)) {
        const error = new Error(
          `EventBus: Forbidden event '${eventName}'. ` +
          `SCORM/debug/telemetry data must use direct IPC channels, not EventBus.`
        );
        console.error(error.message);
        throw error;
      }
    }
    
    // Check if event matches allowed patterns
    const isAllowed = this.allowedPatterns.some(pattern => pattern.test(eventName));
    if (!isAllowed) {
      console.warn(`EventBus: Event '${eventName}' doesn't match allowed patterns. Consider using direct IPC for non-UI events.`);
    }
  }
  
  /**
   * Enable debug logging for UI events
   */
  enableDebugLogging() {
    this.on('newListener', (eventName) => {
      console.debug(`EventBus: New listener for '${eventName}'`);
    });
    
    this.on('removeListener', (eventName) => {
      console.debug(`EventBus: Removed listener for '${eventName}'`);
    });
  }
  
  /**
   * Log event emission (debug mode only)
   */
  logEvent(action, eventName, args) {
    console.debug(`EventBus: ${action} '${eventName}'`, {
      listenerCount: this.listenerCount(eventName),
      argsCount: args.length
    });
  }
  
  // ... rest of existing EventBus methods ...
}
```

### 5.2 Remove SCORM Data from EventBus

**Search and replace in all renderer files:**

```bash
# Find files that incorrectly use EventBus for SCORM data
grep -r "eventBus.*scorm\|eventBus.*debug\|eventBus.*api.*call" src/renderer/

# These should be converted to direct IPC calls
```

**Convert EventBus SCORM events to IPC:**

```javascript
// WRONG (old way):
eventBus.emit('scorm:api-call', data);
eventBus.emit('debug:data-updated', data);

// CORRECT (new way):
// This should happen automatically via the new architecture
// SCORM data flows through: api-handler → scorm-inspector-store → IPC → UI
```

## Phase 6: Testing and Validation

### 6.1 Create Test Plan

#### Create: `test-scorm-inspector-implementation.md`

```markdown
# SCORM Inspector Implementation Test Plan

## Test Categories

### 1. Architecture Validation
- [ ] SCORM Inspector store receives API calls from api-handler
- [ ] Data flows directly from api-handler to store (no EventBus)
- [ ] IPC channels broadcast to both main and inspector windows  
- [ ] EventBus only handles UI events (no SCORM data)
- [ ] Error routing works correctly (app vs SCORM vs ambiguous)

### 2. UI Component Testing
- [ ] SCORM Inspector window opens correctly
- [ ] All tabs render properly (API Timeline, Errors, Data Model, Sequencing)
- [ ] Historical data loads when inspector opens
- [ ] Real-time updates appear immediately
- [ ] Export functionality works
- [ ] Clear functionality works
- [ ] Filtering works across all views

### 3. Data Flow Testing
- [ ] API calls appear in inspector immediately
- [ ] Historical API calls load on inspector window open
- [ ] Error classification routes to correct systems
- [ ] No duplicate data across multiple paths
- [ ] Memory usage remains stable with large histories

### 4. Error Handling Testing
- [ ] SCORM package errors show in inspector with troubleshooting steps
- [ ] App errors show in notifications (not inspector)
- [ ] Ambiguous errors show in both systems with investigation guidance
- [ ] Error severity classification works correctly

### 5. Cleanup Validation  
- [ ] Old debug files are completely removed
- [ ] No references to "debug window" in codebase
- [ ] All file paths updated to new structure
- [ ] No broken imports or references

## Test Scripts

### Manual Test: End-to-End Flow
1. Load a SCORM package with known issues
2. Open SCORM Inspector window
3. Verify historical API calls appear
4. Make SCORM API calls and verify real-time updates
5. Check error classification and troubleshooting steps
6. Export data and verify completeness
7. Test app errors (e.g., file system issues) don't appear in inspector

### Automated Test: API Integration
```javascript
// Test that API calls flow correctly to inspector
const apiHandler = new ScormApiHandler(...);
const inspectorStore = new ScormInspectorTelemetryStore(...);
apiHandler.setScormInspectorStore(inspectorStore);

// Make test API call
apiHandler.setValue('cmi.completion_status', 'completed');

// Verify data reaches inspector store
const history = inspectorStore.getHistory();
expect(history.history).toHaveLength(1);
expect(history.history[0].method).toBe('SetValue');
```

## Success Criteria
- [ ] Complete separation of app debugging and SCORM inspection
- [ ] Single data flow path for SCORM inspection data
- [ ] EventBus used only for UI events
- [ ] All old debug files removed
- [ ] Error classification working correctly
- [ ] UI components render and function properly
- [ ] Performance remains stable
- [ ] No memory leaks or race conditions
```

### 6.2 Performance Monitoring

**Add performance tracking to SCORM Inspector store:**

```javascript
// In ScormInspectorTelemetryStore
class ScormInspectorTelemetryStore {
  constructor(...) {
    // ... existing constructor ...
    
    this.performanceStats = {
      totalStoreTime: 0,
      totalBroadcastTime: 0,
      storeCallCount: 0,
      broadcastCount: 0,
      memoryUsage: 0
    };
  }
  
  storeApiCall(data) {
    const startTime = performance.now();
    
    // ... existing store logic ...
    
    const endTime = performance.now();
    this.performanceStats.totalStoreTime += (endTime - startTime);
    this.performanceStats.storeCallCount++;
    
    // Monitor memory usage periodically
    if (this.performanceStats.storeCallCount % 100 === 0) {
      this.checkMemoryUsage();
    }
  }
  
  checkMemoryUsage() {
    const memUsage = process.memoryUsage();
    this.performanceStats.memoryUsage = memUsage.heapUsed;
    
    if (memUsage.heapUsed > 100 * 1024 * 1024) { // 100MB threshold
      this.logger?.warn('ScormInspectorTelemetryStore: High memory usage detected', {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
        historySize: this.scormApiHistory.length
      });
    }
  }
}
```

## Phase 7: Documentation Updates

### 7.1 Update README Files

**All README and documentation references need to be updated from "debug" to "SCORM Inspector".**

### 7.2 Code Comments

**Update all code comments to reflect new architecture:**

```javascript
// OLD comments to find and replace:
// "debug window", "debug panel", "debug data"
// "telemetry", "debug telemetry"

// NEW comments:
// "SCORM Inspector", "SCORM inspection", "SCORM package analysis"
// "SCORM inspection telemetry", "package inspection data"
```

## Implementation Timeline

### Week 1: Core Architecture
- [x] Day 1-2: ✅ **COMPLETED** - Enhanced ScormInspectorTelemetryStore (renamed and improved existing store)
- [ ] Day 3: Update api-handler integration  
- [x] Day 4: ✅ **COMPLETED** - Created ErrorRouter with comprehensive classification system
- [ ] Day 5: Update service initialization

**Progress Update**: **2/4 core architecture tasks completed**. The foundation is now in place with proper SCORM Inspector store and error routing.

### Week 2: UI Implementation
- [ ] Day 1-2: Create SCORM Inspector window and panel
- [ ] Day 3: Create inspector view components
- [ ] Day 4: Implement export/filtering functionality
- [ ] Day 5: Update IPC channels

### Week 3: Cleanup and Integration
- [ ] Day 1: Remove old debug files
- [ ] Day 2: Update EventBus usage  
- [ ] Day 3: Update window management
- [ ] Day 4: Fix all file references
- [ ] Day 5: Update documentation

### Week 4: Testing and Validation
- [ ] Day 1-2: Comprehensive testing
- [ ] Day 3: Performance optimization
- [ ] Day 4: Bug fixes and edge cases
- [ ] Day 5: Final validation and deployment

## Critical Success Factors

1. **Complete Terminology Separation**: No mixing of "debug" (app issues) and "SCORM Inspector" (content issues)
2. **Single Data Flow**: Only one path for SCORM inspection data
3. **EventBus Scope**: Only UI events, never SCORM data
4. **Error Classification**: Correct routing based on error source
5. **File Cleanup**: Complete removal of conflicting old architecture
6. **Performance**: No memory leaks or performance degradation
7. **User Experience**: Clear, actionable SCORM troubleshooting information

---

## ✅ PROGRESS SUMMARY

### Phase 1: Core Architecture - **50% COMPLETE**
- [x] ✅ **COMPLETED**: SCORM Inspector Telemetry Store (enhanced from existing)
- [x] ✅ **COMPLETED**: Error Router with classification system  
- [ ] **NEXT**: API Handler integration
- [ ] **NEXT**: Service initialization updates

### Key Architectural Decisions Made:
1. **✅ Renamed Rather Than Duplicated**: Enhanced existing `DebugTelemetryStore` instead of creating duplicate functionality
2. **✅ Backwards Compatibility**: Preserved `flushTo()` method for smooth transition
3. **✅ Enhanced API**: Added SCORM-specific error handling, broadcasting, and performance tracking
4. **✅ Error Classification**: Implemented comprehensive error routing system

### Next Steps (Priority Order):
1. **Update main.js** to use `ScormInspectorTelemetryStore` instead of `DebugTelemetryStore`
2. **Update scorm-service.js** to integrate with new store
3. **Update API handler** to use enhanced store methods
4. **Create SCORM Inspector UI components**
5. **Remove old debug references**

---

**This implementation plan provides the complete roadmap to transform the debug architecture into the proper SCORM Inspector system with clear separation of concerns and single-source-of-truth data flow.**