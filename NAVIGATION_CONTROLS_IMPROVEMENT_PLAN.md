# Navigation Controls Improvement Plan

## Problem Statement

### Current Issues

1. **Confusing Button Labels**: Navigation buttons are labeled "Previous Activity" / "Next Activity" which is misleading
   - Most SCORM courses are single-SCO (Sharable Content Object)
   - These buttons navigate between SCOs, not activities within a SCO
   - Users expect these to navigate between slides/pages within a course, but they don't

2. **Browse Mode Doesn't Work**: Investigation reveals browse mode is non-functional, especially for single-SCO courses
   - Browse mode enables the navigation buttons but they fail when clicked
   - Root cause: Browse mode navigation requires SN (Sequencing & Navigation) service
   - Single-SCO courses often don't have SN service initialized (it's not needed for sequencing)
   - This creates a paradox where browse mode promises unrestricted navigation but can't deliver

3. **No User Feedback**: When a course is single-SCO, navigation buttons remain visible but don't work
   - No tooltip or explanation for why they're unavailable
   - Creates confusion and frustration

## Investigation Summary: Browse Mode

### How Browse Mode Works (Architecture)

**Components:**
- **BrowseModeService** (`src/main/services/browse-mode-service.js`): Manages browse mode sessions in main process
- **Navigation Integration**: Works through NavigationHandler and SequencingEngine to bypass SCORM sequencing rules
- **UI Communication**: Uses IPC between renderer and main process

**Browse Mode Flow:**
1. User clicks browse mode toggle in NavigationControls component
2. AppManager's `setBrowseMode()` calls IPC `browse-mode-enable`
3. ScormService delegates to BrowseModeService which creates a session
4. Navigation buttons become enabled (UI shows unrestricted navigation)
5. When user clicks Next/Previous, navigation request is processed through SN service

### The Critical Bug: SN Service Dependency

**Root Cause of Browse Mode Failure:**

When navigation buttons are clicked in browse mode:

1. **NavigationControls** emits `navigation:request` event (src/renderer/components/scorm/navigation-controls.js:316, 341)
2. **AppManager.processNavigationRequest()** handles it (src/renderer/services/app-manager.js:1939)
3. For 'previous'/'continue' requests, it calls **processThroughSNService()** (line 1978)
4. **SNBridge.initialize()** attempts to connect to SN service (src/renderer/services/sn-bridge.js:39-52)
5. **If SN service is unavailable, navigation fails** with "SN service unavailable" (src/renderer/services/app-manager.js:2080)

**Code Reference:**

```javascript
// src/renderer/services/app-manager.js:2069-2081
async processThroughSNService(requestType, activityId, activityObject) {
  try {
    const snBridge = snBridgeModule.snBridge;

    // Initialize if needed
    const init = await snBridge.initialize().catch(() => ({ success: false }));

    if (!init || !init.success) {
      this.logger.warn('AppManager: SN service unavailable; navigation unavailable (fail-fast)');
      return { success: false, reason: 'SN service unavailable' };  // ← FAILS HERE
    }

    // Process through SN service
    const result = await snBridge.processNavigation(requestType, activityId);
    // ...
}
```

### Single-SCO Courses

- **Only one SCO** (Sharable Content Object), so there's nothing to sequence
- According to `spec.md:100`: *"SN_NOT_INITIALIZED is not an error. It is an expected state for single-SCO courses."*
- The SN service may not be fully initialized because sequencing isn't needed
- **Browse mode navigation requires SN service but it's not available!**

**The Paradox:**
- Browse mode promises "unrestricted navigation"
- But the navigation mechanism requires the SN service
- For single-SCO courses, SN service may not be initialized
- Therefore, browse mode navigation fails silently

### Key Files Involved

1. **Browse Mode Service**: `src/main/services/browse-mode-service.js`
2. **Navigation Handler**: `src/main/services/scorm/sn/navigation-handler.js` (lines 567-774 for browse mode navigation)
3. **SN Service**: `src/main/services/scorm/sn/index.js` (initialization at lines 70-209)
4. **AppManager**: `src/renderer/services/app-manager.js` (setBrowseMode: 1796, processNavigationRequest: 1939)
5. **NavigationControls**: `src/renderer/components/scorm/navigation-controls.js` (updateButtonStates: 681)
6. **SN Bridge**: `src/renderer/services/sn-bridge.js` (initialize: 39)

