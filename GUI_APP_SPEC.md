# GUI Application Specification

## 1. Overview

This document defines the architecture for the SCORM Tester's renderer process (GUI). It is the authoritative guide for creating predictable, maintainable, and secure user interface components. The GUI's primary role is to present state and forward user intentions to the main process.

Note on rewrite completion:
- The GUI rewrite (see `GUI_REWRITE_PLAN.md`) is complete; this spec reflects the post‑rewrite architecture.
- Legacy inspector window and legacy boot scripts have been removed; the SCORM Inspector is now an integrated panel within the main UI.
- The renderer mounts into a minimal application shell; no legacy static HTML templates remain.


## 2. Core Architectural Principles

All GUI code (components, services, etc.) **MUST** adhere to these non-negotiable principles.

### 2.1. Pure Consumer of State
The GUI **MUST NOT** contain its own business logic or source-of-truth state for core concepts like SCORM data or navigation availability. It is a "dumb" renderer of state provided by the main process. The `UIState` service is the only local cache of state, and it is read-only for components.

### 2.2. Event-Driven and Intent-Based
Components **MUST** be loosely coupled. They **MUST NOT** call methods on each other directly.
- **Communication**: All interactions **MUST** happen via the `EventBus` service.
- **User Actions**: User interactions (e.g., button clicks) **MUST** be published as "intent" events (e.g., `navigationRequest`). They describe *what* the user wants to do, not *how* to do it.

### 2.3. No Fallbacks or Recovery Logic
In accordance with the core application principles, the GUI **MUST NOT** implement any fallback behaviors. If a feature's state is unavailable from the main process, the corresponding UI **MUST** be disabled or hidden. The UI does not attempt to recover from backend errors; it only displays them.

### 2.4. Strict, Centralized Logging
All logging **MUST** be directed through the `renderer-logger.js` utility. Direct use of `console.*` is strictly forbidden to ensure all diagnostic information is captured in the application's log file.

### 2.5. Systematic Security
All data that originates from an external source (e.g., SCORM package manifest) and is rendered as HTML **MUST** be properly escaped to prevent Cross-Site Scripting (XSS) attacks.

## 3. GUI Architecture

The GUI follows a service-oriented pattern with a clear separation between state, services, and components.

```
Renderer Process
├── Services
│   ├── AppManager       (Orchestrator)
│   ├── UIState          (Authoritative UI State Cache)
│   ├── EventBus         (Local Event Communication)
│   └── ScormClient      (IPC Client to Main Process)
│
└── Components
    ├── HeaderControls
    ├── CourseOutline
    ├── NavigationControls
    ├── ContentViewer
    ├── FooterStatusDisplay
    └── ScormInspectorPanel
```


### 3.0. Application Shell

- `index.html` is a minimal shell containing only `<div id="app-root"></div>` and required base tags.
- `AppManager` mounts the root component into `#app-root` at startup and wires services.
- No standalone legacy windows or HTML files (e.g., `scorm-inspector.html`) exist; the Inspector is integrated into the main UI.

### 3.1. Services
*   **`AppManager`**: The central orchestrator for the renderer. It wires services and components together on initialization. It is the primary handler for complex event sequences.
*   **`UIState`**: A read-only cache of the application's state (e.g., `navigationState`, `courseLoaded`). Components subscribe to `UIState` for updates but **MUST NOT** modify it directly. State is updated by services in response to events from the main process.
*   **`EventBus`**: The channel for all intra-renderer communication.
*   **`ScormClient`**: A wrapper around the Electron `preload` API that handles all IPC communication with the main process.

### 3.2. Components
Components are self-contained UI elements that follow a consistent lifecycle.
*   **Inheritance**: All components **SHOULD** extend `BaseComponent` to inherit common functionality like event subscription management.
*   **Responsibilities**: A component is responsible for rendering its UI based on state from `UIState` and emitting user-intent events to the `EventBus`.
*   **State**: Components **MUST NOT** maintain their own complex internal state. They should be stateless renderings of the global `UIState`.

### 3.3. Error Presentation Components

The following components are responsible for presenting errors to users:

*   **`NotificationContainer`**: Renders toast notifications from `UIState.state.ui.notifications` in a fixed position on screen.
*   **`ErrorDialog`**: Modal dialog for catastrophic errors with log export functionality.
*   **`ErrorBadge`**: Header badge showing count of unacknowledged non-catastrophic errors.
*   **`ErrorListPanel`**: Expandable panel listing all non-catastrophic errors with details and actions.

## 4. Component Contracts

### 4.1. `HeaderControls`
*   **Responsibility**: Provides primary user actions for loading courses and toggling major UI panels (e.g., Theme, SCORM Inspector).
*   **Interaction**: This component **MUST NOT** perform file operations or manage window state directly. It **MUST** emit intent-based events to the `EventBus` (e.g., `loadCourseRequest`, `toggleInspectorRequest`). Services will listen for these events and orchestrate the required actions with the main process.

