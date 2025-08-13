# SCORM Inspector Architecture - Single Source of Truth Pattern

**Status**: ✅ **AUTHORITATIVE** - This document defines the canonical SCORM package inspection data flow architecture.

## Overview

This document defines the simplified, single-source-of-truth architecture for **SCORM package inspection** in the SCORM Tester application. The SCORM Inspector is an end-user facing tool designed to help analyze, troubleshoot, and fix issues with SCORM content packages.

## Critical Terminology Distinction

### **SCORM Inspector** (End-User Tool)
- **Purpose**: Help users analyze and fix SCORM package issues
- **Data**: SCORM API calls, data model state, content validation errors
- **Users**: Content developers, instructional designers, LMS administrators
- **UI Components**: SCORM Inspector Window, API Timeline, Data Model Viewer
- **Data Store**: `ScormInspectorTelemetryStore`

### **Debug/Logging** (App Developer Tool)
- **Purpose**: Help app developers fix application bugs and issues
- **Data**: Application logs, system errors, performance metrics
- **Users**: SCORM Tester app developers
- **Components**: Console logs, app.log file, development tools
- **Scope**: Application functionality, NOT SCORM content issues

## Architecture Principles

### 1. Single Source of Truth for SCORM Data
- **One authoritative location** for all SCORM inspection data: `scorm-inspector-telemetry-store.js`
- **One data ingestion point**: SCORM API calls logged directly from `api-handler.js`
- **One broadcast mechanism**: Direct IPC to all renderer windows

### 2. Unidirectional Data Flow
```
SCORM API Call → api-handler.js → scorm-inspector-telemetry-store.js → IPC broadcast → SCORM Inspector UI
```

### 3. Pure Consumer Pattern
- SCORM Inspector UI components are **pure consumers** - they only display SCORM data
- **No local data storage** in renderer components
- **No data correlation logic** in UI layer
- **No EventBus for SCORM inspection data** - direct IPC only

## Detailed Architecture

### Main Process Components

#### 1. `src/main/services/scorm/rte/api-handler.js`
**Role**: Single SCORM inspection data ingestion point

```javascript
class ScormApiHandler {
  logScormApiCall(method, params, result, errorCode, sessionId) {
    const payload = {
      method,
      params,
      result,
      errorCode,
      timestamp: Date.now(),
      sessionId,
      durationMs: this.calculateDuration(method, params)
    };
    
    // Single call to SCORM inspector store - NO event emitters
    if (this.scormInspectorStore) {
      this.scormInspectorStore.storeApiCall(payload);
    }
  }
}
```

#### 2. `src/main/services/scorm-inspector/scorm-inspector-telemetry-store.js`
**Role**: Single source of truth for all SCORM inspection data

```javascript
class ScormInspectorTelemetryStore {
  storeApiCall(data) {
    // Store in ring buffer
    this.history.push(data);
    this.trimHistory();
    
    // Immediately broadcast to ALL windows (main + inspector)
    this.broadcastToAllWindows('scorm-inspector-data-updated', data);
  }
  
  broadcastToAllWindows(channel, data) {
    // Get all windows from window-manager
    // Send via webContents.send() to each window
  }
  
  getHistory(options = {}) {
    // Return filtered/limited history for initial load
  }
}
```

#### 3. IPC Channels
**Single channel for all SCORM inspection communication:**
- `scorm-inspector-data-updated` - Real-time SCORM data broadcast
- `scorm-inspector-get-history` - **Critical**: Initial history fetch loads ALL prior API calls when inspector window opens

#### 4. Historical SCORM API Call Loading
**Requirement**: Users must see ALL SCORM API calls that occurred before opening inspector window

