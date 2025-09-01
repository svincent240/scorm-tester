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

**🔗 Related Bugs**: This bug is part of the **Navigation System Core** cluster:
- **BUG-002**: Creates orphaned events that should trigger this method
- **BUG-003**: Navigation pipeline needs unified activity processing
- **BUG-007**: ContentViewer needs event integration to receive activity objects

**Improved Solution Strategy**:
1. **✅ Add `loadActivity(activityObject)` method to ContentViewer**: 
   - Extract SCORM-compliant data: `launch_data`, `mastery_score`, `max_time_allowed`, etc.
   - Validate activity object contains required SCORM 2004 elements
   - Extract `identifierref` from activity and resolve to resource URL
   - Maintain backward compatibility with existing `loadContent(url, scormData)`

2. **🔧 SCORM 2004 Compliance Requirements**:
   - Activity object must conform to SCORM Activity Tree structure
   - Must contain valid `item` elements with `identifierref` pointing to resources
   - Respect sequencing constraints during activity loading

**Dependencies**: 
- **Prerequisites**: Must be implemented alongside BUG-007 (event integration)
- **Follows**: BUG-002 and BUG-003 fixes provide the unified event pipeline
- **Integration**: Works with BUG-004 SCORM lifecycle integration

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

**🔗 Related Bugs**: This bug is part of the **Navigation System Core** cluster:
- **BUG-001**: The missing `loadActivity` method this event should trigger
- **BUG-003**: Part of the dual navigation path problem
- **BUG-007**: ContentViewer needs event subscriptions to receive these events

**Improved Solution Strategy**:
**❌ Avoid Event Fragmentation**: Don't create another event handler for `activityLaunchRequested`

**✅ Consolidate to Unified Events**:
1. **Use existing `navigationRequest` event** instead of `activityLaunchRequested`
2. **Standardize event payload**: All navigation events use: `{activityId, activityObject, requestType, source}`
3. **Single event handler pattern**: Route all navigation through `AppManager.handleNavigationRequest()`
4. **Request type differentiation**: Use `requestType: 'activityLaunch'` to distinguish from other navigation

