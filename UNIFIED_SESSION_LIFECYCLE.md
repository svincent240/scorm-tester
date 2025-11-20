# Unified Session Lifecycle: Simplified Shutdown and Startup

**Date:** November 20, 2025  
**Status:** ✅ Implemented

---

## Core Philosophy: Simplicity Through Unification

This document describes the **unified and simplified** approach to SCORM session lifecycle management in this application. The guiding principle is: **one shutdown path, one startup path, zero special cases**.

### Why Unify?

Previously, the codebase had multiple shutdown and startup paths:
- Manual shutdown vs. window close shutdown
- Reload with resume vs. reload without resume  
- MCP API shutdown vs. GUI shutdown
- Force-new session vs. resume session

**This complexity was unnecessary and error-prone.** Each path had slightly different behavior, making debugging difficult and introducing subtle bugs in resume functionality.

### The Solution: One Path for Everything

We now have:
1. **One shutdown path** that always saves session data
2. **One startup path** that always checks for saved data and resumes if appropriate
3. **Simple flags** to control behavior when needed (e.g., `forceNew`)

---

## Unified Shutdown Path

### Decision: Always Save on Shutdown

**Every shutdown saves session data to disk.** No exceptions. No conditional logic about "should we save?"

#### Implementation

Location: `src/main/services/scorm-service.js` → `terminate()`

```javascript
async terminate(sessionId, terminateData, options = {}) {
  // 1. Process SCORM Terminate call
  // 2. Get final data model state
  // 3. ALWAYS save to SessionStore (if courseId available)
  // 4. Clean up immediately after save
}
```

**Key Points:**
- No checking if `cmi.exit === 'suspend'` before saving
- No checking if user "wants" to resume later
- Just save the data, period
- Let startup path decide what to do with it

#### Why This Works

The SCORM data model already contains everything we need:
- `cmi.exit` tells us if the learner wants to resume (`'suspend'`) or start fresh (`'logout'`, `'normal'`, `''`)
- `cmi.location` tells us where they were
- `cmi.suspend_data` contains course-specific state

By always saving, we preserve this information and let the **startup path make the decision** about whether to use it.

---

## Unified Startup Path

### Decision: Always Check for Saved Data

**Every course load checks for saved session data.** If it exists and `cmi.exit === 'suspend'`, we hydrate the data model and set `cmi.entry = 'resume'`. Otherwise, we start fresh with `cmi.entry = 'ab-initio'`.

#### Implementation

Location: `src/main/services/scorm-service.js` → `initializeSession()`

```javascript
async initializeSession(sessionId, courseId, options = {}) {
  // 1. If reload=true, terminate existing session first
  // 2. If forceNew=true, delete saved session file
  // 3. Load course manifest
  // 4. Check SessionStore for saved data
  // 5. If saved data exists AND cmi.exit === 'suspend':
  //    - Hydrate data model with saved values
  //    - Set cmi.entry = 'resume'
  // 6. Otherwise:
  //    - Initialize fresh data model
  //    - Set cmi.entry = 'ab-initio'
  // 7. Call Initialize()
}
```

**Key Points:**
- No separate "resume" function
- No separate "force new" function  
- One path that handles both cases based on saved data
- Simple flag (`forceNew`) to override and delete saved data when needed

#### Why This Works

SCORM 2004 defines two entry modes:
- `'ab-initio'` = starting fresh
- `'resume'` = continuing from where you left off

The data model tells us which one to use via `cmi.exit` from the previous session. We don't need complex logic—just check the saved data and hydrate if appropriate.

---

## Unified MCP API

The Model Context Protocol (MCP) tools now reflect this simplicity:

### Core Tools

1. **`scorm_open_course(coursePath, options)`**
   - Opens a course (zip or folder)
   - Auto-resumes if saved data exists with `exit='suspend'`
   - Options: `forceNew` to ignore saved data

2. **`scorm_close_course()`**
   - Closes current course
   - Always saves session data via unified shutdown path

3. **`scorm_reload_course()`**
   - Atomic operation: close + open
   - Uses unified paths internally
   - Resumes by default (unless `forceNew=true`)