**Implementation** (Simplest Approach):
```javascript
// When SCORM inspector window opens
async loadScormHistory() {
  const response = await window.electronAPI.invoke('scorm-inspector-get-history', { 
    limit: 2000  // Load last 2000 SCORM API calls
  });
  
  if (response.success) {
    // Display ALL historical SCORM calls immediately
    this.scormApiCalls = response.history; // Complete timeline
    this.refreshActiveView();              // Scrollable display
  }
}
```

**Benefits**:
- ✅ **Immediate Load**: All SCORM history in single ~50ms call
- ✅ **Complete Timeline**: From SCORM session start to current
- ✅ **Fully Scrollable**: User can review entire SCORM API sequence
- ✅ **No Complex Pagination**: Simple ring buffer approach

#### 5. User Experience - Complete SCORM API Timeline Access
**What Users See**:
1. **Open SCORM Inspector Window** → Immediately see ALL prior SCORM API calls
2. **Scroll Through Timeline** → Complete SCORM session history from Initialize to current
3. **Real-time Updates** → New SCORM calls appear as they happen
4. **No Missing Data** → Every SCORM API call since session start is visible

**Timeline Display Order**:
- **Oldest → Newest** (chronological order)
- **Scrollable Container** with timestamps
- **Auto-scroll to Latest** when new SCORM calls arrive
- **Search/Filter** capabilities for large SCORM histories

### Renderer Process Components

#### 1. SCORM Inspector Window (`scorm-inspector.html`)
**Role**: Dedicated SCORM package inspection interface (standalone window)

```javascript
class ScormInspectorWindow {
  constructor() {
    // Single ScormInspectorPanel instance
    this.scormInspectorPanel = new ScormInspectorPanel('scorm-inspector-panel-root', {
      hideHeader: true,
      enableExport: true
    });
  }
  
  async setupIPC() {
    // 1. FIRST: Load ALL historical SCORM API calls
    await this.loadScormHistory();
    
    // 2. THEN: Listen for real-time SCORM updates
    window.electronAPI.on('scorm-inspector-data-updated', (data) => {
      this.scormInspectorPanel.addScormApiCall(data);
    });
  }
  
  async loadScormHistory() {
    try {
      const response = await window.electronAPI.invoke('scorm-inspector-get-history', { 
        limit: 2000 
      });
      
      if (response.success) {
        // Load ALL prior SCORM API calls in chronological order
        const historicalCalls = response.history.reverse(); // newest-first → oldest-first
        for (const call of historicalCalls) {
          this.scormInspectorPanel.addScormApiCall(call);
        }
        console.log(`Loaded ${response.history.length} historical SCORM API calls`);
      }
    } catch (error) {
      console.error('Failed to load SCORM API call history:', error);
    }
  }
}
```

#### 2. `src/renderer/components/scorm/scorm-inspector-panel.js`
**Role**: Complete SCORM package inspection interface with tabs

```javascript
class ScormInspectorPanel extends BaseComponent {
  constructor(elementId, options = {}) {
    super(elementId, options);
    this.scormApiCalls = []; // Local display buffer only
    this.views = new Map();
  }
  
  addScormApiCall(data) {
    // Add to display buffer
    this.scormApiCalls.push(data);
    this.trimDisplayBuffer();
    
    // Update active view immediately
    this.refreshActiveView();
  }
  
  async loadScormHistory() {
    // Single IPC call loads ALL historical SCORM API calls
    const response = await window.electronAPI.invoke('scorm-inspector-get-history', {
      limit: 2000  // Configurable history limit
    });
    
    if (response.success) {
      // Replace current display with complete SCORM history
      this.scormApiCalls = response.history.reverse(); // Show oldest → newest
      this.refreshActiveView();
      console.log(`ScormInspectorPanel: Loaded ${response.history.length} historical SCORM API calls`);
    }
  }
}
```

## Components to Remove/Modify