## Proposed Solution

### Core Changes

1. **Relabel Buttons**: Change "Previous/Next Activity" → "Previous/Next SCO"
2. **Detect Single-SCO Courses**: Use existing `activityTreeStats.launchableActivities` count
3. **Disable for Single-SCO**: Automatically disable navigation buttons when only 1 SCO exists
4. **Add Explanatory Tooltips**: Clear messaging about why buttons are disabled
5. **Fix Browse Mode Logic**: Respect single-SCO limitation even in browse mode

### Benefits

✅ **Clear Labeling**: "SCO" is more accurate and less confusing than "Activity"
✅ **Prevents Confusion**: Disabled buttons with tooltips explain why navigation isn't available
✅ **Better UX**: Users immediately understand the course structure
✅ **Browse Mode Still Works**: Browse mode logic is preserved but respects single-SCO limitation
✅ **Consistent with Spec**: Aligns with spec.md note that single-SCO courses are common
✅ **Fixes Browse Mode Bug**: Prevents users from attempting navigation that will fail

## Implementation Details

### 1. Update Button Labels

**File:** `src/renderer/components/scorm/navigation-controls.js`
**Lines:** 160, 163, 170, 173

**Current:**
```javascript
← Previous Activity
Next Activity →
```

**Change to:**
```javascript
← Previous SCO
Next SCO →
```

**Also update initial title attributes:**
- Line 160: `title="Previous SCO (respects course sequencing)"`
- Line 170: `title="Next SCO (respects course sequencing)"`

### 2. Add Single-SCO Detection

**File:** `src/renderer/components/scorm/navigation-controls.js`
**Method:** `updateButtonStates()` (line 681)

**Add detection logic:**
```javascript
updateButtonStates() {
  const browseMode = this.uiState?.getState('browseMode')?.enabled || false;
  const navState = this.uiState?.getState('navigationState') || {};
  const activityTreeStats = navState.activityTreeStats || {};
  const isSingleSCO = activityTreeStats.launchableActivities === 1;
  const hiddenControls = navState.hiddenControls || [];

  // ... rest of method
}
```

**Data Source:**
- `activityTreeStats` comes from `getSequencingState()` at src/main/services/scorm/sn/index.js:784
- It already includes `launchableActivities` count from activity tree manager
- This data flows through IPC → UIState → NavigationControls

### 3. Disable Buttons for Single-SCO Courses

**File:** `src/renderer/components/scorm/navigation-controls.js`
**Lines:** 691-692

**Current:**
```javascript
// In browse mode, buttons are ALWAYS enabled
const canNavigatePrevious = browseMode || !!this.navigationState.canNavigatePrevious;
const canNavigateNext = browseMode || !!this.navigationState.canNavigateNext;
```

**Change to:**
```javascript
// Disable for single-SCO courses even in browse mode
const canNavigatePrevious = !isSingleSCO && (browseMode || !!this.navigationState.canNavigatePrevious);
const canNavigateNext = !isSingleSCO && (browseMode || !!this.navigationState.canNavigateNext);
```

### 4. Add Explanatory Tooltips

**File:** `src/renderer/components/scorm/navigation-controls.js`
**Lines:** 704-733 (button title attributes)

**Update Previous button tooltip (around line 704):**
```javascript
const title = isSingleSCO
  ? 'SCO navigation unavailable (This course contains only one SCO)'
  : browseMode
    ? 'Previous SCO (Browse Mode - Unrestricted Navigation)'
    : canNavigatePrevious
      ? 'Previous SCO (SCORM sequencing allows)'
      : 'Previous navigation blocked by SCORM rules';

this.previousBtn.title = title;
```

**Update Next button tooltip (around line 725):**
```javascript
const title = isSingleSCO
  ? 'SCO navigation unavailable (This course contains only one SCO)'
  : browseMode
    ? 'Next SCO (Browse Mode - Unrestricted Navigation)'
    : canNavigateNext
      ? 'Next SCO (SCORM sequencing allows)'
      : 'Next navigation blocked by SCORM rules';

this.nextBtn.title = title;
```

### 5. Verify Activity Tree Stats Flow

**Ensure data flows from main → renderer:**

1. **Main Process** (src/main/services/scorm/sn/index.js:767-784):
   ```javascript
   getSequencingState() {
     // ...
     return {
       // ...
       activityTreeStats: this.activityTreeManager.getTreeStats()
       // Returns: { totalActivities, leafActivities, launchableActivities, maxDepth }
     };
   }
   ```