4. **`scorm_clear_saved_data(namespace, courseId)`**
   - Utility to delete saved session file
   - Use when you want to force fresh start

### Deprecated (But Still Present)

- `scorm_session_open` → Use `scorm_open_course`
- `scorm_session_close` → Use `scorm_close_course`
- `scorm_session_shutdown` → Use `scorm_close_course`
- `scorm_session_terminate` → Use `scorm_close_course`

These old tools are marked `[DEPRECATED]` and will be removed in a future version.

---

## Session Persistence

### Storage Location

Saved session data is stored as JSON files:
```
{userData}/scorm-sessions/{namespace}_{courseId}.json
```

Example:
```
~/Library/Application Support/scorm-tester/scorm-sessions/default_course-12345.json
```

### What Gets Saved

The entire SCORM data model, including:
- `cmi.exit` (critical for resume decision)
- `cmi.location` (where learner was)
- `cmi.suspend_data` (course-specific state)
- `cmi.score.*` (assessment data)
- `cmi.completion_status`
- `cmi.success_status`
- All interactions, objectives, comments, etc.

### When It Gets Saved

**Always.** On every shutdown. No exceptions.

### When It Gets Used

**Only when appropriate.** On startup, if:
1. File exists for this `namespace + courseId`
2. `cmi.exit === 'suspend'` in saved data
3. `forceNew` flag is NOT set

Otherwise, the file is ignored (but left on disk for debugging).

---

## Flags and Options

We use **simple boolean flags** instead of multiple code paths:

### `forceNew` (startup option)

```javascript
scormService.initializeSession(sessionId, courseId, { forceNew: true })
```

- Skips loading saved session data (ignores any saved file)
- Forces `cmi.entry = 'ab-initio'`
- Next save will naturally overwrite the old file
- Use when user explicitly wants to "start over"

### `reload` (startup option)

```javascript
scormService.initializeSession(sessionId, courseId, { reload: true })
```

- Terminates existing session first (saves data)
- Then loads course with resume check
- Use for course reload functionality

### No More Complex Options

We **deliberately avoid** flags like:
- ❌ `shouldResume` (data model tells us)
- ❌ `saveOnExit` (always save)
- ❌ `checkForSavedData` (always check)
- ❌ `resumeMode` (determined by `cmi.exit`)

These add complexity without benefit. The data model already contains the information we need.

---

## Why This Approach is Better

### 1. **Predictable Behavior**
- Shutdown always saves → no lost data
- Startup always checks → no missed resumes
- One code path → consistent behavior

### 2. **Easier Debugging**
- Problem with resume? Check one startup path
- Problem with saving? Check one shutdown path
- No "which path did it take?" questions

### 3. **SCORM Compliant**
- Follows SCORM 2004 spec exactly
- Uses `cmi.exit` and `cmi.entry` as designed
- No custom "magic" logic

### 4. **Maintainable**
- Less code to maintain
- Fewer branches = fewer bugs
- Clear decision points

### 5. **Testable**
- One startup path to test
- One shutdown path to test
- Simple E2E test scenarios

---

## What We Removed

### Eliminated Code Paths

1. **Multiple shutdown functions**
   - Before: `terminate()`, `shutdown()`, `close()`, `cleanup()`
   - After: `terminate()` (one function)

2. **Multiple startup functions**
   - Before: `initialize()`, `initializeWithResume()`, `initializeNew()`, `reload()`
   - After: `initializeSession()` (one function with flags)

3. **Resume decision logic scattered everywhere**
   - Before: Checks in GUI, main process, renderer
   - After: One check in `initializeSession()`

4. **Conditional saving logic**
   - Before: "Should we save? Let me check 5 things..."
   - After: "Save it."

### Simplified MCP API

- Before: 8+ different session management tools
- After: 4 core tools + deprecated aliases

---

## Migration Guide

### If You Were Using Old Shutdown Paths

❌ **Old:**
```javascript
// Multiple ways to shutdown
await scormService.shutdown(sessionId);
await scormService.close(sessionId);
await scormService.terminate(sessionId);
```