### 4.2. `FooterStatusDisplay`
*   **Responsibility**: Displays summary information about the course session, such as progress, score, and time.
*   **Interaction**: As a "Pure Consumer of State," this component **MUST** subscribe to `UIState` for all data it displays (e.g., `progressState`, `sessionTime`). It **MUST NOT** perform any calculations or maintain its own state.

### 4.3. `ScormInspectorPanel`

- **Responsibility**: Provides a detailed, real-time view of the SCORM session for debugging, including:
  - **Unified Timeline**: Merges API calls and data model changes into a single chronological view
  - **API Call History**: All SCORM API interactions with parameters, results, errors, and timing
  - **Data Model Change Log**: Sequential history of all mutations to `cmi.*` elements with before/after values, source, and metadata
  - **Activity Tree**: Visual representation of the course structure and sequencing state
  - **Error Analysis**: Classified SCORM errors with context and troubleshooting information

- **Interaction**: The inspector is a "Pure Consumer" of diagnostic data. It **MUST** receive its data directly via dedicated IPC channels from the main process's `ScormInspectorTelemetryStore`:
  - Subscribe to `scorm-data-model-change` events for real-time data model updates
  - Call `getScormDataModelHistory()` to fetch initial change history on load
  - Subscribe to `scorm-inspector-data-updated` for API call updates
  - The inspector **MUST NOT** use the renderer's `EventBus` for receiving core SCORM data to ensure clean separation between application events and diagnostic telemetry

- **Timeline Features**: The unified timeline provides:
  - Independent toggles to show/hide API calls and data model changes
  - Filtering by method, element prefix, error status, and session ID
  - Pagination for large datasets
  - Copy-to-clipboard for individual entries and bulk export
  - Clear history functionality with confirmation

- **Data Model Change Display**: Each change entry shows:
  - Element path (e.g., `cmi.location`, `cmi.interactions.0.id`)
  - Previous and new values (with truncation markers for large values)
  - Source (API call, internal LMS operation, etc.)
  - Timestamp and session identifier
  - Collection metadata (index, property) for interaction/objective changes

Internal controls like filters, pagination, or export buttons manage their own view state locally.

## 5. Key Component Contracts

### 5.1. `CourseOutline`
*   **Data Source**: Its structure and state (e.g., completion status, attempt counts, enabled/disabled status) **MUST** be driven exclusively by the activity tree data fetched from the main process's SN service.
*   **Navigation**: On item click, it **MUST** first perform an authoritative IPC call (`validateCourseOutlineChoice`) to the main process to verify the navigation is permitted by SCORM sequencing rules. If and only if the main process confirms the choice is valid, it may then emit a `navigationRequest` event.

### 5.2. `NavigationControls`
*   **State**: The `enabled`/`disabled` state of the "Previous" and "Next" buttons **MUST** be derived solely from the `availableNavigation` array within `UIState.navigationState`.
*   **Action**: On click, the buttons **MUST** emit a `navigationRequest` event with the appropriate type (`continue` or `previous`).

### 5.3. `ContentViewer`
*   **Content Loading**: It **MUST** only load content from a final, resolved `scorm-app://` URL provided to it. It **MUST NOT** perform any path resolution or manipulation itself.
*   **SCORM API**: It is responsible for injecting the SCORM API bridge (`API_1484_11`) into the content iframe's window *before* the content is loaded.

## 5. Error Handling

The GUI's role in error handling is to present errors clearly to users with appropriate context and diagnostic information. All errors **MUST** be classified and presented according to their severity and impact.

### 5.1. Error Classification

Errors **MUST** be classified into two categories:

*   **Catastrophic Errors**: Errors that prevent core functionality from working. These include:
    *   Application initialization failures
    *   Course load failures
    *   Critical service crashes
    *   File system access failures
    *   IPC communication failures

*   **Non-Catastrophic Errors**: Errors that occur during operation but don't prevent the application from functioning. These include:
    *   SCORM API validation errors
    *   Individual SCO navigation failures
    *   Data model constraint violations
    *   Content rendering warnings
    *   Sequencing rule violations

### 5.2. Catastrophic Error Presentation

When a catastrophic error occurs, the GUI **MUST**:

1. **Display a Modal Dialog** that:
   *   Blocks interaction with the rest of the application
   *   Shows a clear error title and message
   *   Displays technical details in an expandable section
   *   Provides a "Copy Logs" button that copies relevant log entries to the clipboard
   *   Provides an "OK" or "Close" button to dismiss (if the application can continue)
   *   Provides a "Restart" button if the error requires application restart

