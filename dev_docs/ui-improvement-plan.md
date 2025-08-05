# UI Improvement Plan

Scope
This plan focuses on improving the renderer UI to optimize the prioritized workflow: quick local test (load a SCORM package, launch, navigate next/previous, view progress, exit). It aligns with architecture and style rules, prioritizing centralized logging/notifications, robust navigation, clear loading/error states, and accessibility.

Objectives
- Reliability: Eliminate fragile patterns and runtime errors that impact quick testing.
- Consistency: Centralize logging and user-facing notifications.
- Usability: Ensure clear, responsive controls and status visibility throughout the workflow.
- Accessibility: Improve keyboard navigation, semantic roles, and labels in key components.
- Maintainability: Keep UI logic decoupled from business logic with EventBus + UIState patterns.

Top Issues Summary
1. Console logging and ad-hoc error UI
   - Problem: Broad console.* usage; inline error HTML injected in bootstrap and AppManager.
   - Fix: Route to centralized logger writing to app log; use UIState notifications and consistent error overlay styles.

2. EventBus debug and state feedback loops
   - Problem: Always-on console debug; potential two-way updates (NavigationControls & UIState) guarded by flags.
   - Fix: Toggle debug via UIState; prefer single source of truth for navigation state; components emit intents.

3. NavigationControls alignment and wiring
   - Problem: Button state coupling to availableNavigation without authoritative source; not explicitly wired to ContentViewer; fallback warnings via console.
   - Fix: Wire references in AppManager; feed button states from UIState or normalized SNBridge output; notify on fallback mode.

4. ContentViewer consistency
   - Problem: Duplicate SCORM API surfaces (direct injection vs ScormAPIBridge); console logs; scaling relies on CSS class presence.
   - Fix: Define precedence: direct injection primary, bridge fallback; add API presence verification; ensure scaling CSS exists.

5. Footer components uiState misuse
   - Problem: Re-awaiting uiState incorrectly, potentially clobbering the instance.
   - Fix: Use resolved uiState from BaseComponent.loadDependencies only.

6. CSS invalid nesting
   - Problem: &:hover / &:active used in plain CSS.
   - Fix: Replace with valid selectors.

7. CourseLoader.clearCourse bug
   - Problem: Calls a non-existent uiState.clearCourse().
   - Fix: Update UIState via updateCourse with cleared fields and emit course:cleared.

Planned Changes by Area

A) Centralized Logging and Notifications
- Goal: No console.* in renderer; all logs go to app log. User-facing errors via UIState notifications.
- Actions:
  1) Introduce renderer logger adapter that calls shared logger (main) via preload IPC or reuse src/shared/utils/logger.js if it writes to app.log.
  2) Replace console.* in:
     - src/renderer/app.js
     - src/renderer/services/app-manager.js
     - src/renderer/services/event-bus.js
     - src/renderer/services/ui-state.js
     - src/renderer/services/course-loader.js
     - src/renderer/services/scorm-client.js
     - src/renderer/services/scorm-api-bridge.js
     - src/renderer/components/scorm/content-viewer.js
     - src/renderer/components/scorm/navigation-controls.js
  3) Update dev_docs/guides/logging-debugging.md to document renderer logging flow and severity mapping.
- Acceptance:
  - All renderer errors/warnings written to app log.
  - User-visible errors appear via notifications (not inline HTML).

Progress (Step 1 partial complete):
- Implemented renderer logger adapter at src/renderer/utils/renderer-logger.js using direct import of src/shared/utils/logger.js.
- Replaced console.* with rendererLogger in:
  - src/renderer/app.js
  - src/renderer/services/app-manager.js
  - src/renderer/services/event-bus.js
- Centralized initialization error handling in app.js catch: logs via rendererLogger, sets uiState error + persistent notification, emits eventBus 'app:error'.
- Updated dev_docs/guides/logging-debugging.md with renderer logging flow and EventBus debug mode notes.
- Additional stabilization:
  - Added safe, cached loggers with no-op fallbacks in AppManager and EventBus to prevent early-startup undefined logger errors.
  - Set EventBus default debug mode using a guarded call and internal cached logger to avoid startup exceptions.
- Remaining for this area in future steps: replace console.* in ui-state.js, course-loader.js, scorm-client.js, scorm-api-bridge.js, content-viewer.js, navigation-controls.js; ensure severity mapping section if needed.

B) Error Handling and Initialization UX
- Goal: Consistent, styled, centralized error presentation.
- Actions:
  1) Remove inline error HTML injection:
     - src/renderer/app.js (initializeApplication catch)
     - src/renderer/services/app-manager.js handleInitializationError()
  2) Replace with:
     - logger.error
     - uiState.setError(error)
     - uiState.showNotification({ type: 'error', duration: 0 })
     - eventBus.emit('app:error', { error })
  3) Ensure styles/components/error-state.css provides global overlay/toast consistency.
