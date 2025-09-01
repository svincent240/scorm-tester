# Bug Log

## BUG-001: Missing ContentViewer.loadActivity Method
**Severity**: Critical | **Status**: Open | **Priority**: P1

**Problem**: AppManager calls `contentViewer.loadActivity(activityObject)` but method doesn't exist

**Location**: `src/renderer/services/app-manager.js:388-389`
```javascript
// Line 388-389: Method call that fails
this.contentViewer.loadActivity(activityObject); // ERROR: Method doesn't exist
```

**Expected vs Actual**:
- Expected: ContentViewer has `loadActivity(activityObject)` method to handle SN navigation
- Actual: ContentViewer only has `loadContent(url, scormData)` method

**Impact**: 
- All SN (Sequencing & Navigation) based course navigation fails
- Users see navigation UI updates but content area remains blank
- Critical path failure - renders SN functionality completely broken

**Error Pattern**:
```
TypeError: this.contentViewer.loadActivity is not a function
    at AppManager.handleNavigationRequest (app-manager.js:389)
```

**Potential Solutions**:
1. **Add loadActivity method to ContentViewer**: Create new method that accepts activityObject and extracts URL
2. **Modify AppManager**: Convert activityObject to URL/scormData format and use existing loadContent method
3. **Create adapter layer**: Add translation between SN activity objects and ContentViewer format

**Dependencies**: 
- Must understand activityObject structure from SN service
- Need to maintain compatibility with existing loadContent usage
- Should preserve SCORM data context during conversion

---

## BUG-002: Orphaned activityLaunchRequested Event  
**Severity**: High | **Status**: Open | **Priority**: P1

**Problem**: NavigationControls emits `activityLaunchRequested` but no component subscribes to handle it

**Location**: `src/renderer/components/scorm/navigation-controls.js:530`
```javascript
// Line 530: Event emission with no subscribers
eventBus.emit('activityLaunchRequested', {
  activityId: this.currentActivity.id,
  activityObject: this.currentActivity
});
```

**Event Flow Breakdown**:
1. User clicks navigation button in NavigationControls
2. NavigationControls emits `activityLaunchRequested` event
3. **MISSING**: No component listening for this event
4. ContentViewer never receives instruction to load new content
5. UI shows navigation occurred, but content area unchanged

**Impact**: 
- Silent failure - navigation appears successful but content doesn't load
- User confusion - UI indicates success but no visible content change
- Breaks user workflow - must manually refresh or use alternative navigation

**Current Event Subscribers**:
```javascript
// AppManager listens to:
- 'navigationRequest'
- 'sequencingRequest'
// But NOT 'activityLaunchRequested'
```

**Missing Integration Points**:
1. ContentViewer should subscribe to `activityLaunchRequested`
2. Or AppManager should relay event to ContentViewer
3. Or use existing `navigationRequest` event instead

**Suggested Fix**:
```javascript
// In ContentViewer constructor or AppManager
eventBus.on('activityLaunchRequested', (data) => {
  this.loadActivity(data.activityObject); // Requires BUG-001 fix
});
```

---

## BUG-003: Dual Navigation Processing Paths
**Severity**: High | **Status**: Open | **Priority**: P2

**Problem**: AppManager has two different navigation handling paths that can execute simultaneously, causing race conditions and inconsistent state

**Location**: `src/renderer/services/app-manager.js:291-403`

**Conflicting Paths Identified**:
1. **Path A - Direct Navigation** (lines 291-332):
   ```javascript
   handleNavigationRequest(data) {
     // Direct content loading path
     this.contentViewer.loadContent(url, scormData);
   }
   ```

2. **Path B - SN Service Navigation** (lines 366-403):
   ```javascript
   handleSequencingRequest(data) {
     // Goes through SN service first
     snService.processNavigation().then(result => {
       this.contentViewer.loadActivity(result.activity); // BUG-001
     });
   }
   ```

**Race Condition Scenarios**:
- User rapidly clicks navigation buttons
- Both paths execute simultaneously
- ContentViewer receives conflicting load instructions
- State becomes inconsistent between UI and SCORM data