2. **Log Export**: The "Copy Logs" button **MUST**:
   *   Include the last 100 lines from `app.log` or all error-level entries from `errors.ndjson`
   *   Include the specific error stack trace
   *   Include relevant context (timestamp, component, operation being performed)
   *   Format the output as readable text suitable for bug reports

### 5.3. Non-Catastrophic Error Presentation

For non-catastrophic errors, the GUI **MUST**:

1. **Display an Error Badge** in the header that:
   *   Shows the count of unacknowledged errors
   *   Uses visual indicators (color, icon) to draw attention
   *   Is clickable to open the Error List Panel
   *   Persists until the user acknowledges the errors

2. **Error List Panel**: When the badge is clicked, display a panel that:
   *   Lists all non-catastrophic errors with timestamps
   *   Shows error type, message, and affected component
   *   Provides expandable details for each error
   *   Includes a "Copy All Logs" button to export all error details
   *   Includes a "Clear All" button to acknowledge and dismiss all errors
   *   Includes individual "Dismiss" buttons for each error

3. **Toast Notifications**: For immediate feedback, non-catastrophic errors **MAY** also:
   *   Show a brief toast notification when they first occur
   *   Auto-dismiss after 5 seconds
   *   Not block user interaction

### 5.4. Error Handling Principles

*   **Display, Don't Handle**: When the GUI receives an error event from the main process, its primary job is to display it to the user via the appropriate presentation mechanism based on error classification.
*   **No Recovery**: The GUI **MUST NOT** contain complex error recovery logic. For example, if a course fails to load, it displays the error. It does not attempt to parse the course differently or find a missing file.
*   **Fail-Fast Visibility**: All errors **MUST** be surfaced to the user. Silent failures are forbidden.
*   **Diagnostic Support**: All error presentations **MUST** provide a way to export relevant logs for troubleshooting and bug reporting.

## 6. Logging

*   **Mandatory Utility**: All logging **MUST** use the `renderer-logger.js` utility.
*   **Prohibited**: `console.log`, `console.warn`, `console.error`, etc., are forbidden. The linter enforces this.
*   **Purpose**: This ensures all diagnostic information, including from the renderer, is captured in the single `app.log` file for unified debugging.


### 6.1 Logging for AI agents — where to get renderer logs

- The renderer never logs to the console; it uses `renderer-logger.js` which forwards to the main logger.
- Find logs in the same directory as the Core/Main logs, with files:
  - `app.log` (human‑readable), `app.ndjson` (structured), `errors.ndjson` (errors only)
- Location (default Core/GUI app): Electron userData directory (macOS: `~/Library/Application Support/scorm-tester/`). If `SCORM_TESTER_LOG_DIR` is set at launch, logs go there.
- Suppression/backoff is visible in NDJSON via events like `RENDERER_BACKOFF_ENTER`, `RENDERER_BACKOFF_ACTIVE`, `RENDERER_COALESCED_DUPLICATES`, and `RENDERER_DEBUG_RATE_LIMIT` (with summaries per window).
- Logs are cleared on app startup and truncated at a size limit (default 8MB) with single‑file retention.

### 6.2 Browser Console Capture (SCORM Content Errors)

Browser console messages from SCORM content are captured using a unified utility (`src/shared/utils/console-capture.js`) shared with the MCP:

- **Capture mechanism**: Window-manager uses `setupConsoleCapture()` which attaches to Electron's `console-message`, `did-fail-load`, and `crashed` events
- **Captures everything**: No filtering at capture level; all browser console output from SCORM content is recorded
- **Error log display**: Messages forwarded to renderer via `renderer-console-error` IPC for display in the GUI error log panel
- **Categorization**: Messages auto-categorized as `scorm_api`, `syntax`, `runtime`, or `network`
- **Shared implementation**: Same capture utility used by MCP for `scorm_get_console_errors` tool
- **Unified logging**: All browser console messages also logged to unified app logs for debugging

## 7. Architectural Anti-Patterns

To maintain architectural integrity, the following patterns are strictly forbidden:

*   **Direct IPC Calls:** Components or services (other than `ScormClient`) calling `window.electronAPI` directly.
*   **Direct Component Communication:** A component calling a method on another component directly. All interaction must use the `EventBus`.
*   **State in Components:** Components maintaining their own source-of-truth state. They must be pure consumers of `UIState`.
*   **Services Handling UI Events:** Services **MUST NOT** listen for `ui:*` events. That is the job of other components.
*   **Legacy Standalone Windows/HTML:** The GUI **MUST NOT** use separate legacy windows or HTML files (e.g., `scorm-inspector.html`). The Inspector is an integrated panel within the main UI.
*   **Direct DOM Access:** Using `document.getElementById`/`querySelector` to manipulate the DOM is forbidden; components render purely from `UIState`.