- Acceptance:
  - Init failures show persistent notification; no inline style blocks.

Progress (Step 2 partial in step 1 scope):
- app.js: Removed inline error HTML in initializeApplication catch; now logs via rendererLogger, updates uiState, emits app:error.
- app-manager.js: handleInitializationError now logs via rendererLogger and uses uiState notification rather than inline HTML; emits app:error.
- Recursion guard: Added _handlingInitError flag in AppManager to prevent repeated notifications and loops during initialization failures.
- Remaining: audit any other inline error UI; verify styles/components/error-state.css alignment.

C) EventBus and Navigation State Authority
- Goal: Reduce loop risk; single source of truth for navigation availability.
- Actions:
  1) EventBus: setDebugMode based on uiState.ui.devModeEnabled; route to logger.debug.
  2) NavigationControls: emit navigation:request and updateAvailableNavigation based on normalized state from SNBridge/UIState.
  3) UIState: remains authority for navigationState; components update via uiState.updateNavigation with internal flags as necessary (retain current guards, but limit two-way writes).
- Acceptance:
  - No repeated ping-pong updates; debug output controlled via UI setting.

D) NavigationControls Wiring and Fallback UX
- Goal: Seamless navigation with clear feedback.
- Actions:
  1) AppManager after init: navigationControls.setContentViewer(contentViewer).
  2) Normalize availableNavigation and/or derive canNavigatePrevious/Next in UIState for button states.
  3) On fallback mode, show UIState warning notification and visual badge; log via logger.warn.
- Acceptance:
  - Buttons reflect accurate enabled/disabled states; fallback clearly indicated.

E) ContentViewer API Injection and Scaling
- Goal: Reliable SCORM API setup and responsive display.
- Actions:
  1) Prefer direct injection; keep ScormAPIBridge for postMessage-driven content; document precedence in dev_docs/guides/renderer-imports.md.
  2) After iframe load, validate presence of API or postMessage path; if missing, show notification explaining likely cause and next steps.
  3) Ensure styles/components/content-viewer.css defines .scaled-content and CSS variables used by ContentViewer.
- Acceptance:
  - API is available in typical packages; missing API yields actionable notification.

F) Footer Components UI State Fix
- Goal: Correct UI state resolution.
- Actions:
  1) Remove "this.uiState = await this.uiState" in:
     - src/renderer/components/scorm/footer-progress-bar.js
     - src/renderer/components/scorm/footer-status-display.js
  2) Use BaseComponent.loadDependencies-provided uiState only.
- Acceptance:
  - Footers update from progress:updated without errors.

G) CSS Validity
- Goal: Correct pseudo-selectors in plain CSS.
- Actions:
  1) Replace &:hover / &:active with .navigation-controls__btn:hover and .navigation-controls__btn:active in src/styles/components/navigation-controls.css.
  2) Audit other CSS files for similar nesting (navigation, content-viewer, forms, buttons).
- Acceptance:
  - Hover/active styles work as expected.

H) Course Clearing Workflow
- Goal: No runtime errors when clearing course.
- Actions:
  1) Update src/renderer/services/course-loader.js clearCourse():
     - Replace uiState.clearCourse() with:
       uiState.updateCourse({ info: null, structure: null, path: null, entryPoint: null });
       eventBus.emit('course:cleared');
- Acceptance:
  - Clear course path works without exceptions.

I) Accessibility and UX Enhancements
- Goal: Improve operability and clarity.
- Actions:
  1) CourseOutline:
     - Add role="tree", role="treeitem", aria-expanded, aria-selected.
     - Keyboard navigation: arrows to move/select; Enter/Space to toggle/launch.
     - Replace emoji icons with CSS classes or consistent icon set; add aria-labels.
  2) NavigationControls:
     - Ensure button labels and titles are accessible; add aria-disabled when disabled.
  3) Loading and error messages:
     - Ensure live regions (aria-live="polite/assertive") for notifications.
- Acceptance:
  - Core components navigable via keyboard; semantic roles present.

J) Tests
- Goal: Prevent regressions.
- Actions:
  1) Renderer integration tests:
     - Init error shows notification; no inline HTML.
     - Course load success updates ContentViewer and CourseOutline.
     - Navigation buttons enable/disable correctly when SNBridge state changes.
     - Footer elements reflect progress updates.
     - CSS hover styles operate (basic DOM style checks).
- Acceptance:
  - New tests pass locally; existing tests remain green.

Execution Plan and Order
1) Implement centralized logging adapter and replace console.* in prioritized files.
   - Status: Partially completed (adapter added; console replacements applied in app.js, app-manager.js, event-bus.js; docs updated; early-startup logger guards added)
