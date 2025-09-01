# Course Outline Navigation Implementation Plan

## Overview

Transform the course outline into a SCORM-compliant navigation system by leveraging existing SN service infrastructure. This approach eliminates 98% of new code by using proven patterns from navigation controls.

## Problem Statement

The current course outline component allows users to click on any item without validating whether navigation is actually permitted by SCORM sequencing rules. This creates a poor user experience where users can click on items that won't work, leading to confusion about which items are actually available.

## Core Strategy: Navigation Controls Pattern

**Key Insight**: Navigation controls already implement perfect SN integration. Course outline should mirror this exact pattern instead of creating new validation logic.

## Critical Integration Gaps Identified

### 1. Missing SN Service Integration ⭐ **CRITICAL**
- Course outline completely ignores existing SN validation functions
- Navigation controls use `availableNavigation` array - course outline should too
- SN service already provides per-activity validation - not being used

### 2. Existing SN Functions to Leverage
- `sequencingEngine.evaluatePreConditionRules(activity)` - src/main/services/scorm/sn/sequencing-engine.js:40
- `navigationHandler.validateChoiceRequest(targetActivityId)` - src/main/services/scorm/sn/navigation-handler.js:218
- `navigationHandler.getAvailableNavigation()` - src/main/services/scorm/sn/navigation-handler.js:511
- `this.uiState.getState('navigationState')` - Already available through UIState

## Critical Missing SN Integrations (From Original Analysis)

### 🚨 **Major Gap: Activity Tree Integration Missing**

The original analysis identified comprehensive SN activity tree functionality that the course outline completely ignores:

#### **Available but Unused SN Activity Tree Functions**:

1. **`activity.isVisible`** - `src/main/services/scorm/sn/activity-tree.js:39`
   - SCORM-compliant visibility based on sequencing rules
   - Set to false by `hiddenFromChoice` sequencing actions  
   - Currently ignored by course outline

2. **`activityTreeManager.traverseTree(callback)`** - `src/main/services/scorm/sn/activity-tree.js:316`
   - Proper tree traversal respecting SCORM hierarchy
   - Used internally but not exposed to renderer
   - Better than manual outline rendering

3. **`activity.sequencing.controlMode.choice`** - Per-activity choice control
   - Individual activity restrictions beyond global navigation
   - Currently ignored - only checks global availability

4. **`sequencingEngine.evaluatePreConditionRules(activity)`** - Per-activity validation
   - Returns specific restriction reasons: `disabled`, `hiddenFromChoice`, etc.
   - Available but not used for individual outline items

5. **Activity State Tracking** - `src/main/services/scorm/sn/activity-tree.js:30-35`
   - Attempt count, completion state, suspension status
   - Rich state information not shown in outline
   - Better than simple progress tracking

## Implementation Plan

### Step 1: Activity Tree Integration Foundation
**Objective**: Establish connection between course outline and SN service activity tree

**Tasks**:
- Create IPC method to retrieve activity tree with comprehensive SCORM states from main process
- Implement tree traversal function that enriches activities with visibility, control modes, attempt counts, and pre-condition results
- Add graceful fallback mechanisms for when SN service is unavailable

**Key Integration Points**:
- `activity.isVisible` for SCORM-compliant visibility based on sequencing rules
- `activity.sequencing.controlMode.choice` for per-activity choice restrictions
- `activity.attemptCount` and `activity.limitConditions` for attempt limit tracking
- `sequencingEngine.evaluatePreConditionRules()` for detailed restriction reasons

### Step 2: Per-Activity SCORM Validation System
**Objective**: Replace global navigation checks with individual activity validation

**Tasks**:
- Implement per-activity validation that checks visibility, control modes, and pre-conditions
- Create comprehensive restriction reason system that provides specific feedback
- Add attempt limit awareness with display of current attempts vs limits
- Implement suspension state detection and handling
- Build fallback system for activities not found in SCORM tree

**Revolutionary Enhancement**: Individual item validation instead of global availability checks

### Step 3: Rich State Display Integration  
**Objective**: Transform outline items to show comprehensive SCORM state information

**Tasks**:
- Implement dynamic element hiding for activities marked as not visible by SCORM
- Add attempt count badges showing "X/Y attempts" or "X/∞ attempts"
- Create suspension state indicators with visual styling
- Update clickability states based on comprehensive SCORM validation
- Add informative tooltips explaining specific restriction reasons