**Observable Symptoms**:
- Content loads incorrectly or incompletely
- Navigation history becomes corrupted
- SCORM tracking data inconsistencies
- UI state doesn't match actual content state

**Current Navigation Triggers**:
```javascript
// Multiple event types trigger different paths:
eventBus.on('navigationRequest', handleNavigationRequest);     // Path A
eventBus.on('sequencingRequest', handleSequencingRequest);     // Path B
eventBus.on('activityLaunchRequested', ???);                  // BUG-002
```

**Impact Analysis**:
- High: Data corruption risk in SCORM tracking
- High: Unpredictable user experience
- Medium: Performance overhead from duplicate processing
- Medium: Debugging complexity due to non-deterministic behavior

**Consolidation Strategy**:
1. Create single `processNavigation()` method
2. Route all navigation events through unified entry point
3. Implement proper request queuing to prevent race conditions
4. Add navigation state locking during processing
5. Ensure consistent error handling across all navigation types

---

## BUG-004: SCORM Data Integration Disconnect
**Severity**: Medium | **Status**: Open | **Priority**: P3

**Problem**: SN service provides SCORM data integration methods but renderer-side navigation doesn't utilize them, breaking resume functionality and state synchronization

**Location**: `src/main/services/scorm/sn/index.js:580,607`

**Available but Unused Methods**:
```javascript
// Line 580: Activity location tracking
updateActivityLocation(activityId, location) {
  // Updates SCORM tracking data with current position
  // Used for resume functionality
}

// Line 607: Activity exit handling  
handleActivityExit(activityId, exitData) {
  // Processes completion status, score, time tracking
  // Critical for SCORM compliance
}
```

**Current Navigation Flow**:
1. User navigates to new activity
2. ContentViewer loads new content
3. **MISSING**: No call to `updateActivityLocation()`
4. **MISSING**: Previous activity exit not processed via `handleActivityExit()`
5. SCORM tracking data becomes stale/incorrect

**Broken Functionality**:

**Resume Issues**:
- Course doesn't remember user's last position
- Bookmark functionality non-functional
- Progress tracking incomplete

**SCORM Compliance Issues**:
- Activity completion status not updated
- Time tracking inaccurate
- Score persistence broken
- Suspend data not synchronized

**Integration Points Missing**:
```javascript
// Should be added to navigation process:

// Before loading new activity:
await snService.handleActivityExit(currentActivityId, {
  completionStatus: 'completed',
  score: getCurrentScore(),
  timeSpent: getSessionTime()
});

// After loading new activity:
await snService.updateActivityLocation(newActivityId, {
  bookmark: getCurrentLocation(),
  timestamp: Date.now()
});
```

**Data Flow Requirements**:
- ContentViewer must notify SN service of activity changes
- AppManager must coordinate SCORM data updates during navigation
- Error handling needed for SCORM API failures
- Async handling required to prevent navigation blocking

---

## BUG-005: Browse Mode State Desynchronization
**Severity**: Medium | **Status**: Open | **Priority**: P3

**Problem**: Browse mode state is managed inconsistently across multiple components, leading to desynchronization and unreliable browse mode functionality

**Affected Components**:
- `src/renderer/components/scorm/navigation-controls.js` - Has local browse mode toggle
- `src/renderer/services/app-manager.js` - Maintains separate browse mode state
- `src/renderer/components/scorm/course-outline.js` - Assumes browse mode from props
- `src/renderer/services/ui-state-service.js` - Should be central state manager

**Current State Management Issues**:

**NavigationControls**:
```javascript
// Local state management
this.browseMode = false;
toggleBrowseMode() {
  this.browseMode = !this.browseMode; // Only updates local state
  // Missing: Global state synchronization
}
```

**AppManager**:
```javascript
// Separate browse mode tracking
this.currentBrowseMode = false;
// May conflict with NavigationControls state
```

**Desynchronization Scenarios**:
1. User toggles browse mode in NavigationControls
2. NavigationControls updates local state
3. AppManager doesn't receive update notification
4. CourseOutline continues using old browse mode state
5. Navigation behavior becomes inconsistent