2) Centralize initialization error handling and remove inline error HTML.
   - Status: Partially completed (app.js catch and app-manager handleInitializationError updated; recursion guard added)
3) Fix footer uiState misuse.
   - Status: Completed (footer-progress-bar.js and footer-status-display.js updated to rely on injected uiState only)
4) Fix navigation-controls CSS selectors.
   - Status: Completed (invalid &:hover / &:active nesting replaced with valid flat selectors in [src/styles/components/navigation-controls.css](src/styles/components/navigation-controls.css))
5) Wire NavigationControls to ContentViewer in AppManager and normalize button state source.
   - Status: Completed
   - Notes:
     - AppManager now wires NavigationControls to ContentViewer via navigationControls.setContentViewer(contentViewer) after component initialization ([src/renderer/services/app-manager.js](src/renderer/services/app-manager.js:136)).
     - NavigationControls derives authoritative button states from UIState. Available navigation from SNBridge is normalized into canNavigatePrevious/canNavigateNext and pushed to UIState; component subscribes to UIState.navigationState to reflect updates. Loop guards prevent feedback cycles. Logging uses renderer-logger.
6) Add ContentViewer API presence verification and ensure scaling CSS.
   - Status: Completed
   - Notes:
     - Implemented API presence verification in [src/renderer/components/scorm/content-viewer.js](src/renderer/components/scorm/content-viewer.js:905). After iframe load, verifyScormApiPresence() checks for direct API_1484_11/API with Initialize/LMSInitialize. If absent, probes postMessage bridge and handles response; on failure, shows persistent UIState notification and sets UI error, emitting scormApiMissing.
     - Maintains preference for direct injection; scormApiInjected event emitted upon injection. Verification runs afterward to ensure availability or trigger fallback UX.
     - Removed console logging in modified regions; user-facing errors go through UIState notifications, aligning with centralized logging rules.
     - Ensured scaling support by enhancing CSS: added body.scaled-content transform rules and CSS variable fallbacks in [src/styles/components/content-viewer.css](src/styles/components/content-viewer.css:123). ContentViewer sets --scorm-scale and related variables, then applies the class when needed.
7) Fix CourseLoader.clearCourse workflow.
  - Status: Completed
  - Notes:
    - Updated [src/renderer/services/course-loader.js](src/renderer/services/course-loader.js:241) clearCourse() to be async and await the shared uiState instance, replacing the non-existent uiState.clearCourse() with:
      uiState.updateCourse({ info: null, structure: null, path: null, entryPoint: null });
    - Preserved eventBus.emit('course:cleared') to notify consumers.
    - This aligns with centralized state management and prevents runtime errors when clearing the course.
8) Configure EventBus debug via UIState and route to logger.
9) Accessibility updates for CourseOutline/Nav controls.
10) Update dev_docs:
   - This ui-improvement-plan.md (updated with progress)
   - guides/logging-debugging.md: renderer logging guidance (updated)
   - guides/renderer-imports.md: SCORM API injection precedence and patterns
11) Add/extend renderer integration tests.

Success Metrics
- Quick test workflow completes without console errors; all notifications/logs visible in app log.
- No inline error HTML; unified notification system for init and runtime errors.
- Navigation buttons reflect sequencing availability accurately; fallback clearly indicated.
- Progress and footer elements update in real-time; no uiState misuse.
- Accessibility smoke-check: components operable via keyboard with ARIA roles set.

Mermaid Overview
flowchart TD
  A[User selects SCORM package] --> B[CourseLoader emits course:loadStart]
  B --> C[Main CAM processes manifest]
  C --> D[UIState.updateCourse + eventBus course:loaded]
  D --> E[ContentViewer loads entry + injects SCORM API]
  D --> F[CourseOutline renders tree; current item]
  E --> G[SCORM calls update UIState progress]
  G --> H[ProgressTracking + Footer update via progress:updated]
  D --> I[SNBridge initializes; provides availableNavigation]
  I --> J[UIState.navigationState normalized]
  J --> K[NavigationControls enable/disable buttons]
  K --> L[User navigates next/previous; navigation:request]
  L --> I
  E -. error/timeout .-> N[UIState notification error]
  A -. init error .-> M[Centralized init notification]

Change Log Requirements
- All code changes must include matching documentation updates in dev_docs as per repository rules.
- Add meaningful commit messages per change area (logging, error handling, CSS fix, accessibility).

Dependencies and Assumptions
- Shared logger is available or can be proxied via preload to write to app log.
- Existing styles provide base variables; adding ARIA roles won’t alter visual layout.

Ownership and Review
- Implementation will be performed in Code mode in small, reviewable commits per area (A–J).
- Tests will be added/updated to enforce behavior.