2. **IPC Handler** (src/main/services/ipc-handler.js:1361-1369):
   ```javascript
   async handleSNGetSequencingState(_event) {
     const scormService = this.getDependency('scormService');
     const snService = scormService.getSNService();
     if (!snService) {
       return { success: false, error: 'SN service not available' };
     }
     const state = snService.getSequencingState();
     return { success: true, ...state }; // Includes activityTreeStats
   }
   ```

3. **Renderer** (src/renderer/services/app-manager.js):
   - Verify `refreshNavigationFromSNService()` includes activityTreeStats in UIState update
   - Check that navigation state updates preserve activityTreeStats field

### 6. Update Browse Mode Visual Indicators

**File:** `src/renderer/components/scorm/navigation-controls.js`
**Method:** `updateNavigationForBrowseMode()` (line 814)

**Update button title logic (lines 824, 828):**
```javascript
// Update button labels and behavior for browse mode
if (browseModeEnabled) {
  if (this.previousBtn) {
    this.previousBtn.title = isSingleSCO
      ? 'SCO navigation unavailable (This course contains only one SCO)'
      : 'Previous SCO (Browse Mode - Unrestricted Navigation)';
    this.previousBtn.classList.add('nav-browse-mode');
  }
  if (this.nextBtn) {
    this.nextBtn.title = isSingleSCO
      ? 'SCO navigation unavailable (This course contains only one SCO)'
      : 'Next SCO (Browse Mode - Unrestricted Navigation)';
    this.nextBtn.classList.add('nav-browse-mode');
  }
  // ...
}
```

## Testing Plan

### Test Cases

1. **Single-SCO Course (Most Common)**
   - [ ] Load a single-SCO course
   - [ ] Verify Previous/Next buttons are labeled "Previous SCO" / "Next SCO"
   - [ ] Verify buttons are disabled
   - [ ] Hover over buttons and verify tooltip says "SCO navigation unavailable (This course contains only one SCO)"
   - [ ] Enable browse mode
   - [ ] Verify buttons remain disabled with same tooltip
   - [ ] Verify no console errors when clicking disabled buttons

2. **Multi-SCO Course (Less Common)**
   - [ ] Load a multi-SCO course with 3+ SCOs
   - [ ] Verify Previous/Next buttons are labeled "Previous SCO" / "Next SCO"
   - [ ] Launch first SCO
   - [ ] Verify "Previous SCO" is disabled, "Next SCO" is enabled
   - [ ] Verify tooltips explain SCORM sequencing rules
   - [ ] Click "Next SCO" and verify navigation to second SCO
   - [ ] Verify both buttons are now enabled (Previous and Next)
   - [ ] Enable browse mode
   - [ ] Verify buttons remain functional with "Browse Mode - Unrestricted Navigation" tooltips

3. **Browse Mode Edge Cases**
   - [ ] Load single-SCO course
   - [ ] Enable browse mode BEFORE launching content
   - [ ] Verify buttons are disabled with appropriate tooltip
   - [ ] Launch content
   - [ ] Verify buttons remain disabled
   - [ ] Disable browse mode
   - [ ] Verify buttons remain disabled (still single-SCO)

4. **SN Service Unavailable**
   - [ ] Simulate SN service failure
   - [ ] Verify buttons show appropriate disabled state
   - [ ] Verify tooltips explain the issue
   - [ ] Verify no crashes or unhandled errors

### Manual Testing

**Test Files:**
- Single-SCO: Use existing test courses in `references/real_course_examples/`
- Multi-SCO: Need to verify or create multi-SCO test course

**Steps:**
1. Run app: `npm start`
2. Load each test course type
3. Follow test cases above
4. Document any issues or unexpected behavior

### Automated Testing

**Update existing tests:**
- `tests/unit/main/browse-mode-navigation.test.js`
- Add tests for single-SCO detection logic
- Add tests for button state when `launchableActivities === 1`

**New test cases:**
```javascript
describe('Single-SCO Navigation Controls', () => {
  test('should disable buttons when launchableActivities === 1', () => {
    // Mock activityTreeStats with single SCO
    // Verify buttons are disabled
  });

  test('should show appropriate tooltip for single-SCO', () => {
    // Mock single-SCO state
    // Verify tooltip contains "This course contains only one SCO"
  });

  test('should keep buttons disabled in browse mode for single-SCO', () => {
    // Enable browse mode
    // Mock single-SCO state
    // Verify buttons remain disabled
  });
});
```