**Observable Symptoms**:
- Browse mode toggle appears to work but navigation behavior doesn't change
- Some UI elements show browse mode active, others don't
- Sequencing restrictions apply inconsistently
- Course outline clickability doesn't match browse mode state

**State Propagation Issues**:
```javascript
// Current event flow is incomplete:
NavigationControls.toggleBrowseMode() {
  this.browseMode = !this.browseMode;
  // Missing: eventBus.emit('browseModeChanged', this.browseMode);
}

// Other components don't listen for browse mode changes
// AppManager, CourseOutline have stale state
```

**Impact on User Experience**:
- Confusing behavior - UI doesn't match functionality
- Browse mode appears broken or unreliable
- Users may get stuck in wrong navigation mode
- SCORM sequencing rules apply incorrectly

**Centralization Requirements**:
1. Move browse mode state to UIStateService
2. All components subscribe to browse mode changes
3. Single source of truth for browse mode status
4. Consistent event-driven state updates
5. Proper state persistence across navigation

---

## BUG-006: Broken Fallback Recovery System
**Severity**: Medium | **Status**: Open | **Priority**: P4

**Problem**: When SN (Sequencing & Navigation) service becomes unavailable, the fallback navigation system fails, leaving users with no navigation options

**Location**: `src/renderer/services/app-manager.js:308-332`

**Current Fallback Logic**:
```javascript
// Lines 308-332: Fallback attempt
try {
  const result = await this.snService.processNavigation(data);
  // Process SN result
} catch (error) {
  console.warn('SN service unavailable, using fallback');
  // Fallback logic here is incomplete/broken
  this.handleDirectNavigation(data); // Method doesn't integrate properly
}
```

**Fallback Failure Points**:

**1. Incomplete Fallback Implementation**:
```javascript
handleDirectNavigation(data) {
  // Missing: Activity validation
  // Missing: SCORM data preparation
  // Missing: ContentViewer integration (BUG-001)
  this.contentViewer.loadActivity(data); // Fails - method doesn't exist
}
```

**2. Missing SN Service Detection**:
- No health check for SN service availability
- No graceful degradation strategy
- Hard failure when SN service is down

**3. Inconsistent Navigation Modes**:
- SN mode: Full sequencing, restrictions, tracking
- Fallback mode: Basic navigation, no restrictions
- User experience completely different between modes

**Scenarios Causing SN Unavailability**:
- Main process communication failure
- SCORM package parsing errors
- Sequencing engine crashes
- Memory/resource constraints
- Corrupted navigation data

**Current Impact**:
- Complete navigation failure when SN unavailable
- No error recovery mechanism
- User stuck on current content with no navigation options
- Application appears frozen or broken

**Required Fallback Features**:

**1. Service Health Monitoring**:
```javascript
// Periodic SN service health check
checkSNServiceHealth() {
  // Test SN service responsiveness
  // Switch to fallback mode if unhealthy
}
```

**2. Graceful Degradation**:
```javascript
// Fallback navigation with basic functionality
fallbackNavigation(data) {
  // Simple content loading without sequencing
  // Basic progress tracking
  // User notification about limited functionality
}
```

**3. Recovery Mechanism**:
- Attempt SN service reconnection
- Migrate from fallback to full SN when available
- Preserve user progress during mode transitions

**4. User Communication**:
- Clear indication when in fallback mode
- Explanation of limited functionality
- Option to retry full navigation mode

---

## BUG-007: Missing ContentViewer Event Integration
**Severity**: Medium | **Status**: Open | **Priority**: P1

**Problem**: ContentViewer component lacks event subscriptions for navigation events, breaking the navigation → content loading chain and requiring other components to directly call ContentViewer methods

**Location**: `src/renderer/components/scorm/content-viewer.js`

**Missing Event Subscriptions**:
```javascript
// ContentViewer constructor should have:
eventBus.on('activityLaunchRequested', this.handleActivityLaunch.bind(this));
eventBus.on('contentLoadRequested', this.handleContentLoad.bind(this));
eventBus.on('navigationCompleted', this.handleNavigationUpdate.bind(this));
// But these subscriptions don't exist
```