### **REMOVE Completely**
1. `src/renderer/services/debug-data-aggregator.js` - **DELETE** (was for app debugging, not SCORM inspection)
2. `src/renderer/debug-window.js` - **DELETE** (replaced by scorm-inspector.html script)
3. `src/renderer/debug-window.html` - **DELETE** (use scorm-inspector.html only)
4. EventBus debug event handling - **REMOVE** (separate app debugging from SCORM inspection)
5. Multiple event emitters for debug data - **REMOVE**

### **RENAME/REFACTOR**
1. `debug.html` → `scorm-inspector.html`
2. `DebugPanel` → `ScormInspectorPanel`
3. `debug-telemetry-store.js` → `scorm-inspector-telemetry-store.js`
4. All "debug window" references → "SCORM Inspector window"
5. All debug UI components → SCORM Inspector UI components

### **MODIFY Significantly**
1. `src/main/services/scorm-service.js` - Remove duplicate event emissions
2. `src/main/services/ipc-handler.js` - Update to SCORM Inspector channels
3. `src/renderer/services/event-bus.js` - Keep for app UI events only
4. `src/renderer/services/scorm-api-bridge.js` - Remove redundant logging

## Implementation Steps

### Phase 1: Create Single SCORM Data Path
1. Modify `api-handler.js` to call `scormInspectorStore.storeApiCall()` directly
2. Update `scorm-inspector-telemetry-store.js` to broadcast immediately on store
3. Remove all other SCORM event emissions

### Phase 2: Rename and Refactor UI Components  
1. Rename `debug.html` to `scorm-inspector.html`
2. **Implement historical loading**: Add `loadScormHistory()` call in SCORM inspector initialization
3. Remove `debug-data-aggregator.js` completely
4. Update `ScormInspectorPanel` to be pure consumer with scrollable timeline

### Phase 3: Clean Up Legacy Code
1. Delete redundant debug files
2. Remove EventBus SCORM inspection handling
3. Update all references in documentation

### Phase 4: Validation
1. Test single SCORM data flow path
2. Verify no duplicate SCORM data
3. Confirm real-time SCORM updates work
4. **Validate complete history loading**: Verify users see ALL prior SCORM API calls when opening inspector window
5. Test scrolling performance with large SCORM API call histories (1000+ calls)

## Benefits of This Architecture

### Clarity
- **Clear separation**: App debugging vs SCORM package inspection
- **Purpose-driven naming**: Components named for their actual function
- **User-focused**: SCORM Inspector is for content developers, not app developers

### Simplicity
- **90% reduction in SCORM inspection code**
- Single file to debug SCORM data flow issues
- Clear, predictable SCORM data path

### Reliability
- No race conditions between multiple SCORM data sources
- No data synchronization issues
- Consistent SCORM data across all UI components

### Maintainability
- Single point of modification for SCORM inspection data structure
- Easy to add new SCORM inspection information
- Simple to troubleshoot SCORM data flow issues

### Performance
- No redundant SCORM data processing
- Direct IPC communication for SCORM data
- Minimal memory usage in renderer

## Error Classification and Routing System

### **Critical Problem**: Distinguishing App vs SCORM Package Issues

When errors occur, it's often unclear whether the issue is:
- **App Issue**: Bug in SCORM Tester application code
- **SCORM Package Issue**: Problem with the loaded SCORM content
- **Ambiguous**: Could be either (requires investigation)

### **Solution**: Dual-Channel Error Classification System

#### **1. Error Classification at Source**

All errors are classified at the point of origin using error context:

```javascript
// Error Classification Types
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
```

#### **2. Dual-Channel Error Routing**

