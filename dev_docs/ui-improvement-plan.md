# UI Improvement Plan for SCORM Tester

This document outlines a plan for enhancing the User Interface (UI) of the SCORM Tester application, based on a comprehensive review of the `src/renderer` directory and existing `dev_docs`. The goal is to improve UI effectiveness, maintainability, and user experience, aligning with the project's modular, event-driven, and service-oriented architecture.

## Current UI Architecture Strengths

The SCORM Tester's UI is built on a solid foundation:
*   **Modular Components:** Utilizes a `BaseComponent` class for consistent lifecycle management, event handling, and DOM utilities.
*   **Event-Driven Communication:** Employs a centralized `EventBus` for loose coupling between components and services.
*   **Service-Oriented Design:** Clear separation of concerns with dedicated services for UI state (`uiState`), SCORM API interaction (`scormClient`, `scormAPIBridge`), course loading (`courseLoader`), and sequencing/navigation (`snBridge`).
*   **Key Features:** The `DebugPanel` (now to be focused on as a separate window) and `NavigationControls` (with its robust fallback mechanism) are critical for the tool's primary function.

## Proposed UI Improvements

The following recommendations aim to refine existing patterns, enhance modularity, and improve consistency for a more maintainable and robust application.

### 1. Centralize Error/Success Notifications (Implemented)

*   **Issue:** Inconsistent error and success messaging across the application. Some parts use native `alert()`, others log to console, and some components implement their own error display logic (e.g., `BaseComponent.showErrorState`, `ContentViewer.showError`). This leads to a fragmented and potentially intrusive user experience.
*   **Implementation:** All application-level error and success notifications have been consolidated through the `uiState.showNotification` mechanism.
    *   `AppManager` has been updated to use `uiState.showNotification` for all application-wide messages (e.g., course load success/failure).
    *   `BaseComponent.showErrorState` has been refactored to leverage `uiState.showNotification`, removing previous inline CSS injection and direct DOM manipulation for error display.
    *   `ContentViewer.showError` and `showEnhancedError` now integrate with `uiState.showNotification` for consistency.
*   **Benefit:** Consistent, non-blocking, and user-friendly feedback; easier management of notification styles and behavior; improved maintainability.

### 2. Refine CSS Management for Dynamically Injected Elements (Implemented)
 
*   **Issue:** Certain components inject `<style>` tags directly into the DOM (`BaseComponent.showErrorState`) or into iframes (`ContentViewer.applyContentScaling`). While functional, this can lead to less maintainable CSS and potential conflicts.
*   **Implementation:** Dynamic styles have been externalized into dedicated CSS files.
    *   `src/styles/components/error-state.css` and `src/styles/components/content-scaling.css` were created.
    *   `BaseComponent.showErrorState` no longer injects inline CSS; error notification styling is handled by `uiState.showNotification` and defined in `src/styles/components/error-state.css`.
    *   `ContentViewer.applyContentScaling` now applies scaling by adding a `scaled-content` class and CSS variables to the iframe's `body` element, with styles defined in `src/styles/components/content-scaling.css`.
    *   `src/styles/main.css` was updated to import these new CSS files.
*   **Benefit:** Cleaner codebase; better adherence to CSS best practices and `dev_docs/style.md` (separation of concerns); improved maintainability and debugging of styles.

### 3. Decouple `ProgressTracking` from Global DOM Elements (Implemented)

*   **Issue:** The `ProgressTracking.updateFooterElements` method directly queried and manipulated global DOM elements by their IDs (e.g., `footer-progress-fill`, `footer-status`), creating tight coupling.
*   **Implementation:**
    *   Created `src/renderer/components/scorm/footer-progress-bar.js` and `src/renderer/components/scorm/footer-status-display.js` as `BaseComponent`-derived components.
    *   Modified `src/renderer/components/scorm/progress-tracking.js` to remove direct DOM manipulation of footer elements.
    *   Ensured `uiState.updateProgress` (in `src/renderer/services/ui-state.js`) emits the full `progressData` object with the `progress:updated` event.
    *   Configured `src/renderer/services/app-manager.js` to initialize the new `FooterProgressBar` and `FooterStatusDisplay` components, which now subscribe to `progress:updated` events and update their respective DOM elements.
*   **Benefit:** Increased modularity; reduced coupling; improved testability; better adherence to the component-based architecture.
*   **Verification Notes:**
    *   **Progress Percentage (cmi.progress_measure):** The "Learning Progress" percentage remains at "0%" because the sample SCORM course does not send updates for `cmi.progress_measure`. The application correctly displays the data it receives.
    *   **Completion Status (cmi.completion_status):** The "STATUS" remains "In Progress" because the sample SCORM course explicitly sets `cmi.completion_status` to "incomplete" and never sends a "completed" or "passed" signal. The application accurately reflects the course's reported status.

### 4. Eliminate Embedded Debug Panel; Focus on Separate Debug Console Window (Implemented)

*   **Issue:** The `DebugPanel` component was instantiated and used in two places: as an embedded panel within the main application window, and as the primary content of a separate "Debug Console" Electron window (`debug.html`). This created redundancy and a potentially confusing user experience.
*   **Implementation:** All debug functionality has been consolidated into the separate "Debug Console" window.
    *   **Removed `DebugPanel` instantiation from `AppManager`:** The embedded debug panel was eliminated from the main application window.
    *   **Updated `AppManager.toggleDebugPanel()`:** This method now triggers the creation or focus of the separate "Debug Console" window via an IPC call (`open-debug-window`) from the renderer process to the main process's `WindowManager.createDebugWindow()`.
    *   **Ensured `debug.html` is the sole entry point for `DebugPanel`:** All debug-related UI and logic now resides exclusively within the separate "Debug Console" window.
    *   **Verified IPC communication:** Confirmed that necessary debug data (API calls, SCORM state changes, errors) is correctly sent from the main process (and main renderer process) to the "Debug Console" window via the `debug-event` channel, and buffered calls are sent upon debug window creation.