**Current Architecture Problems**:

**1. Tight Coupling**:
```javascript
// AppManager directly calls ContentViewer methods
this.contentViewer.loadContent(url, scormData);     // Direct coupling
this.contentViewer.loadActivity(activityObject);   // BUG-001 - method missing
```

**2. Event Chain Breaks**:
```
User Action → NavigationControls → Event Bus → ??? → ContentViewer
                                      ↑
                              Missing subscriber
```

**3. No Event-Driven Architecture**:
- ContentViewer can't respond to events independently
- Other components must maintain references to ContentViewer
- Difficult to test navigation in isolation

**Event Integration Requirements**:

**Navigation Events to Handle**:
```javascript
// Should subscribe to these events:
'activityLaunchRequested' // From NavigationControls (BUG-002)
'contentLoadRequested'    // From AppManager/CourseOutline
'browseMode'              // From state changes (BUG-005)
'sequencingCompleted'     // From SN service results
'navigationError'         // For error handling
```

**Missing Event Handlers**:
```javascript
// These methods need to be implemented:
handleActivityLaunch(eventData) {
  // Process activity object and load content
  // Integrate with SCORM data
}

handleContentLoad(eventData) {
  // Load content with proper SCORM context
  // Handle loading states and errors
}

handleNavigationUpdate(eventData) {
  // Update content viewer state
  // Sync with navigation changes
}
```

**Benefits of Event Integration**:

**1. Loose Coupling**:
- Components communicate through events only
- ContentViewer becomes independently testable
- Easier to modify navigation logic

**2. Consistent Event Flow**:
```
User Action → NavigationControls → Event Bus → ContentViewer
                                              → AppManager  
                                              → Other Components
```

**3. Better Error Handling**:
- ContentViewer can emit loading errors
- Other components can respond to content failures
- Centralized error event handling

**4. State Synchronization**:
- ContentViewer always reflects current navigation state
- Automatic updates when navigation changes
- No manual synchronization required

---

## BUG-008: SCORM Service Method Name Error
**Severity**: Critical | **Status**: Open

**Problem**: `createSessionWithBrowseMode` calls `this.createSession()` but method is named `initializeSession()`
**Location**: `src/main/services/scorm-service.js:1369`
**Impact**: Runtime error when creating sessions with browse mode
**Fix**: Change `this.createSession()` to `this.initializeSession(options)`

---

## BUG-009: Data Model Access Bug in getCurrentDataModel
**Severity**: Critical | **Status**: Open

**Problem**: `getCurrentDataModel()` uses wrong property names and data access patterns
**Location**: `src/main/services/scorm-service.js:1244-1245, 1253-1257`
**Impact**: Method returns empty object instead of actual data model, breaking inspector functionality
**Fix**: Use `lastActivity` instead of `lastAccessTime`, access RTE instance from `this.rteInstances.get(sessionId)`

---

## BUG-010: Rate Limiter Logger Bug
**Severity**: Medium | **Status**: Open