✅ **New:**
```javascript
// One way
await scormService.terminate(sessionId);
```

### If You Were Using Old Startup Paths

❌ **Old:**
```javascript
// Complex resume logic
if (shouldResume) {
  await scormService.initializeWithResume(sessionId, savedData);
} else {
  await scormService.initialize(sessionId);
}
```

✅ **New:**
```javascript
// Automatic resume decision
await scormService.initializeSession(sessionId, courseId);

// Or force new if needed (skips saved data, will overwrite on next save)
await scormService.initializeSession(sessionId, courseId, { forceNew: true });
```

### If You Were Using Old MCP Tools

❌ **Old:**
```javascript
// Multiple tools for same thing
await mcp.scorm_session_open(coursePath);
await mcp.scorm_session_shutdown();
await mcp.scorm_session_terminate();
```

✅ **New:**
```javascript
// Clear, simple API
await mcp.scorm_open_course(coursePath);
await mcp.scorm_close_course();
```

---

## Testing Strategy

### Unit Tests
- Test `terminate()` always saves
- Test `initializeSession()` checks saved data
- Test `forceNew` flag deletes saved data
- Test resume when `exit='suspend'`
- Test fresh start when `exit!='suspend'`

### E2E Tests
- Load course, navigate, reload → verify resume
- Load course, force new → verify fresh start
- Load course, close, reopen → verify resume
- GUI reload button → verify resume

### Current Status
- ✅ 26/32 E2E tests passing
- ✅ Unified paths implemented
- ✅ MCP API updated
- 🔄 Resume functionality verification in progress

---

## Future Work

### What We Will NOT Do

We will **NOT** add:
- ❌ Additional shutdown paths "for special cases"
- ❌ Additional startup paths "for edge cases"  
- ❌ Complex resume heuristics
- ❌ "Smart" save logic that tries to guess intent
- ❌ More MCP tools for session management

### What We Might Do

- ✅ Add more robust error handling in existing paths
- ✅ Add logging for debugging
- ✅ Add metrics/telemetry for usage patterns
- ✅ Optimize performance of save/load operations
- ✅ Add user preferences for default behavior

But all within the **same unified paths**. No new branches.

---

## Questions and Answers

### Q: What if I want to save but not resume?

**A:** Set `cmi.exit = 'normal'` or `'logout'` before calling Terminate. The data will be saved (as always), but startup will see `exit !== 'suspend'` and start fresh.

### Q: What if saved data is corrupted?

**A:** `initializeSession()` has error handling. If saved data can't be parsed, it falls back to fresh start. The corrupted file remains on disk for debugging.

### Q: What if I want to ignore saved data without deleting it?

**A:** That's exactly what `forceNew: true` does! It skips loading saved data, starts fresh, and the old file will be overwritten on the next save. The old file isn't explicitly deleted - it's just ignored and will be naturally overwritten.

### Q: What if the course is updated and old saved data is incompatible?

**A:** This is a course design problem, not a runtime problem. Courses should version their `suspend_data` and handle old versions gracefully. We don't try to solve this at the runtime level.

### Q: Why not make saving optional for performance?

**A:** Modern SSDs make JSON writes negligible (~1ms). The reliability gain from always saving far outweighs any performance concern. If saving becomes a bottleneck, we'll optimize the save operation, not make it conditional.

---

## Summary

**Old approach:** Multiple shutdown paths, multiple startup paths, complex resume logic, conditional saving.

**New approach:** One shutdown path (always saves), one startup path (always checks), simple flags for special cases.

**Result:** Predictable, maintainable, testable, SCORM-compliant session management.

**Guiding principle:** Keep it simple. Let the SCORM data model (`cmi.exit`, `cmi.entry`) do the work. Don't add complexity.

---

*For implementation details, see:*
- `src/main/services/scorm-service.js` - Core session lifecycle
- `src/mcp/tools/session.js` - MCP API
- `e2e/course-reload-resume.spec.ts` - E2E tests
- `e2e/course-reload-button.spec.ts` - GUI reload test