## Migration Notes

### Breaking Changes

**None** - This is a UX improvement, not a breaking API change.

### Backwards Compatibility

- Button functionality remains the same
- Only labels and disabled states change
- Existing courses continue to work as before
- Browse mode behavior is more correct (prevents failed navigation attempts)

### Deployment

1. **No database migrations required**
2. **No configuration changes needed**
3. **Safe to deploy incrementally** (renderer changes independent of main process)
4. **Rollback plan**: Simple git revert if issues arise

## Future Enhancements

### Potential Follow-ups

1. **Slide-level Navigation** (Separate Feature)
   - Add separate controls for navigating slides within a single SCO
   - Use DOM-based navigation tools: `scorm_get_slide_map`, `scorm_navigate_to_slide`
   - Only show when SCO has multiple slides

2. **Browse Mode Redesign**
   - Decouple browse mode from SN service dependency
   - Implement fallback navigation for single-SCO courses
   - Use DOM-based navigation when sequencing is unavailable

3. **Smart Control Visibility**
   - Auto-hide SCO navigation controls for single-SCO courses
   - Show slide navigation controls when detected
   - Adaptive UI based on course structure

4. **Course Structure Indicator**
   - Display "1 SCO" or "3 SCOs" somewhere in the UI
   - Help users understand the course structure at a glance
   - Show activity tree visualization in advanced mode

## References

### Spec Documentation

From `spec.md:100`:
> **Error Model**: `SN_NOT_INITIALIZED` is **not an error**. It is an expected state for single-SCO courses. Tools will return `applicable: false` in this case.

From `spec.md:103-104`:
> **DOM & Browser Testing**: `scorm_dom_*` tools (click, fill, query, evaluate), `scorm_get_slide_map`, `scorm_navigate_to_slide` - pure DOM, no API dependencies.

### Related Code

- Activity Tree Manager: `src/main/services/scorm/sn/activity-tree.js` (getTreeStats: line 350)
- SN Service Status: `src/main/services/scorm/sn/index.js` (getSequencingState: line 767)
- Navigation Controls: `src/renderer/components/scorm/navigation-controls.js`
- App Manager Navigation: `src/renderer/services/app-manager.js` (processNavigationRequest: line 1939)

### SCORM 2004 4th Edition

- **SCO Definition**: A SCO is a learning object that communicates with the LMS using the SCORM Run-Time Environment
- **Activity vs SCO**: Activities are organizational containers; SCOs are launchable content
- **Sequencing**: Multi-SCO courses use sequencing rules to control navigation order
- **Single-SCO**: Most e-learning courses are single-SCO with internal slide navigation

## Implementation Checklist

- [ ] Update button labels from "Activity" to "SCO"
- [ ] Add `isSingleSCO` detection in `updateButtonStates()`
- [ ] Modify `canNavigatePrevious`/`canNavigateNext` to respect `isSingleSCO`
- [ ] Update tooltip logic for single-SCO explanation
- [ ] Update browse mode tooltip logic
- [ ] Verify `activityTreeStats` flows through IPC → UIState → NavigationControls
- [ ] Test with single-SCO course
- [ ] Test with multi-SCO course
- [ ] Test browse mode with single-SCO
- [ ] Test browse mode with multi-SCO
- [ ] Update automated tests
- [ ] Document changes in CHANGELOG
- [ ] Update user documentation if applicable

## Questions / Decisions Needed

1. ✅ **Button Labels**: Confirmed "Previous SCO" / "Next SCO" is clearer than "Previous Activity" / "Next Activity"
2. ✅ **Disable vs Hide**: Disabled with tooltip is better than hiding (users understand why)
3. ❓ **Browse Mode Future**: Should browse mode be redesigned to work with single-SCO courses via slide navigation?
4. ❓ **Visual Indicator**: Should we add a badge/label showing "1 SCO" or "3 SCOs" in the UI?
5. ❓ **Slide Navigation**: Should we add separate slide-level navigation controls in a future update?

---

**Document Version**: 1.0
**Date**: 2025-11-14
**Author**: Investigation and Plan
**Status**: Ready for Implementation