```javascript
class ErrorHandler {
  static handleError(error, context = {}) {
    const classification = this.classifyError(error, context);
    
    // Always log to app.log for developers
    this.logToApp(error, classification);
    
    // Route to appropriate user interface
    switch (classification.source) {
      case ERROR_SOURCE.SCORM:
        this.routeToScormInspector(error, classification);
        break;
        
      case ERROR_SOURCE.APP:
        this.routeToAppErrorHandler(error, classification);
        break;
        
      case ERROR_SOURCE.AMBIGUOUS:
        this.routeToBoth(error, classification);
        break;
    }
  }
  
  static classifyError(error, context) {
    // Classification logic based on error properties and context
    if (context.scormApiMethod) return { source: ERROR_SOURCE.SCORM, category: ERROR_CATEGORY.API };
    if (context.manifestParsing) return { source: ERROR_SOURCE.SCORM, category: ERROR_CATEGORY.CONTENT };
    if (context.fileSystem) return { source: ERROR_SOURCE.APP, category: ERROR_CATEGORY.SYSTEM };
    if (context.contentLoading && context.networkError) return { source: ERROR_SOURCE.AMBIGUOUS, category: ERROR_CATEGORY.RUNTIME };
    
    // Default to ambiguous for investigation
    return { source: ERROR_SOURCE.AMBIGUOUS, category: ERROR_CATEGORY.INTEGRATION };
  }
}
```

#### **3. Context-Aware Error Detection**

**SCORM Package Issues (→ SCORM Inspector)**:
```javascript
// Clear SCORM content issues
try {
  scormApi.SetValue('cmi.completion_status', 'invalid_value');
} catch (error) {
  ErrorHandler.handleError(error, { 
    source: ERROR_SOURCE.SCORM,
    category: ERROR_CATEGORY.API,
    scormApiMethod: 'SetValue',
    scormElement: 'cmi.completion_status'
  });
}

// Manifest parsing errors
try {
  parseManifest(xmlContent);
} catch (error) {
  ErrorHandler.handleError(error, {
    source: ERROR_SOURCE.SCORM,
    category: ERROR_CATEGORY.CONTENT,
    manifestParsing: true,
    packagePath: coursePath
  });
}
```

**App Issues (→ App Error Logging)**:
```javascript
// Clear app issues
try {
  fs.readFile(configPath);
} catch (error) {
  ErrorHandler.handleError(error, {
    source: ERROR_SOURCE.APP,
    category: ERROR_CATEGORY.SYSTEM,
    fileSystem: true,
    operation: 'config-read'
  });
}

// UI rendering errors
try {
  component.render();
} catch (error) {
  ErrorHandler.handleError(error, {
    source: ERROR_SOURCE.APP,
    category: ERROR_CATEGORY.UI,
    component: component.name
  });
}
```

**Ambiguous Issues (→ Both Systems)**:
```javascript
// Could be app bug OR content issue
try {
  loadScormContent(contentUrl);
} catch (error) {
  ErrorHandler.handleError(error, {
    source: ERROR_SOURCE.AMBIGUOUS,
    category: ERROR_CATEGORY.RUNTIME,
    contentLoading: true,
    url: contentUrl,
    networkError: error.code === 'NETWORK_ERROR'
  });
}
```

#### **4. Enhanced SCORM Inspector Data Structure**

```javascript
{
  // Existing SCORM inspection data
  method: string,
  params: array,
  result: any,
  errorCode: string,
  timestamp: number,
  sessionId: string,
  durationMs: number,
  
  // Enhanced error classification
  error?: {
    source: 'scorm' | 'app' | 'ambiguous',
    category: string,
    message: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    context: object,
    userActionable: boolean,
    troubleshootingSteps?: array
  }
}
```

#### **5. User-Facing Error Display**

**SCORM Inspector Window** shows:
- ✅ SCORM package compliance issues
- ✅ Content validation errors  
- ✅ API call failures with SCORM error codes
- ✅ Ambiguous errors with "investigate further" guidance

**App Error Notifications** show:
- ✅ Application crashes/bugs
- ✅ Configuration issues
- ✅ System-level problems
- ✅ File system errors

**Both Systems** for ambiguous errors:
- ✅ SCORM Inspector: Shows potential content issues
- ✅ App Logging: Records technical details for debugging
- ✅ User Guidance: "This could be a content issue or an app issue"

