# Soft Reload Feature Implementation

**Date:** November 14, 2025  
**Status:** FUTURE (Implementation attempted but Limited by Architecture)

## Summary

Attempted to implement a "soft reload" button that refreshes course content while preserving SCORM session state. The feature works correctly from a SCORM API perspective but is limited by the application's file serving architecture.

## What Was Implemented

### 1. UI Components
- **New soft reload button (⟳)** added to `HeaderControls` component
- Positioned between "Open Folder" and "Reload" buttons
- Enabled/disabled based on course load state
- Emits `course:soft-reload:request` event

### 2. Content Refresh Logic
- **`softReload()` method** in `ContentViewer` component
- Uses `location.reload(true)` on iframe to bypass browser cache
- Fallback to cache-busting URL parameters if reload fails
- Shows user notifications during refresh process

### 3. SCORM Session Preservation
- **Modified `Initialize()` in `ScormClient`** to allow re-initialization with same session ID
- When content calls `Initialize()` after reload, checks if session ID matches
- Returns success without creating new session or calling main process again
- Emits `ui:scorm:reinitialized` event for soft reloads
- **Added `rendererLogger` import** to fix undefined reference error

### 4. Event Handling
- **`handleSoftReload()` in `AppManager`** coordinates the refresh
- Validates content viewer state before proceeding
- Manages button loading states during refresh
- Handles errors gracefully

## What Works

✅ **SCORM Session Preservation**
- Learner progress and data model state remain intact
- No "already initialized" errors (error code 103)
- Content can call `Initialize()` again without issues

✅ **Iframe Refresh**
- Successfully reloads iframe content
- Bypasses browser cache with `location.reload(true)`
- Proper error handling and user feedback

✅ **No SCORM Errors**
- Previous issue: `ReferenceError: rendererLogger is not defined`
- Fixed by adding import: `import { rendererLogger } from '../utils/renderer-logger.js';`
- Initialize now handles re-initialization gracefully

## Critical Limitation Discovered

### The Problem: Temporary File Architecture

The application uses a **copy-on-load architecture** for consistency:

1. **ZIP files:** Extracted to `sessions/scorm_[timestamp]/`
2. **Folder-based courses:** Also copied to `sessions/scorm_[timestamp]/`
3. **File serving:** Uses custom `scorm-app://` protocol pointing to temp folder

**Example URL:** `scorm-app://app/scorm_1763174965192/assets/intro-02.js`

### Why Soft Reload Can't See Source Changes

```
Source Files              Temp Folder                    Browser
    │                         │                             │
    ├─ intro-02.js           ├─ intro-02.js (copy)         │
    │  (you edit this)       │  (served from here)         │
    │                        │                              │
    └─────────────────────────→ Soft Reload ───────────────→
                                 (refreshes same temp copy)
```

When you:
1. Edit source file: `c:\projects\course\intro-02.js`
2. Click soft reload
3. Browser reloads: `scorm-app://app/scorm_1763174965192/assets/intro-02.js`

The temp folder still has the **old copy** from initial load.

## Why This Architecture Exists

The copy-on-load pattern provides:
- **Consistency:** ZIP and folder courses behave identically
- **Isolation:** Running course doesn't lock source files
- **Safety:** Original files protected from accidental modification
- **Session Management:** Each load gets unique session folder

## Workarounds

### Option 1: Edit Temp Files Directly
1. Find temp folder path (visible in URLs: `scorm_[timestamp]`)
2. Edit files in temp location during development
3. Use soft reload to see changes instantly
4. SCORM state preserved between edits

**Pros:** Fast iteration, preserves state  
**Cons:** Temporary edits, need to copy back to source

### Option 2: Use Hard Reload
1. Edit source files normally
2. Click regular "Reload" button
3. Re-copies files from source
4. See all changes immediately

**Pros:** Edits permanent, clean workflow  
**Cons:** SCORM state reset, slower

### Option 3: Future Enhancement
Add file watching + sync between source and temp folders:
- Monitor source folder for changes
- Auto-sync changed files to temp folder
- Trigger soft reload automatically
- Requires `chokidar` or similar watcher

## Files Modified

### Core Implementation
- `src/renderer/components/header-controls.js` - Added soft reload button and event
- `src/renderer/components/scorm/content-viewer.js` - Added `softReload()` method
- `src/renderer/services/scorm-client.js` - Modified `Initialize()` to allow re-init
- `src/renderer/services/scorm-api-bridge.js` - Added error handling (later cleaned up)
- `src/renderer/services/app-manager.js` - Added `handleSoftReload()` and event listener

### Bug Fixes
- Added `rendererLogger` import to `scorm-client.js` (fixed ReferenceError)
- Removed debug console.log statements after testing

## Technical Details

### How SCORM Re-initialization Works

**Before (caused error 103):**
```javascript
Initialize(sessionId) {
  if (this.isInitialized) {
    this.setLastError('103'); // Already initialized
    return 'false';
  }
  // ... initialize
}
```

**After (allows soft reload):**
```javascript
Initialize(sessionId) {
  // Allow re-init with same session
  if (this.isInitialized && this.sessionId === sessionId) {
    this.lastError = '0';
    eventBus.emit('ui:scorm:reinitialized', { sessionId });
    return 'true'; // Success without creating new session
  }
  
  // Still reject different session
  if (this.isInitialized) {
    this.setLastError('103');
    return 'false';
  }
  // ... initialize normally
}
```

### Cache Busting Attempted

Multiple approaches were tried:
1. Cache-busting URL parameters (`?_reload=timestamp`)
2. `location.reload(true)` to force hard reload
3. Post-load CSS link manipulation with cache-busting
4. All work for cache, but can't fix source vs temp folder issue

## Recommendations

### Short Term
- **Document the limitation** - users should know to use hard reload for source changes
- **Keep soft reload** - still valuable for temp folder edits and testing
- **Add tooltip** explaining when to use soft vs hard reload

### Long Term
Consider one of these architectural changes:

**A) Direct File Serving (Development Mode)**
- Skip copying in dev mode
- Serve directly from source folders
- Would enable true hot reload
- Risk: could break isolation assumptions

**B) File Watching + Sync**
- Watch source folder for changes
- Sync changed files to temp folder
- Auto-trigger soft reload
- Best of both worlds but adds complexity

**C) Source Mapping**
- Keep temp folder for runtime
- Map temp URLs back to source for dev tools
- Allow editing either location
- Most complex but most flexible

## Conclusion

The soft reload feature is **technically working as designed**:
- ✅ Refreshes iframe content
- ✅ Preserves SCORM session state
- ✅ No SCORM API errors
- ✅ Cache-busting works

But it's **limited by architecture**:
- ❌ Cannot see source file changes
- ❌ Only refreshes temp folder contents
- ❌ Requires hard reload to sync source changes

The feature is valuable for **editing temp files directly** or **quick testing**, but not sufficient for a full hot-reload development workflow without architectural changes to file serving.