**Event Consolidation**:
```javascript
// Replace activityLaunchRequested with:
eventBus.emit('navigationRequest', {
  activityId: this.currentActivity.id,
  activityObject: this.currentActivity,
  requestType: 'activityLaunch',
  source: 'NavigationControls'
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

**🔗 Related Bugs**: This bug is the **core architectural issue** in the Navigation System Core cluster:
- **BUG-001**: Needs unified activity processing through single pipeline
- **BUG-002**: Event consolidation eliminates orphaned events
- **BUG-007**: ContentViewer integration completes the unified architecture

**Enhanced Consolidation Strategy**:
1. **✅ Navigation State Machine**: Implement proper state management:
   - States: `IDLE`, `PROCESSING`, `LOADING`
   - Prevent new navigation requests during processing
   - Queue navigation requests when busy

2. **✅ Unified Processing Pipeline**: Single `processNavigationRequest(data)` method:
   - Validates current navigation state
   - Determines if SN (Sequencing & Navigation) processing needed
   - Routes through appropriate path (SN service vs direct)
   - Updates navigation state consistently

3. **✅ SCORM 2004 Compliance**: 
   - Respect sequencing rules - don't allow navigation when `choice` is disabled
   - Maintain activity tree integrity during navigation
   - Enforce prerequisite and post-condition rules

4. **✅ Request Queuing Strategy**:
   ```javascript
   processNavigationRequest(data) {
     if (this.navigationState === 'PROCESSING') {
       this.navigationQueue.push(data);
       return;
     }
     // Process immediately...
   }
   ```

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

**🔗 Related Bugs**: This bug is part of the **SCORM Integration Chain**:
- **BUG-008**: Method name error must be fixed first (prerequisite)
- **BUG-009**: Data model access must work for tracking (prerequisite)
- **Depends on**: Navigation System Core (BUG-001/002/003/007) for integration points

**Enhanced Integration Strategy**:
**✅ Navigation Lifecycle Hooks**: Integrate SCORM tracking into unified navigation pipeline:
```javascript
// In the unified processNavigationRequest method:
async processNavigationRequest(data) {
  // Before loading new activity:
  if (this.currentActivity) {
    await this.handleActivityExit(this.currentActivity.id);
  }
  
  // Process navigation...
  
  // After loading new activity:
  await this.updateActivityLocation(data.activityId);
}
```

**✅ Async Error Handling**: Handle SCORM API errors gracefully:
- Never block navigation due to SCORM API failures
- Log tracking errors but continue navigation
- Retry tracking operations in background

**✅ State Persistence Priority**:
- Persist suspend data before navigation even if API calls fail
- Batch SCORM updates to prevent UI blocking
- Maintain data consistency across navigation failures

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

**🔗 Related Bugs**: This bug connects to the **Navigation System Core**:
- **BUG-003**: Browse mode state affects navigation pipeline behavior
- **BUG-007**: ContentViewer needs browse mode state for content loading

**✅ Simplified Solution Strategy** (Avoid Over-Engineering):
**❌ Don't Create UIStateService**: Use existing event bus pattern instead

**✅ Centralized State Management**:
1. **Single Source of Truth**: Move browse mode state to **AppManager** (already manages navigation state)
2. **Event-Driven Updates**: Use `browseModeChanged` event with payload: `{enabled: boolean}`
3. **Component Subscription**: Components subscribe to browse mode changes, don't maintain local state
4. **Integration with Navigation**: Browse mode state integrated into unified navigation pipeline

**SCORM Compliance Integration**:
- **Browse Mode ON**: Allow free navigation, ignore sequencing constraints
- **Browse Mode OFF**: Enforce SCORM 2004 sequencing rules and prerequisites

```javascript
// In AppManager:
toggleBrowseMode(enabled) {
  this.browseMode = enabled;
  eventBus.emit('browseModeChanged', { enabled });
  // Update navigation constraints based on browse mode
}
```

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

**🔗 Related Bugs**: This bug integrates with the **Navigation System Core**:
- **BUG-001**: Fallback system needs `loadActivity` method for direct navigation
- **BUG-003**: Part of the unified navigation pipeline architecture

**✅ Simplified Solution Strategy** (Avoid Over-Engineering):
**❌ Don't Create Complex Health Monitoring**: Use simple try/catch pattern

**✅ Streamlined Fallback System**:
1. **Simple Try/Catch Pattern**: When SN service fails, fall back to direct content loading
2. **Graceful Degradation**: Direct navigation without sequencing constraints
3. **User Communication**: Simple notification: "Advanced navigation unavailable, using basic mode"
4. **Integration**: Use new `loadActivity()` method (from BUG-001) for fallback navigation

**SCORM Compliance in Fallback**:
- **Disable Sequencing**: Remove sequencing constraints in fallback mode
- **Maintain Basic SCORM API**: Keep basic SCORM API functionality working
- **Progress Tracking**: Continue basic progress tracking without advanced sequencing

```javascript
// Simplified fallback in unified navigation pipeline:
try {
  const result = await this.snService.processNavigation(data);
  // Process SN result
} catch (error) {
  console.warn('SN service unavailable, using basic navigation');
  this.loadActivityDirect(data.activityObject); // Uses BUG-001 fix
  this.showFallbackNotification();
}
```

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

**🔗 Related Bugs**: This bug **completes the Navigation System Core** architecture:
- **BUG-001**: ContentViewer needs `loadActivity` method to handle activity objects
- **BUG-002**: Needs event subscriptions to receive consolidated navigation events
- **BUG-003**: Part of the unified navigation pipeline architecture

**Enhanced Event Integration Strategy**:
**❌ Avoid Multiple Event Types**: Don't subscribe to multiple different navigation events

**✅ Unified Event Handling**: ContentViewer subscribes to single `navigationRequest` event:
```javascript
// In ContentViewer constructor:
eventBus.on('navigationRequest', this.handleNavigationRequest.bind(this));

handleNavigationRequest(eventData) {
  const { activityObject, requestType, source } = eventData;
  
  switch (requestType) {
    case 'activityLaunch':
      this.loadActivity(activityObject); // From BUG-001 fix
      break;
    case 'directContent':
      this.loadContent(eventData.url, eventData.scormData);
      break;
    // Handle other request types...
  }
}
```

**✅ Error Propagation**: ContentViewer emits loading errors back to event bus:
```javascript
// On loading errors:
eventBus.emit('navigationError', {
  error: loadingError,
  activityId: eventData.activityId,
  source: 'ContentViewer'
});
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

**🔗 Related Bugs**: This bug is part of the **SCORM Integration Chain**:
- **BUG-004**: Prerequisite for SCORM lifecycle integration
- **BUG-009**: Related to SCORM service method access patterns