#### **6. Investigation Workflow for Ambiguous Errors**

```javascript
// When error source is unclear
const investigateError = (error, context) => {
  const evidence = {
    scormIndicators: checkScormEvidence(error, context),
    appIndicators: checkAppEvidence(error, context),
    environmentFactors: checkEnvironment(context)
  };
  
  // Provide investigative guidance
  return {
    likelySource: determineMostLikelySource(evidence),
    investigationSteps: generateInvestigationSteps(evidence),
    debuggingHints: getDebuggingHints(error, evidence)
  };
};
```

### **Implementation Benefits**

- ✅ **Clear Routing**: Errors go to the right system based on source
- ✅ **User-Focused**: Content developers see content issues, not app bugs
- ✅ **Developer-Focused**: App developers see app issues in app.log
- ✅ **Investigative Support**: Ambiguous cases get guidance for both users and developers
- ✅ **Complete Coverage**: Nothing falls through the cracks

### **Integration with Existing Architecture**

#### **Error Router Integration Points**

```javascript
// In api-handler.js
class ScormApiHandler {
  logScormApiCall(method, params, result, errorCode, sessionId) {
    const payload = {
      method, params, result, errorCode,
      timestamp: Date.now(), sessionId,
      durationMs: this.calculateDuration(method, params)
    };
    
    // Add error classification if error occurred
    if (errorCode !== '0') {
      payload.error = ErrorHandler.classifyScormError(
        { code: errorCode, method, params },
        { scormApiMethod: method, scormElement: params[0] }
      );
    }
    
    this.scormInspectorStore.storeApiCall(payload);
  }
}

// In manifest-parser.js
class ManifestParser {
  parse(xmlContent, packagePath) {
    try {
      return this.parseXML(xmlContent);
    } catch (error) {
      // Route manifest parsing errors to SCORM Inspector
      ErrorHandler.handleError(error, {
        source: ERROR_SOURCE.SCORM,
        category: ERROR_CATEGORY.CONTENT,
        manifestParsing: true,
        packagePath,
        severity: 'high',
        userActionable: true,
        troubleshootingSteps: [
          'Check manifest.xml file for syntax errors',
          'Validate XML structure against SCORM schema',
          'Ensure all referenced resources exist'
        ]
      });
      throw error; // Re-throw for normal error handling
    }
  }
}

// In app-manager.js (UI errors)
class AppManager {
  handleRenderError(error, componentName) {
    ErrorHandler.handleError(error, {
      source: ERROR_SOURCE.APP,
      category: ERROR_CATEGORY.UI,
      component: componentName,
      severity: 'medium',
      userActionable: false // User can't fix app UI bugs
    });
    
    // Show user-friendly error notification
    this.uiState.showNotification({
      type: 'error',
      message: 'A display issue occurred. Please check the logs.',
      duration: 5000
    });
  }
}
```

#### **SCORM Inspector Error Tab**

The SCORM Inspector gets a new **"Errors"** tab that shows:

