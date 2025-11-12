# MCP Bug Fix: Async Promise Cloning Error

**Date:** November 12, 2025  
**Issue Type:** Critical Bug Fix  
**Severity:** High  
**Status:** Fixed

## Summary

Fixed "An object could not be cloned" errors in all MCP DOM tools caused by not awaiting promises returned by async scripts. This affected `scorm_dom_fill`, `scorm_dom_fill_form_batch`, and all other DOM interaction tools.

## Root Cause Analysis

### The Problem

The error occurred when `RuntimeManager.executeJS` tried to return the result of executing async IIFE scripts. Electron's structured clone algorithm cannot clone Promise objects, causing the cloning error.

**The Flow:**

1. DOM tools create scripts as async IIFEs: `(async () => { ... })()`
2. These scripts are passed to `RuntimeManager.executeJS(null, script, session_id)`
3. The script is wrapped in: `eval(${JSON.stringify(script)})`
4. When `eval()` executes the stringified async IIFE, it returns a **Promise**
5. The wrapper did **NOT** await this Promise
6. Electron's structured clone algorithm tried to clone the **unresolved Promise object**
7. Promises contain internal slots that cannot be cloned → **"An object could not be cloned"**

### Code Comparison

**BEFORE (Broken):**

```javascript
const wrappedScript = `
  (() => {
    try {
      const __result = eval(${JSON.stringify(script)});  // Returns Promise, not awaited!
      return { success: true, result: __result };  // Tries to clone Promise object
    } catch (__error) {
      return { success: false, error: {...} };
    }
  })()
`;
```

The wrapper IIFE was **synchronous** `(() => {})`, but the eval'd script returned a Promise. The synchronous wrapper immediately returned an object containing an unresolved Promise.

**AFTER (Fixed):**

```javascript
const wrappedScript = `
  (async () => {
    try {
      const __result = await eval(${JSON.stringify(script)});  // Now awaits the Promise!
      return { success: true, result: __result };  // Returns resolved value
    } catch (__error) {
      return { success: false, error: {...} };
    }
  })()
`;
```

The wrapper IIFE is now **async** `(async () => {})` and **awaits** the Promise, so `__result` contains the resolved value (a plain object with primitives), which CAN be cloned.

## Why This Wasn't Caught Earlier

1. **Most scripts were synchronous** - API calls like `window.API_1484_11.Initialize()` don't need async
2. **DOM scripts need async** - For `await new Promise(r => setTimeout(r, 100))` and other timing operations
3. **Worked in direct execution** - When called from Electron child (no IPC), different code path
4. **Only failed in MCP mode** - When Node.js parent → Electron child via IPC, hits the broken path

## The Fix

Modified `RuntimeManager.executeJS` in **two locations**:

### Location 1: Direct Execution (lines 833-857)

```javascript
static async executeJS(win, script, session_id = null) {
  // ... session_id handling ...
  
  // Changed from sync wrapper to async wrapper
  const wrappedScript = `
    (async () => {  // <-- Added async
      try {
        const __result = await eval(${JSON.stringify(script)});  // <-- Added await
        return { success: true, result: __result };
      } catch (__error) {
        return { success: false, error: {...} };
      }
    })()
  `;
  
  const jsResult = await win.webContents.executeJavaScript(wrappedScript, true);
  // ...
}
```

### Location 2: IPC Handler (lines 233-262)

```javascript
case 'runtime_executeJS': {
  const jsWin = this.getPersistent(message.params.session_id);
  if (!jsWin) throw new Error('Runtime not open');

  // Changed from sync wrapper to async wrapper
  const wrappedScript = `
    (async () => {  // <-- Added async
      try {
        const __result = await eval(${JSON.stringify(message.params.script)});  // <-- Added await
        return { success: true, result: __result };
      } catch (__error) {
        return { success: false, error: {...} };
      }
    })()
  `;
  
  const jsResult = await jsWin.webContents.executeJavaScript(wrappedScript, true);
  // ...
}
```

## Affected Tools

**All MCP DOM tools are now fixed:**

- `scorm_dom_click`
- `scorm_dom_fill`
- `scorm_dom_fill_form_batch`
- `scorm_dom_query`
- `scorm_dom_evaluate`
- `scorm_dom_wait_for`
- `scorm_keyboard_type`
- `scorm_dom_find_interactive_elements`
- `scorm_dom_click_by_text`

**Plus automation tools that use `executeJS`:**

- All `scorm_automation_*` tools
- `scorm_navigate_to_slide`
- `scorm_get_slide_map`
- And any other tool using `RuntimeManager.executeJS`

## Testing

### Test Case 1: Single Field Fill

```javascript
scorm_dom_fill({
  session_id: "test123",
  selector: "#demo-name",
  value: "Test User"
})
```

**Before:** ❌ "An object could not be cloned"  
**After:** ✅ Success

### Test Case 2: Batch Form Fill

```javascript
scorm_dom_fill_form_batch({
  session_id: "test123",
  fields: [
    {selector: "#field1", value: "value1"},
    {selector: "#field2", value: "value2"},
    {selector: "#field3", value: "value3"}
  ]
})
```

**Before:** ❌ All 3 failed with cloning error  
**After:** ✅ All 3 succeed

### Test Case 3: SVG Elements

```javascript
scorm_dom_fill({
  session_id: "test123",
  selector: "svg text.classname",
  value: "test"
})
```

**Before:** ❌ Cloning error (if className fixes weren't applied)  
**After:** ✅ Success (with both async await + className fixes)

## Secondary Fix: SVG className

While fixing the async issue, also applied proper string conversion for `className` to handle SVG elements (see previous commits). Both fixes were needed for complete resolution.

## Impact

- **Before:** ALL DOM interaction tools failed with cloning errors
- **After:** All DOM tools work correctly with both HTML and SVG elements
- **Performance:** No performance impact (async/await is negligible overhead)
- **Compatibility:** Fully backward compatible

## Files Modified

- `src/mcp/runtime-manager.js` - Added `async` and `await` to wrapper in 2 locations

## Lessons Learned

1. **Always await async results** - Even when wrapping with `eval()`, must await promises
2. **Test both sync and async paths** - Different code paths for direct vs. IPC execution
3. **Structured clone is strict** - Cannot clone Promises, functions, DOM nodes, or circular refs
4. **Script wrapper must match script type** - Async scripts need async wrappers

## Prevention

1. **Code review checklist:** All `executeJavaScript` wrappers must use async/await if scripts may be async
2. **Unit tests:** Add tests that verify async scripts are properly awaited
3. **Integration tests:** Test MCP tools against real SCORM content with form fields