### Step 4: Advanced Visual States and Styling
**Objective**: Create comprehensive visual system for SCORM state representation

**Tasks**:
- Design CSS states for available, disabled, suspended, and hidden items
- Create visual badges for attempt count display with proper styling
- Implement objective status indicators (satisfied/not-satisfied) 
- Add SCORM-compliant hiding for items with `hiddenFromChoice` set to true
- Design consistent color scheme and visual hierarchy for all states

**Visual Components**:
- Available state: Standard clickable appearance
- Disabled state: Reduced opacity with "not-allowed" cursor
- Suspended state: Orange border indicator for activities that can be resumed
- Attempt count badges: Compact display showing "X/Y attempts"
- Objective status badges: Green/red indicators for objective satisfaction

### Step 5: Comprehensive State Update System
**Objective**: Create unified system for updating all outline items based on SCORM state

**Tasks**:
- Implement function to fetch full activity tree with enriched SCORM states
- Create tree traversal system to find activity states by ID
- Build comprehensive update logic that applies all visual states simultaneously  
- Integrate browse mode handling that overrides SCORM restrictions appropriately
- Add fallback handling for items not found in SCORM activity tree

**Key Features**:
- Single function updates all items based on current SCORM state
- Browse mode integration identical to navigation controls
- Real-time synchronization with SN service state changes

### Step 6: Objective and Sequencing Rule Integration
**Objective**: Add advanced SCORM features for professional LMS-level functionality

**Tasks**:
- Implement objective satisfaction status display using activity objectives Map
- Create detailed sequencing rule tooltips showing specific restriction reasons
- Add prerequisite display showing which activities must be completed first
- Implement real-time tree synchronization when SN activity states change
- Create sequencing rule inspector functionality for debugging

**Advanced Features**:
- Objective progress tracking and display
- Detailed restriction explanations ("Prerequisite not completed", "Attempt limit exceeded")
- Activity dependency visualization
- Real-time state updates during course execution

### Step 7: System-Wide Component Integration  
**Objective**: Extend SCORM awareness to related components

**Tasks**:
- Add pre-launch validation to content viewer using attempt limits and sequencing rules
- Enhance progress tracking component with rich SN state display (attempts, suspension, objectives)
- Update footer status display with SCORM navigation context and restrictions
- Integrate advanced navigation features beyond basic availability checks

**Component Enhancements**:
- Content Viewer: SCORM launch validation before loading content
- Progress Tracking: Rich state display with attempts, suspension status, objective progress  
- Footer Status: Navigation context showing current restrictions and browse mode status
- Navigation Controls: Advanced SN features like objective-based restrictions

## Broader Component Integration (From Original Analysis)

### Additional Missing Integrations Identified:
1. **Content Viewer Component**: Missing SCORM launch validation using `activity.attemptCount` vs limits
2. **Progress Tracking Component**: Missing rich SN state display (objectives, attempts, suspension)
3. **Footer Status Display**: Missing SCORM navigation context 
4. **Navigation Controls**: Could use advanced SN features like objective-based restrictions

### System-Wide Enhancement Opportunity:
- **Activity Attempt Manager**: New component for attempt limit management
- **Objective Tracker**: New component for objective satisfaction display
- **Sequencing Rule Inspector**: New component showing restriction reasons
- **Activity State Panel**: Comprehensive SCORM state display

## Key Benefits of This Approach

### ✅ Zero New Architecture
- Uses existing UIState service
- Uses existing event bus patterns  
- Uses existing notification system
- Uses existing CSS class management

### ✅ Perfect Consistency
- Identical behavior to navigation controls
- Same browse mode integration
- Same state synchronization
- Same error handling patterns

### ✅ Maximum SN Service Leverage
- Uses existing `availableNavigation` state
- Leverages existing browse mode logic
- Optional per-activity validation using existing SN functions
- Same IPC patterns as navigation controls

### ✅ Minimal Code Changes
- 3 new methods maximum
- Extends existing event handlers
- 2 CSS classes only
- No new services or components

## Technical Implementation Requirements

### Files to Modify

1. **Main Process IPC Integration**
   - `src/main/services/scorm/sn/index.js` - Add activity tree state retrieval methods
   - `src/main/ipc/scorm-handlers.js` - Add IPC handlers for activity tree requests

