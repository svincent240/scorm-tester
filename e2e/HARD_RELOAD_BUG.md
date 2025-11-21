# Hard Reload Bug Documentation

## Issue Description

When performing a hard reload (Shift+Click on Reload button), SCORM error 132 occurs during the iframe reload process.

## Error Details

```
[SCORM Error Event] Code: 132, Message: Store data before initialization: cmi.exit
```

## Root Cause

The reload flow is:

1. AppManager calls `Terminate()` on the course API to properly shut down
2. AppManager waits 300ms for persistence to complete
3. AppManager triggers the reload by calling `courseLoader.loadCourseFromPath/loadCourseFromFolder`
4. The iframe begins to reload/navigate to the new content
5. **BUG**: The course's `beforeunload` event handler fires and tries to call `SetValue('cmi.exit', 'suspend')`
6. But the SCORM session has already been terminated, so error 132 occurs: "Store data before initialization"

## Expected Behavior (Per Spec)

Per `spec.md` section 5.1:
- "Unified Shutdown: Close/reload/terminate ALL follow identical sequence: set cmi.exit='suspend', call Terminate(''), wait (GUI only), destroy window."
- Hard reset flag should skip the JSON loading step but still follow the shutdown sequence properly

## The Problem

The course content's beforeunload handler is a safety mechanism that tries to save data if the page is closing unexpectedly. However, during a controlled reload:
1. We've already called Terminate() properly
2. The beforeunload handler fires as the iframe navigates away
3. The beforeunload handler tries to set cmi.exit but the API is already terminated
4. This generates error 132, which the test correctly detects

## Potential Solutions

### Option 1: Suppress error 132 during reload window
- Add a flag to the SCORM service that indicates "reload in progress"
- Ignore or suppress error 132 during this window
- Pros: Simple, preserves safety mechanism
- Cons: Adds state tracking, may mask real issues

### Option 2: Disable beforeunload handler before reload
- Before calling Terminate(), temporarily disable the course's beforeunload handler
- Pros: Clean, prevents the error from occurring
- Cons: Requires accessing course's internal event handlers

### Option 3: Improve course template's beforeunload logic
- Have the course's ConnectionManager check if the API is in "Terminated" state before trying to set values
- Pros: Most correct, fixes at source
- Cons: Requires changes to course template, not all courses will have this fix

### Option 4: Accept as expected behavior
- Document that error 132 during reload is expected and harmless
- Filter it from error reporting during reload window
- Pros: Accurate representation of what's happening
- Cons: Still shows errors to users during reload

## Recommendation

Option 3 is the most correct approach - the course's emergency save handler should check the API state before attempting operations. However, since we control the platform, Option 1 (suppress during reload) is a pragmatic solution that works with all course content.

## Test Results

The hard reload test successfully verifies:
- ✅ Session file exists after reload (persistence works)
- ✅ `cmi.entry` = 'ab-initio' (hard reset skipped loading JSON)
- ✅ Previous button disabled after reload (fresh start)
- ✅ Can navigate forward after reload (course works normally)
- ❌ Console errors during reload (error 132 from beforeunload handler)

The functionality works correctly; only the error reporting during the transition is problematic.