**Problem**: `createSessionWithBrowseMode` calls `this.createSession()` but method is named `initializeSession()`
**Location**: `src/main/services/scorm-service.js:1369`
**Impact**: Runtime error when creating sessions with browse mode

**✅ Validated Fix**: Change `this.createSession()` to `this.initializeSession(options)`
**⚠️ Additional Verification**: Ensure `initializeSession()` accepts the same parameters that were being passed to the non-existent `createSession()`

---

## BUG-009: Data Model Access Bug in getCurrentDataModel
**Severity**: Critical | **Status**: Open

**🔗 Related Bugs**: This bug is part of the **SCORM Integration Chain**:
- **BUG-004**: Prerequisite for proper SCORM data tracking
- **BUG-008**: Related to SCORM service method access patterns

**Problem**: `getCurrentDataModel()` uses wrong property names and data access patterns
**Location**: `src/main/services/scorm-service.js:1244-1245, 1253-1257`
**Impact**: Method returns empty object instead of actual data model, breaking inspector functionality

**✅ Enhanced Fix Strategy**:
1. **Correct Property Access**: Use `lastActivity` instead of `lastAccessTime`
2. **Correct RTE Access**: Access RTE from `this.rteInstances.get(sessionId)`
3. **SCORM 2004 Compliance**: Verify data model includes all 15 required SCORM data elements
4. **Null Safety**: Add proper null checks for missing sessions/RTE instances
5. **Performance**: Consider caching frequently accessed data model elements

**Data Model Structure Validation**: Must include proper hierarchical structure per SCORM 2004 4th Edition specification

---

## BUG-010: Rate Limiter Logger Bug
**Severity**: Medium | **Status**: Open

**🔗 Related Bugs**: Independent infrastructure fix

**Problem**: RateLimiter uses `this._logger` which is never initialized
**Location**: `src/main/services/ipc/rate-limiter.js:111, 115-116`
**Impact**: Logging failures in rate limiting, reduced observability

**✅ Simple Fix**: Change `this._logger` to `this.logger` throughout the file

---

## BUG-011: IPC RateLimiter Import Path Error
**Severity**: High | **Status**: Open | **Priority**: P1

**🔗 Related Bugs**: Independent infrastructure fix (Critical for IPC communication)

**Problem**: `IpcHandler` falls back to requiring a local RateLimiter using `require('./rate-limiter')`, but the file is located under `./ipc/rate-limiter.js`.

**Location**: `src/main/services/ipc-handler.js` (around line 160)
```javascript
// Current (incorrect)
const RateLimiter = require('./rate-limiter');

// Correct
const RateLimiter = require('./ipc/rate-limiter');
```

**Impact**: When no external rateLimiter is injected, the fallback import throws at runtime, preventing IPC handlers from initializing and breaking renderer ↔ main communication.

**✅ Critical Fix**: Update the require path to `./ipc/rate-limiter`
**✅ Additional**: Add unit test to cover fallback initialization

---

## BUG-012: Custom Protocol Registration Misinterprets Return Value
**Severity**: Critical | **Status**: Open | **Priority**: P1

**🔗 Related Bugs**: Independent infrastructure fix (Critical for app loading)

**Problem**: `WindowManager.registerCustomProtocol()` treats `protocol.registerFileProtocol(...)` as returning a boolean. Electron's API returns `void` and throws on error. The code then throws a false failure.

**Location**: `src/main/services/window-manager.js` (`registerCustomProtocol`)
```javascript
// Current (incorrect)
const success = protocol.registerFileProtocol('scorm-app', handler);
if (success) { ... } else { throw new Error('Failed...'); }

// Correct
protocol.registerFileProtocol('scorm-app', handler);
this.protocolRegistered = true;
// Optionally verify
// if (!protocol.isProtocolRegistered('scorm-app')) throw new Error('Failed...');
```

**Impact**: Protocol setup appears to fail and can break window loading (`loadURL('scorm-app://app/index.html')`).

**✅ Validated Fix**: Remove boolean check; set `protocolRegistered = true` after call and rely on thrown exceptions for failure. Optionally verify with `protocol.isProtocolRegistered`.

---

## BUG-013: Build Script References Missing `test:phase6`
**Severity**: Medium | **Status**: Open | **Priority**: P2

**🔗 Related Bugs**: Independent infrastructure fix (Critical for builds)

**Problem**: `package.json` script `build:validate` includes `npm run test:phase6`, but no such script exists.