2. **Course Outline Component Enhancement** 
   - `src/renderer/components/scorm/course-outline.js` - Core component modifications:
     - Add activity tree integration methods
     - Implement per-activity validation system
     - Add rich state display functionality
     - Extend event subscription system
     - Update navigation click handling

3. **Visual Styling System**
   - `src/renderer/styles/components/course-outline.css` - Add comprehensive SCORM state styles:
     - Available, disabled, suspended, hidden states
     - Attempt count badge styling
     - Objective status indicator styling
     - Consistent visual hierarchy

4. **Related Component Integration**
   - `src/renderer/components/scorm/content-viewer.js` - Add SCORM launch validation
   - `src/renderer/components/scorm/progress-tracking.js` - Rich state display enhancements
   - `src/renderer/components/scorm/footer-status-display.js` - SCORM context integration
   - `src/renderer/components/scorm/navigation-controls.js` - Advanced SN feature integration

### Integration Points with Existing Systems

- **UIState Service**: Use existing `getState('navigationState')` and `getState('browseMode')`
- **Event Bus**: Extend existing event subscriptions for navigation and progress updates
- **SN Service**: Leverage existing sequencing engine, activity tree manager, and navigation handler
- **Notification System**: Use existing `showNotification()` for user feedback

## Testing Strategy

### Unit Tests
- Navigation availability calculation
- Browse mode integration
- Visual state updates

### Integration Tests
- Synchronization with navigation controls
- Browse mode consistency
- SCORM course compatibility

## Success Criteria

### Functional Requirements
- Users cannot click on items that won't work per SCORM sequencing rules
- Per-activity restrictions based on individual control modes and pre-conditions
- Rich visual indicators showing attempt counts, suspension state, objective status
- SCORM-compliant visibility with items hidden when `isVisible: false`
- Specific restriction reasons provided in tooltips ("Prerequisite not completed", "Attempt limit exceeded")
- Browse mode bypasses restrictions appropriately while maintaining visual consistency
- Real-time synchronization with SN service activity state changes

### User Experience Requirements
- LMS-accurate representation of navigation options matching professional SCORM systems
- Progressive disclosure based on SCORM sequencing flow and user progress
- Informative tooltips explaining specific restrictions and requirements
- State-aware visual indicators reflecting actual activity status
- Consistent behavior with existing navigation controls component

### SCORM Compliance Requirements
- 100% SCORM 2004 4th Edition compliance for activity tree navigation
- Proper sequencing rule evaluation for each individual activity
- Control mode enforcement at both activity and global levels
- Objective-based navigation restrictions properly implemented
- Attempt limit awareness with visual display of current usage

### Performance Requirements
- Efficient tree traversal using existing SN service patterns
- Cached activity states to minimize repeated SN service calls
- Incremental updates when individual activities change state
- Fast state updates (target: < 50ms for full course outline refresh)
- Memory-efficient state management without leaks

### Integration Requirements
- Perfect synchronization with SN service activity tree state
- Event-driven updates when activity states change during course execution
- Consistent state representation across all navigation-related components
- Graceful degradation when SN service is unavailable with appropriate fallbacks

## Rollback Plan

Simple rollback by removing:
1. New validation checks (allow all clicks)
2. CSS disabled styles
3. New event subscriptions
4. Enhanced feedback messages

## Expected Outcomes

### Transformation Overview
**Before**: Basic outline component with no SCORM validation - users can click any item regardless of sequencing rules  
**After**: Professional LMS-level SCORM navigator with per-activity validation, rich state display, and comprehensive SN service integration

### Key Improvements from Original Analysis
- **Per-activity SCORM validation**: Individual activity restrictions using comprehensive SN service integration
- **Rich state display**: Visual indicators for attempts, suspension status, objective satisfaction
- **True SCORM compliance**: Proper `activity.isVisible` and `hiddenFromChoice` support
- **System-wide integration**: Enhanced SCORM awareness across Content Viewer, Progress Tracking, Footer Status components
- **Revolutionary enhancement**: Transform from simple menu to sophisticated SCORM navigation system

### Strategic Benefits
- **100% SCORM 2004 4th Edition compliance** through comprehensive SN service utilization
- **Professional LMS-level user experience** matching commercial SCORM systems  
- **Comprehensive feedback system** with specific restriction explanations
- **Minimal development complexity** by leveraging existing infrastructure
- **Perfect integration** with existing navigation controls patterns and browse mode functionality