```javascript
class ScormInspectorErrorsView {
  renderErrors() {
    return `
      <div class="errors-view">
        <div class="error-filters">
          <button data-filter="scorm">SCORM Issues (${this.scormErrors.length})</button>
          <button data-filter="ambiguous">Needs Investigation (${this.ambiguousErrors.length})</button>
        </div>
        
        <div class="error-list">
          ${this.renderErrorList()}
        </div>
      </div>
    `;
  }
  
  renderErrorItem(error) {
    return `
      <div class="error-item error-item--${error.severity}">
        <div class="error-header">
          <span class="error-category">${error.category}</span>
          <span class="error-time">${this.formatTime(error.timestamp)}</span>
          <span class="error-severity error-severity--${error.severity}">${error.severity}</span>
        </div>
        
        <div class="error-message">${error.message}</div>
        
        ${error.troubleshootingSteps ? `
          <div class="error-troubleshooting">
            <h4>Troubleshooting Steps:</h4>
            <ul>
              ${error.troubleshootingSteps.map(step => `<li>${step}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
        
        ${error.source === 'ambiguous' ? `
          <div class="error-investigation">
            <p><strong>This error needs investigation:</strong></p>
            <p>It could be caused by the SCORM package or the application. 
               Check both the SCORM Inspector and app logs for more details.</p>
          </div>
        ` : ''}
      </div>
    `;
  }
}
```

#### **Real-World Error Examples**

**Clear SCORM Package Issue**:
```javascript
// User loads broken SCORM package
SetValue('cmi.completion_status', 'finished') // Invalid value
→ ErrorHandler classifies as: { source: 'scorm', category: 'scorm-api' }
→ Shows in SCORM Inspector with troubleshooting steps
→ Also logged to app.log for development analysis
```

**Clear App Issue**:
```javascript  
// App fails to read configuration
fs.readFile('/invalid/path/config.json')
→ ErrorHandler classifies as: { source: 'app', category: 'system' }
→ Shows app error notification to user
→ Logged to app.log with full stack trace
→ NOT shown in SCORM Inspector
```

**Ambiguous Issue**:
```javascript
// Content fails to load - could be network, app bug, or bad content URL
fetch('http://invalid-scorm-content.com/course.html')
→ ErrorHandler classifies as: { source: 'ambiguous', category: 'runtime' }
→ Shows in BOTH SCORM Inspector AND app notifications
→ Provides investigation guidance to user
→ Full technical details in app.log
```

## API Contracts

### SCORM Inspection Data Structure
```javascript
{
  method: string,        // SCORM API method name
  params: array,         // Method parameters
  result: any,          // Method return value
  errorCode: string,     // SCORM error code
  timestamp: number,     // Unix timestamp (ms)
  sessionId: string,     // SCORM session identifier
  durationMs: number     // Call duration in milliseconds
}
```

### IPC Channels
```javascript
// Real-time SCORM updates
'scorm-inspector-data-updated' → { method, params, result, errorCode, timestamp, sessionId, durationMs }

// SCORM history requests
'scorm-inspector-get-history' ← { limit?, offset?, sinceTs?, methodFilter? }
'scorm-inspector-get-history' → { success: boolean, history: Array, total: number }
```

## Migration from Current Architecture

### Before (Confused Terminology)
```
"Debug Window" (actually SCORM inspection) + App debugging mixed together
```

### After (Clear Separation)
```
SCORM Inspector (for content issues) + App Debug Logging (for app issues) - SEPARATE SYSTEMS
```

## Testing Strategy

### Unit Tests
- `scorm-inspector-telemetry-store.js` store/broadcast functionality
- `ScormInspectorPanel` SCORM data display and history loading
- IPC channel message handling for SCORM data

### Integration Tests
- End-to-end SCORM API call → SCORM Inspector UI display flow
- Multiple window SCORM data consistency
- SCORM history loading on inspector window open

### Performance Tests
- Memory usage with large SCORM histories
- UI responsiveness with high SCORM API call frequency
- IPC message throughput for SCORM data

## Troubleshooting

### Common Issues
1. **SCORM data not appearing**: Check `scorm-inspector-telemetry-store.js` broadcast method
2. **Duplicate SCORM data**: Look for remaining event emitters outside single path
3. **Memory leaks**: Verify ring buffer trimming in telemetry store
4. **Slow UI updates**: Check for synchronous operations in display code

### SCORM Inspector Commands
```javascript
// In main process console
scormInspectorTelemetryStore.getHistory({ limit: 10 })

// In renderer console  
window.electronAPI.invoke('scorm-inspector-get-history', { limit: 5 })
```

---

**This architecture is the ONLY approved approach for SCORM package inspection data flow. All implementations must follow this pattern and maintain the critical distinction between app debugging and SCORM content inspection.**