**Location**: `package.json` → `scripts.build:validate`

**Impact**: Any `build*` script fails immediately, blocking packaging.

**✅ Simple Fix**: Remove `&& npm run test:phase6` from `build:validate`

---

## BUG-014: Jest and JSDOM Version Mismatch
**Severity**: Medium | **Status**: Open | **Priority**: P3

**🔗 Related Bugs**: Independent infrastructure fix (Critical for test stability)

**Problem**: `jest` is pinned to `^29.7.0` while `jest-environment-jsdom` is `^30.0.5`.

**Location**: `package.json` → `devDependencies`

**Impact**: Tests may error at startup due to incompatible versions.

**✅ Validated Fix**: Align versions - either upgrade Jest to `^30.x` or downgrade `jest-environment-jsdom` to `^29.x`

---

## BUG-015: Service Worker Messaging and Cache Mismatch
**Severity**: Low | **Status**: Open | **Priority**: P4

**🔗 Related Bugs**: Independent infrastructure fix (Consider removal)

**Problem**:
- The service worker uses `self.postMessage(...)`, which doesn't reach clients.
- `urlsToCache` uses `file` paths (e.g., `/src/renderer/app.js`), but the app loads assets via the custom `scorm-app://` scheme.

**Location**: `sw.js`

**Impact**: Console mirroring and caching don't work; logs never appear in the app and cache entries rarely match.

**✅ Alternative Approach**: Given complexity and limited benefit in Electron context, **consider removing service worker entirely** rather than fixing caching issues.

**If Keeping SW**:
- Send messages to all clients:
```javascript
self.clients.matchAll().then(cs => cs.forEach(c => c.postMessage({ type, level, message, data })));
```

---

## BUG-016: Duplicate `onScormInspectorDataUpdated` in Preload
**Severity**: Low | **Status**: Open | **Priority**: P4

**🔗 Related Bugs**: Independent infrastructure fix (Code cleanliness)

**Problem**: `electronAPI` defines `onScormInspectorDataUpdated` twice in `src/preload.js`.

**Location**: `src/preload.js` (two duplicate keys)

**Impact**: No functional break (last wins), but it's confusing and error-prone.

**✅ Simple Fix**: Remove the duplicate export to keep a single definition.

---

## BUG-017: Memory Leak - Uncleaned Session Cleanup Interval
**Severity**: Medium | **Status**: Open | **Priority**: P3

**🔗 Related Bugs**: Independent infrastructure fix (Critical for memory management)

**Problem**: ScormService creates a `setInterval()` for session cleanup in `setupSessionCleanup()` but never clears it in `doShutdown()`, causing a memory leak.

**Location**: `src/main/services/scorm-service.js:1035, doShutdown()`

**Impact**:
- Interval continues running after service shutdown
- Potential memory leak and resource waste
- May cause issues if service is restarted

**✅ Essential Fix**: Store the interval ID and clear it in `doShutdown()`:
```javascript
// In setupSessionCleanup():
this.sessionCleanupInterval = setInterval(() => {
  // ... cleanup logic
}, 60000);

// In doShutdown():
if (this.sessionCleanupInterval) {
  clearInterval(this.sessionCleanupInterval);
  this.sessionCleanupInterval = null;
}
```

---

# 🎯 BUG CONSOLIDATION STRATEGY

## Critical Bug Clusters & Implementation Phases

The 17 individual bugs identified above can be consolidated into **3 coherent fix phases** that minimize code changes while maximizing architectural improvements and maintaining SCORM 2004 4th Edition compliance.

### 🔴 **Phase 1: Navigation System Foundation** (HIGH PRIORITY)
**Bug Cluster**: Navigation System Core
- **BUG-001**: Missing ContentViewer.loadActivity Method → Add `loadActivity(activityObject)` method with SCORM compliance
- **BUG-007**: Missing ContentViewer Event Integration → Add event subscriptions for unified navigation
- **BUG-002**: Orphaned activityLaunchRequested Event → Consolidate to unified `navigationRequest` events
- **BUG-003**: Dual Navigation Processing Paths → Implement navigation state machine and request queuing
- **BUG-005**: Browse Mode State Desynchronization → Centralize browse mode in AppManager with event-driven updates

**🎯 Architectural Goal**: Create unified, event-driven navigation system with proper state management

