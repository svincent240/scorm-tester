@ -1,97 +0,0 @@
# Electron ES6 Module Loading Issue

## Problem

Using static ES6 `import` statements in Electron renderer scripts loaded via custom protocols causes this error:

```
[ERROR] Uncaught SyntaxError: Cannot use import statement outside a module
```

## Root Cause

Electron's custom protocols (like `scorm-app://`) don't support ES6 modules the same way as standard web contexts. Even adding `type="module"` to the script tag doesn't resolve this limitation.

## Solution

**Use dynamic imports instead of static ES6 imports in renderer scripts loaded via custom protocols.**

### ✅ Recommended Approach: Dynamic Imports

Dynamic imports work in regular scripts and maintain modular architecture:

```javascript
// ❌ Don't use static imports (causes error)
import { appManager } from './services/app-manager.js';

// ✅ Use dynamic imports instead
async function initializeApplication() {
  try {
    const { appManager } = await import('./services/app-manager.js');
    await appManager.initialize();
  } catch (error) {
    console.error('Failed to load modules:', error);
  }
}
```

### Benefits of Dynamic Imports

1. **Works with Electron custom protocols** - No module loading errors
2. **Maintains modular architecture** - Keep code organized in separate files
3. **Supports error handling** - Graceful fallbacks if modules fail to load
4. **Preserves file size limits** - Avoid monolithic files

## Implementation Pattern

```javascript
/**
 * Load and initialize application modules dynamically
 */
async function initializeApplication() {
  try {
    // Load required services
    const { appManager } = await import('./services/app-manager.js');
    const { eventBus } = await import('./services/event-bus.js');
    
    // Initialize application
    await appManager.initialize();
    
  } catch (error) {
    console.error('Application initialization failed:', error);
    // Show user-friendly error message
  }
}
```

## Quick Fix

If you see the "Cannot use import statement outside a module" error:

1. **Replace static imports** with dynamic imports:
   ```javascript
   // Change this:
   import { module } from './module.js';
   
   // To this:
   const { module } = await import('./module.js');
   ```

2. **Wrap in async function** if not already in one
3. **Add error handling** for failed imports
4. **Test that the application loads properly**

## Files Affected

- [`src/renderer/app.js`](../../src/renderer/app.js) - Main renderer entry point (uses dynamic imports)
- [`index.html`](../../index.html) - Script loading configuration (regular script, not module)

## Alternative Approaches (Not Recommended)

1. **Self-contained scripts** - Put all functionality in one file (violates file size limits)
2. **Global variables** - Attach modules to window object (poor architecture)
3. **Script concatenation** - Build step to combine files (adds complexity)

## Conclusion

Dynamic imports provide the best balance of modular architecture and Electron compatibility. This approach allows maintaining clean separation of concerns while working within Electron's custom protocol limitations.