*   **Benefit:** Removes redundancy; provides a dedicated, more flexible, and potentially more feature-rich debugging environment; aligns with user preference for a separate debug window.

### 5. Standardize Debugging Configuration (Revised)

*   **Issue:** Reliance on the global `window.scormDebug` variable in `ContentViewer` and `ScormClient` to control debug logging. This is a less structured approach for managing application-wide debug behavior.
*   **Recommendation:** Replace `window.scormDebug` with a more robust mechanism. All relevant debug data (e.g., SCORM API calls, internal state changes) should *always* be emitted via the `EventBus` and then forwarded via IPC to the main process. The main process can then route this data to the separate "Debug Console" window. The "Debug Console" window itself (or the `DebugPanel` component within it) can then manage its display and filtering based on its own internal settings or `uiState` flags (e.g., a `ui.devModeEnabled` flag).
*   **Benefit:** More robust and controllable debugging; cleaner code; better alignment with `uiState`'s purpose; ensures debug data is available for the dedicated debug window regardless of a global flag.

### 6. Clarify/Streamline SCORM API Injection

*   **Issue:** There appears to be potential redundancy or unclear responsibility between `ScormAPIBridge.injectScormAPI` (which uses `iframe.srcdoc` to inject a wrapper HTML with the API script) and `ContentViewer.setupScormAPI` (which directly injects `window.API` and `window.API_1484_11` into the iframe's `contentWindow` after the content loads). `ContentViewer.setupScormAPI` seems to be the more active and direct method.
*   **Recommendation:** Review and streamline the SCORM API injection process. If `ContentViewer.setupScormAPI` is confirmed as the primary and more effective method for injecting the SCORM API into the content iframe, then `ScormAPIBridge.injectScormAPI` should be removed to avoid confusion and potential conflicts. If `ScormAPIBridge.injectScormAPI` serves a specific, distinct purpose (e.g., for very early API access or specific content types), that purpose should be clearly documented.
*   **Benefit:** Reduced code complexity; clearer responsibilities; improved maintainability.

### 7. Enhance `AppManager`'s Component Initialization Robustness

*   **Issue:** `AppManager.initializeComponents` directly checks for the existence of DOM elements by ID (`document.getElementById`) for each component. If an element is not found, it logs a `console.warn`. While functional, this approach can be brittle if DOM IDs change or components become optional.
*   **Recommendation:** Make component initialization more declarative and robust. Consider using a configuration array for components, where each entry specifies the component class, its target element ID, and whether it's optional or required. For required components, throw a more explicit error if their root element is missing. For optional components, handle their absence gracefully without warnings unless it indicates a misconfiguration.
*   **Benefit:** More explicit component dependency management; clearer error reporting for missing UI elements; improved maintainability of the initialization process.

### 8. Improve `AppManager`'s Progress Tracking Container Creation

*   **Issue:** `AppManager` currently creates a hidden `div` with the ID `progress-tracking` and appends it to `document.body` if it doesn't already exist. This suggests a workaround for the `ProgressTracking` component's intended placement (e.g., in a footer).
*   **Recommendation:** If the `ProgressTracking` component is intended to always render into a specific footer element, ensure that element is explicitly defined in the main `index.html` and `ProgressTracking` is initialized with its ID. The `AppManager` should not be responsible for creating arbitrary DOM elements for components unless they are truly dynamic or optional. This clarifies the intended DOM structure.
*   **Benefit:** Clearer separation of concerns between application orchestration and DOM structure; improved predictability of component rendering.

### Additional UI/Layout Issues (Reported by User)

These issues were reported by the user after the initial review and require investigation and fixing.

9.  **"Course Structure" Section Not Working:**
    *   **Issue:** The `CourseOutline` component (responsible for the "Course Structure" section) is reported as "not working." This could manifest as content not displaying, updates not occurring, or functional issues.
    *   **Recommendation:** Investigate the root cause of the `CourseOutline` component's reported malfunction. This will involve debugging its initialization, data loading (`handleCourseLoaded`, `loadCourseStructure`), rendering (`renderCourseStructure`), and event handling (`handleNavigationUpdated`, `handleProgressUpdated`, `handleScormDataChanged`). Ensure it correctly receives and processes course data and updates its display.
    *   **Benefit:** Restores critical functionality for course navigation and overview.

10. **Navigation Controls Overlay/Cut-off Issues:**
    *   **Issue:** The navigation controls (text like "Learning Management System", "No course loaded", "← Previous Next → ☰ Menu") are reported as "overlays" that are "not working and cut off." This strongly suggests CSS, layout, or z-index issues preventing proper display and interaction.
    *   **Recommendation:** Investigate the styling and layout of the `NavigationControls` component and its parent containers. This will involve examining `src/styles/components/layout.css`, `src/styles/components/navigation-controls.css`, and potentially `main.css` or `index.html` to identify conflicting styles, incorrect positioning, or z-index problems that cause the elements to be cut off or appear as unintended overlays. Ensure responsiveness across different window sizes.
    *   **Benefit:** Improves usability and visual integrity of core navigation elements.