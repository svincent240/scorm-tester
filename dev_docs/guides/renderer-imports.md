# Renderer Imports

## Problem: Static ES6 Imports in Custom Protocols

Using static ES6 `import` statements (e.g., `import { module } from './module.js';`) in Electron renderer scripts loaded via **custom protocols** (like `scorm-app://`) leads to a critical runtime error:

```
[ERROR] Uncaught SyntaxError: Cannot use import statement outside a module
```

This occurs because Electron's custom protocols do not fully support ES6 modules in the same way as standard web contexts, even when `type="module"` is explicitly added to the script tag.

## Solution: Mandate Dynamic Imports

To prevent the `SyntaxError` and ensure proper module loading in Electron renderer processes, **you MUST use dynamic imports** instead of static ES6 imports when scripts are loaded via custom protocols.

### Why Dynamic Imports?

Dynamic imports (`await import('./path/to/module.js')`) are the only reliable method for module loading in this specific Electron environment because:

1.  **Protocol Compatibility:** They bypass the limitations of Electron's custom protocol handling for ES6 modules.
2.  **Runtime Flexibility:** Modules are loaded asynchronously at runtime, which is compatible with how custom protocols serve content.
3.  **Error Handling:** They allow for robust error handling (e.g., `try...catch` blocks) if a module fails to load, preventing application crashes.
4.  **Modular Architecture:** They enable maintaining a clean, organized, and modular codebase without resorting to monolithic files or global variables.

### When is this Required?

This strategy is **strictly required** for:

*   **All JavaScript files executed within the Electron renderer process** that are loaded via a custom protocol (e.g., `scorm-app://`).
*   Specifically, the main renderer entry point, such as [`src/renderer/app.js`](../../src/renderer/app.js), and any modules it directly or indirectly imports.
*   Ensuring the main script tag in [`index.html`](../../index.html) (or similar entry HTML files) does **NOT** use `type="module"`. It should be a regular script.

## Implementation Guidance

### ✅ Recommended Approach: Dynamic Imports

```javascript
// ❌ AVOID: Static imports will cause errors in custom protocols
// import { appManager } from './services/app-manager.js';

// ✅ USE THIS: Dynamic imports for all module loading in custom protocol contexts
async function initializeApplication() {
  try {
    // Load required services dynamically
    const { appManager } = await import('./services/app-manager.js');
    const { eventBus } = await import('./services/event-bus.js');
    
    // Initialize application components
    await appManager.initialize();
    // ... other initializations
    
  } catch (error) {
    console.error('Application initialization failed due to module loading:', error);
    // Implement user-friendly error display or fallback
  }
}

// Call the initialization function
initializeApplication();
```

### Quick Fix Checklist

If you encounter the "Cannot use import statement outside a module" error:

1.  **Replace Static Imports:** Change `import { module } from './module.js';` to `const { module } = await import('./module.js');`.
2.  **Wrap in Async Function:** Ensure the code performing dynamic imports is within an `async` function.
3.  **Add Error Handling:** Implement `try...catch` blocks around dynamic imports.
4.  **Verify HTML Script Tag:** Confirm that the main script in `index.html` is loaded as a regular script (no `type="module"`).
5.  **Test Thoroughly:** Verify that the application loads and functions correctly after changes.

## Anti-Patterns (Do NOT Use)

The following approaches are explicitly forbidden as they violate architectural principles or introduce unnecessary complexity:

*   **Self-contained scripts:** Consolidating all functionality into a single, monolithic file. (Violates file size limits, reduces readability).
*   **Global variables:** Attaching modules or their exports directly to the `window` object. (Poor architecture, leads to naming collisions, difficult to track dependencies).
*   **Script concatenation:** Relying on build steps to combine files into a single bundle for the renderer. (Adds build complexity, obscures module boundaries).

## Guidance for AI Tools

AI tools working on this project **MUST strictly adhere** to this module strategy when generating or modifying code for Electron renderer processes, especially those loaded via custom protocols.

*   **Prioritize Dynamic Imports:** Always generate `await import(...)` for module loading in these contexts.
*   **Prohibit Static Imports:** Never introduce `import ... from '...'` statements in renderer code intended for custom protocols.
*   **Enforce Error Handling:** Always include `try...catch` blocks around dynamic imports.
*   **Respect HTML Configuration:** Understand that `index.html` (or similar) loads the main renderer script as a regular script, not a module.
*   **Maintain Modularity:** Continue to design and implement code in a modular fashion, leveraging dynamic imports to connect components.

Strict adherence to this document is paramount for maintaining the stability, performance, and architectural integrity of the application.