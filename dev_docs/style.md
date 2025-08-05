# Code Style, Naming Conventions, and Formatting Guidelines

This document outlines the code style, naming conventions, and formatting rules for the SCORM Tester project. Adhering to these guidelines ensures consistency, readability, and maintainability across the codebase.

## File Size and Complexity

The previous rigid 200-line limit per file has been re-evaluated. The new guidelines prioritize logical cohesion and readability over a strict line count.

*   **Prioritize Logical Cohesion and Readability:** Files should encapsulate a single, well-defined logical unit or responsibility. Avoid creating files solely to meet an arbitrary line limit if it fragments related logic.
*   **Flexible Size Guidelines:** While striving for conciseness, files may exceed a strict line count (e.g., up to 500-800 lines for complex core modules like SCORM RTE, CAM, or SN components) if it improves overall readability, reduces artificial fragmentation, and keeps related logic together. The goal is to reduce the *number of files* for a given logical unit, not just the lines in each file.
*   **Keep Functions and Classes Focused and Small:** Individual functions and classes within files should remain focused on a single task. Large files should still be composed of small, well-defined functions and classes.

## Naming Conventions

*   **Variables:** `camelCase`
*   **Functions:** `camelCase`
*   **Classes:** `PascalCase`
*   **Constants:** `SCREAMING_SNAKE_CASE` (for global constants) or `camelCase` (for local constants)
*   **Files:** `kebab-case` for directories, `kebab-case.js` or `PascalCase.js` for modules/classes.

## Formatting

*   **Indentation:** 2 spaces (soft tabs).
*   **Semicolons:** Always use semicolons.
*   **Quotes:** Single quotes for strings, unless escaping is required.
*   **Braces:** K&R style (opening brace on the same line as the control statement).
*   **Line Length:** Aim for a maximum of 120 characters per line, but prioritize readability over strict adherence.

## Documentation

*   Use JSDoc for all functions, classes, and complex variables.
*   Provide clear and concise comments for complex logic.

## General Principles

*   **No Duplicate Code:** Reuse existing functionality or refactor common parts.
*   **Separation of Concerns:** Keep UI logic, business logic, and data access in separate modules.
*   **Respect the Architecture:** Adhere to the system architecture described in [architecture/overview.md](architecture/overview.md:1).
*   **No Temporary Fixes:** Avoid shortcuts; fix the root cause.
*   **Testing:** Every new feature or bug fix must include tests.

## Renderer-Specific Rules

These rules enforce the centralized logging, error handling, and UI state patterns now implemented throughout the renderer.

*   Logging:
    *   Do not use console.* in renderer code.
    *   Use the centralized renderer logger adapter at [src/renderer/utils/renderer-logger.js](src/renderer/utils/renderer-logger.js:1).
    *   All renderer logs must route to the app log via the shared logger.
*   Error handling:
    *   Do not inject inline error HTML in the renderer.
    *   On errors, log via renderer logger, set UI error, show notifications, and emit events as appropriate:
        *   See [src/renderer/app.js](src/renderer/app.js:31) and [src/renderer/services/app-manager.js](src/renderer/services/app-manager.js:349).
*   EventBus debug mode:
    *   Default off.
    *   Synchronized from UIState.ui.devModeEnabled.
    *   See [src/renderer/services/app-manager.js](src/renderer/services/app-manager.js:90), [src/renderer/services/ui-state.js](src/renderer/services/ui-state.js:240), [src/renderer/services/event-bus.js](src/renderer/services/event-bus.js:219).
*   Navigation state authority:
    *   UIState is the authoritative source for navigation state.
    *   Components emit intents (e.g., navigation:request) and subscribe to normalized UIState.navigationState.
    *   Wiring of NavigationControls to ContentViewer is managed by AppManager.
    *   See [src/renderer/services/app-manager.js](src/renderer/services/app-manager.js:177).
*   Content scaling and API injection:
    *   Prefer direct SCORM API injection; use bridge as fallback.
    *   Verify API presence after load; notify user on failure.
    *   Scaling uses CSS variables and class hooks defined in styles.
    *   See [src/renderer/components/scorm/content-viewer.js](src/renderer/components/scorm/content-viewer.js:905) and [src/styles/components/content-viewer.css](src/styles/components/content-viewer.css:123).
*   CSS validity:
    *   Use valid selectors for pseudo-classes; no nested & in plain CSS.
    *   See [src/styles/components/navigation-controls.css](src/styles/components/navigation-controls.css).