**Problem**: RateLimiter uses `this._logger` which is never initialized
**Location**: `src/main/services/ipc/rate-limiter.js:111, 115-116`
**Impact**: Logging failures in rate limiting, reduced observability
**Fix**: Use `this.logger` or accept logger parameter in constructor
\n+---\n+\n+## BUG-011: IPC RateLimiter Import Path Error\n+**Severity**: High | **Status**: Open | **Priority**: P1\n+\n+**Problem**: `IpcHandler` falls back to requiring a local RateLimiter using `require('./rate-limiter')`, but the file is located under `./ipc/rate-limiter.js`.\n+\n+**Location**: `src/main/services/ipc-handler.js` (around line 160)\n+```javascript\n+// Current (incorrect)\n+const RateLimiter = require('./rate-limiter');\n+\n+// Correct\n+const RateLimiter = require('./ipc/rate-limiter');\n+```\n+\n+**Impact**: When no external rateLimiter is injected, the fallback import throws at runtime, preventing IPC handlers from initializing and breaking renderer ↔ main communication.\n+\n+**Fix**: Update the require path to `./ipc/rate-limiter`. Add a unit test to cover fallback initialization.\n+\n+---\n+\n+## BUG-012: Custom Protocol Registration Misinterprets Return Value\n+**Severity**: Critical | **Status**: Open | **Priority**: P1\n+\n+**Problem**: `WindowManager.registerCustomProtocol()` treats `protocol.registerFileProtocol(...)` as returning a boolean. Electron’s API returns `void` and throws on error. The code then throws a false failure.\n+\n+**Location**: `src/main/services/window-manager.js` (`registerCustomProtocol`)\n+```javascript\n+// Current (incorrect)\n+const success = protocol.registerFileProtocol('scorm-app', handler);\n+if (success) { ... } else { throw new Error('Failed...'); }\n+\n+// Suggested\n+protocol.registerFileProtocol('scorm-app', handler);\n+this.protocolRegistered = true;\n+// Optionally verify\n+// if (!protocol.isProtocolRegistered('scorm-app')) throw new Error('Failed...');\n+```\n+\n+**Impact**: Protocol setup appears to fail and can break window loading (`loadURL('scorm-app://app/index.html')`).\n+\n+**Fix**: Remove boolean check; set `protocolRegistered = true` after call and rely on thrown exceptions for failure. Optionally verify with `protocol.isProtocolRegistered`.\n+\n+---\n+\n+## BUG-013: Build Script References Missing `test:phase6`\n+**Severity**: Medium | **Status**: Open | **Priority**: P2\n+\n+**Problem**: `package.json` script `build:validate` includes `npm run test:phase6`, but no such script exists.\n+\n+**Location**: `package.json` → `scripts.build:validate`\n+\n+**Impact**: Any `build*` script fails immediately, blocking packaging.\n+\n+**Fix**: Remove `&& npm run test:phase6` from `build:validate`, or add a real `test:phase6` script.\n+\n+---\n+\n+## BUG-014: Jest and JSDOM Version Mismatch\n+**Severity**: Medium | **Status**: Open | **Priority**: P3\n+\n+**Problem**: `jest` is pinned to `^29.7.0` while `jest-environment-jsdom` is `^30.0.5`.\n+\n+**Location**: `package.json` → `devDependencies`\n+\n+**Impact**: Tests may error at startup due to incompatible versions.\n+\n+**Fix**: Align versions (either upgrade Jest to `^30.x` or downgrade `jest-environment-jsdom` to `^29.x`).\n+\n+---\n+\n+## BUG-015: Service Worker Messaging and Cache Mismatch\n+**Severity**: Low | **Status**: Open | **Priority**: P4\n+\n+**Problem**:\n+- The service worker uses `self.postMessage(...)`, which doesn’t reach clients.\n+- `urlsToCache` uses `file` paths (e.g., `/src/renderer/app.js`), but the app loads assets via the custom `scorm-app://` scheme.\n+\n+**Location**: `sw.js`\n+\n+**Impact**: Console mirroring and caching don’t work; logs never appear in the app and cache entries rarely match.\n+\n+**Fix**:\n+- Send messages to all clients:\n+```javascript\n+self.clients.matchAll().then(cs => cs.forEach(c => c.postMessage({ type, level, message, data })));\n+```\n+- Either remove the hardcoded cache list or rework strategy to account for the `scorm-app://` scheme (Electron SW support for custom schemes is limited).\n+\n+---\n+\n+## BUG-016: Duplicate `onScormInspectorDataUpdated` in Preload\n+**Severity**: Low | **Status**: Open | **Priority**: P4\n+\n+**Problem**: `electronAPI` defines `onScormInspectorDataUpdated` twice in `src/preload.js`.\n+\n+**Location**: `src/preload.js` (two duplicate keys)\n+\n+**Impact**: No functional break (last wins), but it’s confusing and error-prone.\n+\n+**Fix**: Remove the duplicate export to keep a single definition.\n+