**🔧 Key Implementation Principles**:
- Single navigation event type with standardized payload: `{activityId, activityObject, requestType, source}`
- Navigation state machine: `IDLE`, `PROCESSING`, `LOADING`
- Request queuing to prevent race conditions
- SCORM 2004 compliance with sequencing rule enforcement
- Event-driven architecture eliminating direct component coupling

### 🟡 **Phase 2: SCORM Integration** (MEDIUM PRIORITY)
**Bug Cluster**: SCORM Integration Chain  
- **BUG-008**: SCORM Service Method Name Error → Fix `createSession()` → `initializeSession()` call
- **BUG-009**: Data Model Access Bug → Fix property names and RTE instance access
- **BUG-004**: SCORM Data Integration Disconnect → Integrate lifecycle tracking into navigation pipeline

**🎯 Architectural Goal**: Complete SCORM lifecycle integration with navigation system

**📋 Dependencies**: Must be implemented **after** Phase 1 navigation foundation is complete

**🔧 Key Implementation Principles**:
- Integrate SCORM tracking hooks into unified navigation pipeline
- Async error handling that never blocks navigation
- Maintain all 15 required SCORM 2004 data elements
- State persistence priority over API call success

### 🟢 **Phase 3: Infrastructure & Polish** (LOW PRIORITY)
**Bug Cluster**: Independent Infrastructure Fixes
- **BUG-006**: Broken Fallback Recovery System → Simplified fallback with basic navigation
- **BUG-010**: Rate Limiter Logger Bug → Fix `this._logger` → `this.logger`
- **BUG-011**: IPC RateLimiter Import Path Error → Fix require path to `./ipc/rate-limiter`
- **BUG-012**: Custom Protocol Registration Error → Remove boolean check, use exception handling
- **BUG-013**: Build Script Missing test:phase6 → Remove reference to non-existent script
- **BUG-014**: Jest Version Mismatch → Align Jest and JSDOM versions
- **BUG-015**: Service Worker Issues → Consider removal vs fixing (low benefit in Electron)
- **BUG-016**: Duplicate Preload Export → Remove duplicate export
- **BUG-017**: Memory Leak - Session Cleanup → Store and clear interval ID in shutdown

**🎯 Architectural Goal**: Clean up infrastructure issues and improve maintainability

**⚡ Implementation Strategy**: These can be fixed in parallel with Phase 1 & 2 work as they are independent

## 📊 Implementation Priority Matrix

| Priority | Bugs | Impact | Complexity | Dependencies |
|----------|------|--------|------------|--------------|
| **P1 Critical** | BUG-001, 002, 003, 007 | Navigation completely broken | High | Foundation for others |
| **P1 Critical** | BUG-008, 009 | SCORM service failures | Low | Independent |
| **P1 Critical** | BUG-011, 012 | App won't start/load | Low | Independent |
| **P2 High** | BUG-004, 005 | SCORM compliance issues | Medium | Requires Phase 1 |
| **P2 High** | BUG-013, 017 | Build/memory issues | Low | Independent |
| **P3 Medium** | BUG-006, 014 | Fallback/testing issues | Medium | Independent |
| **P4 Low** | BUG-010, 015, 016 | Logging/cleanup issues | Low | Independent |

## 🔧 Architectural Principles for All Fixes

### **🎯 Simplicity Over Complexity**
- Avoid creating new services when existing patterns work
- Use event bus pattern consistently rather than direct method calls  
- Keep SCORM compliance without over-engineering architecture

### **🔄 Event-Driven Architecture**
- Single navigation event type with standardized payload structure
- Components communicate via events, not direct references
- Proper error propagation through event system
- Loose coupling between navigation components

### **📋 SCORM 2004 4th Edition Compliance**
- All fixes must maintain 100% SCORM compliance
- Navigation must respect sequencing rules and constraints
- Activity tracking and data model access must follow specification
- Browse mode integration with sequencing rule enforcement

### **⚡ Performance Considerations**
- Navigation state machine prevents race conditions
- Async SCORM calls never block UI interactions
- Proper memory cleanup in shutdown procedures  
- Request queuing for high-frequency navigation events

## 🚀 Expected Outcomes

**After Phase 1**: Unified navigation system with proper state management and event-driven architecture
**After Phase 2**: Complete SCORM lifecycle integration with 100% compliance maintained
**After Phase 3**: Clean, maintainable infrastructure with all critical issues resolved

This consolidation strategy transforms a complex 17-bug backlog into a manageable 3-phase implementation that maintains architectural coherence, ensures SCORM compliance, and avoids unnecessary complexity.
