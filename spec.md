# SCORM Tester Application & MCP Spec for AI Agents

This document provides essential, token-efficient architectural rules, design decisions, and implementation details for the SCORM Tester application. AI agents **MUST** adhere to these specifications to avoid writing redundant or misplaced code.

## 1. Universal Architectural Principles

- **Single Source of Truth**: State (e.g., SCORM session, navigation) is owned by a single, authoritative service in the main process. The GUI is a "dumb" consumer.
- **Fail-Fast**: Services **MUST NOT** silently handle errors. Operations **MUST** fail immediately and throw a structured error.
- **No Fallbacks**: If a required service is unavailable, dependent features **MUST** be disabled. The system will not "work around" failures.
- **Unidirectional Data Flow**: The main process is the master source of state. It pushes state to consumers (GUI). It **MUST NOT** query state from a consumer.
- **Strict, Structured Logging**: All logging **MUST** use the centralized logger. Direct use of `console.*` is forbidden.
- **Security First**:
    - All externally-sourced data rendered in HTML **MUST** be escaped.
    - Filesystem operations are restricted. Use `PathUtils` for all path resolutions.
    - The MCP runs SCORM content in a sandboxed environment.

## 2. Codebase Architecture & Directory Structure

Adhere to this structure to ensure code is placed correctly.

- **`src/main/`**: Main process code.
  - **`services/`**: All backend services (e.g., `ScormService`, `WindowManager`).
  - The SCORM Engine (`CAM`, `RTE`, `SN`) logic resides here.
- **`src/renderer/`**: GUI (Renderer process) code.
  - **`components/`**: All UI components.
  - **`services/`**: UI-specific services (`UIState`, `EventBus`, `ScormClient`).
  - **`boot/`**: Application startup and initialization for the renderer.
- **`src/mcp/`**: AI Agent Interface (Machine-to-Machine Control Protocol).
  - Contains the Node.js server, tool definitions (in `src/mcp/server.js`), and Electron runtime entry.
- **`src/shared/`**: Code shared between **all** processes.
  - This is the primary location for code reuse to avoid redundancy.
- **`tests/`**: All tests. Follow the existing structure for new tests.
  - **`unit/`**, **`integration/`**, **`e2e/`**.

## 3. Shared Code & Utilities (To Avoid Redundancy)

Before writing new code, check `src/shared/` for existing solutions.

- **`src/shared/constants/`**: Centralized, shared constants.
  - IPC channel names, `EventBus` event names, and other magic strings **MUST** be defined here.
- **`src/shared/utils/`**: Reusable utility functions.
  - **`logger.js`**: The only way to log.
  - **`error-handler.js`**: Central point for processing caught errors.
  - **`path-utils.js`**: For secure and consistent file path manipulation.
  - **`console-capture.js`**: Captures console output from SCORM content WebViews.
- **`src/shared/errors/`**: Custom error classes used throughout the application.
- **`src/shared/types/`**: Shared data type definitions (e.g., for IPC payloads).

## 4. System-Wide Contracts

### 4.1. Logging

**CRITICAL: Centralized logging is MANDATORY. NO EXCEPTIONS.**

#### Core Rules (Violations are Architecture Violations)

1. **MUST use shared logger**: All code **MUST** import and use `src/shared/utils/logger.js`. NO direct `console.*` calls.
2. **FORBIDDEN operations**: `console.log()`, `console.warn()`, `console.error()`, `console.info()`, `console.debug()` are **BANNED** in production code.
3. **NO silent failures**: Every error, warning, or diagnostic message **MUST** be logged. Silent failures mask bugs and make debugging impossible.
4. **Tests MUST log**: Test code **MUST** use the logger or test logger sink from `tests/setup.js`. Do NOT bypass logging in tests.

#### Logger Usage

```javascript
// Import the logger factory
const getLogger = require('../shared/utils/logger');

// Initialize (first call sets directory and prefix)
const logger = getLogger();  // Uses defaults
// OR with custom settings:
const logger = getLogger('/path/to/logs', 'mcp');  // Custom dir + prefix

// Use child loggers for context
const componentLogger = logger.child({ component: 'ServiceName' });

// Log at appropriate levels
logger.debug('Detailed diagnostic info', { data });  // Development only
logger.info('Normal operation', { context });         // General flow
logger.warn('Recoverable issue', { details });        // Warnings
logger.error('Operation failed', error);              // Errors
```

#### Log File Structure

All logs written to `./logs/` directory with process-specific prefixes:
- **GUI Process**: `gui.log`, `gui.ndjson`, `gui-errors.ndjson`
- **MCP Process**: `mcp.log`, `mcp.ndjson`, `mcp-errors.ndjson`

**File Formats**:
- `.log`: Human-readable timestamps and messages
- `.ndjson`: Structured newline-delimited JSON for parsing
- `-errors.ndjson`: Error-level logs only for quick debugging

#### Console Output Control

Console output (stderr) is controlled independently from file logging:
- `SCORM_TESTER_CONSOLE_LEVEL=debug` - Show all logs in console
- `SCORM_TESTER_CONSOLE_LEVEL=info` - Show info and above
- `SCORM_TESTER_CONSOLE_LEVEL=warn` - Show warnings and errors only (default)
- `SCORM_TESTER_CONSOLE_LEVEL=error` - Show errors only
- `SCORM_TESTER_CONSOLE_LEVEL=none` - No console output (files only)

**Note**: All logs are **always** written to files regardless of console level.

#### Process-Specific Initialization

**Main Process (GUI)**:
```javascript
const getLogger = require('../shared/utils/logger');
const logger = getLogger(app.getPath('userData'), 'gui');
```

**MCP Process**:
```javascript
// node-bridge.js sets SCORM_TESTER_LOG_PREFIX=mcp
const getLogger = require('../shared/utils/logger');
const logger = getLogger();  // Uses env vars
```

**Tests**:
```javascript
const { createLoggerSink } = require('../tests/setup');
const logger = createLoggerSink();
// logger.entries contains all logged messages for assertions
```

### 4.2. Error Handling
- All significant errors **MUST** be routed through the shared `ErrorHandler`.
- New custom errors **SHOULD** be defined in `src/shared/errors/`.

### 4.3. Inter-Process Communication (IPC)
- **Mechanism**: Use the centralized `IpcHandler` in `main` and `ScormClient` in `renderer`.
- **Channels**: All channel names **MUST** be defined in `src/shared/constants/`.
- **Payloads**: To avoid chattiness, use existing batched endpoints (e.g., `scorm-set-values`) where possible.

## 5. Main Process (Core) Architecture

- **State Ownership**: All SCORM and application state is owned and managed exclusively by services in the main process.
- **Key Service Responsibilities**:
    - `ScormService`: The primary orchestrator. Handles session initialization (hydration) and termination (persistence). Delegates to CAM, RTE, SN, and SessionStore.
    - `SessionStore`: Persists/loads data model snapshots to/from JSON files. Used by ScormService.
    - `CAM`: **Input:** `imsmanifest.xml` path. **Output:** A validated activity tree data structure and package metadata.
    - `RTE`: Manages the SCORM Data Model (`cmi.*`) for a single SCO. The source of truth for `cmi` data. Provides `restoreData()` and `getAllData()` for persistence.
    - `SN`: **Input:** The activity tree from CAM. Manages sequencing rules, navigation state, and is the source of truth for the course's structure and flow.
    - `WindowManager`: Creates and manages all `BrowserWindow` instances.
    - `FileManager`: The only service authorized for filesystem operations.
- **Key Data Structures**:
    - **Activity Tree**: The hierarchical representation of the course structure, generated by CAM and managed by SN. This is a central data structure.
    - **SCORM Data Model**: The `cmi` object managed by the RTE.
    - **Telemetry Log**: A ring buffer of API calls and data model changes stored in `ScormInspectorTelemetryStore`. Change entries have the structure: `{ element, previousValue, newValue, source, timestamp, sessionId }`.

## 5.1. Session Persistence & Resume

**Storage**: `SessionStore` persists complete data model snapshots to JSON files in `~/Library/Application Support/scorm-tester/scorm-sessions/`. Filename: `{namespace}_{courseId}.json` (namespace: `'gui'` or `'mcp'`).

**Core Principles**:

- **No Manipulation**: Data model saved/loaded as-is. Complete object to/from JSON with zero transformation.
- **Always Save**: `Terminate()` triggers `SessionStore.saveSession()` with full data model EVERY time, regardless of exit status.
- **Always Load**: Startup always attempts JSON load. Skip ONLY if hard reset flag (`forceNew`, `new_attempt`) is true.
- **Resume Conditions**: Data restored if JSON exists AND `cmi.exit='suspend'` AND `cmi.location` present. Otherwise: fresh start.
- **Hard Reset**: Flag skips loading step. Never deletes JSON files (except manual cleanup via MCP tool or app-level rotation).
- **Unified Shutdown**: Close/reload/terminate ALL follow identical sequence: set `cmi.exit='suspend'`, call `Terminate('')`, wait (GUI only), destroy window.
- **Reload = Close + Open**: Two sequential operations. New session ID each time. Only JSON persists across reload.

**Namespace Isolation**: GUI (`'gui'`) and MCP (`'mcp'`) use separate files. No cross-contamination.

## 6. GUI (Renderer) Architecture

- **Core Principle**: The GUI is a **pure consumer of state**. It holds no business logic.
- **Service Layer**: The renderer has exactly four services: `AppManager` (orchestrator), `UIState` (state cache), `EventBus` (communication), and `ScormClient` (IPC). Do not add business logic here.
- **State Management**:
    - `UIState` is the **read-only** cache for all data needed by the UI.
    - Components **MUST NOT** have complex internal state. Use local variables only for transient view state (e.g., "is dropdown open").
- **Component Rules**:
    - All components **SHOULD** extend `BaseComponent` to inherit common functionality like event subscription management.
    - `ScormInspectorPanel`: **MUST NOT** use the `EventBus`. It receives its diagnostic data directly from the main process via dedicated IPC channels.
    - `ContentViewer`: Responsible for injecting the SCORM API bridge (`API_1484_11`) into the content iframe's window.

## 7. MCP (AI Agent Interface) Architecture

- **File Responsibilities**:
    - `node-bridge.js`: The main entry point. Handles JSON-RPC protocol over stdio ONLY. Contains no SCORM logic.
    - `electron-entry.js`: Spawned by the bridge. Hosts the Electron environment for running content.
    - `runtime-adapter.js`: Lives in the Electron process. Listens for IPC from the bridge and delegates to the SCORM engine.
    - `scorm-preload.js`: Injected into the content's WebView to provide the SCORM API.
- **Session Workspace**: All stateful operations occur within a session directory (`./sessions/<session_id>/`), which contains the unpacked course and any generated artifacts (screenshots, logs).
- **Error Model**: `SN_NOT_INITIALIZED` is **not an error**. It is an expected state for single-SCO courses. Tools will return `applicable: false` in this case.
- **Persistence (MCP)**: Uses shared `ScormService` singleton with namespace `'mcp'`. Open tools accept `new_attempt` flag, reload tools accept `force_new` flag (both skip JSON loading for hard reset). `scorm_session_close` sets exit='suspend' before terminate. `scorm_clear_saved_data` deletes JSON file.
- **Key Tool Categories (Overview)**:
    - **Session**: `scorm_session_open`, `scorm_session_close`, `scorm_reload_course`, `scorm_clear_saved_data`.
    - **Validation**: `scorm_validate_workspace`, `scorm_lint_manifest`.
    - **Runtime Lifecycle**: `scorm_runtime_open`, `scorm_attempt_initialize`.
    - **Runtime Interaction**: `scorm_api_call`, `scorm_data_model_get`, `scorm_capture_screenshot`, `scorm_nav_get_state`, `scorm_set_viewport_size`.
    - **DOM & Browser Testing**: `scorm_dom_*` tools (click, fill, query, evaluate), `scorm_get_slide_map`, `scorm_navigate_to_slide` - pure DOM, no API dependencies.
    - **Template Automation**: `scorm_automation_*` tools require `window.SCORMAutomation` API - includes `scorm_automation_go_to_slide`, `scorm_automation_get_course_structure`.

### 7.2. Template Automation Tools

**Implementation**: All `scorm_automation_*` tools in `src/mcp/tools/automation.js` are thin wrappers around `scorm_dom_evaluate`. They construct JavaScript expressions that call `window.SCORMAutomation` methods.

**Behavior**:

- All tools check API availability first via `typeof window.SCORMAutomation !== "undefined"`
- If unavailable, throw `AUTOMATION_API_NOT_AVAILABLE` error immediately
- No automatic fallback to DOM tools - AI agent must explicitly choose between automation and DOM tools
- `scorm_automation_check_availability` must be called first to determine strategy
- Navigation: Use `scorm_automation_go_to_slide` for automation API, `scorm_navigate_to_slide` for pure DOM

**Error Codes**: `AUTOMATION_API_NOT_AVAILABLE`, `AUTOMATION_API_ERROR`, `INVALID_INTERACTION_ID`

**Tool Groups**:

- **Core**: Check availability, list/set/get/check interactions, get interaction metadata
- **Navigation**: Get structure/slide, navigate (requires `window.SCORMAutomation`)
- **Advanced**: Get correct answers, last evaluation, check slide answers
- **Debug**: Get/clear trace logs
- **Introspection**: Get API version, layout tree, element details, validate page layout
- **Layout & Accessibility**: Detect off-screen content, overlapping elements, text overflow, WCAG contrast violations, zero-size elements

### 7.3. Comprehensive List of MCP Tools

This section provides a complete, categorized list of all available MCP tools.

**Session Management:**
*   `scorm_session_open` - Opens a session and creates isolated workspace
*   `scorm_session_status` - Get session state and timestamps
*   `scorm_session_events` - Poll event stream for background operations
*   `scorm_session_close` - **Unified shutdown path**: Sets cmi.exit='suspend', calls Terminate(), saves data, and closes runtime

**Runtime Management:**
*   `scorm_runtime_open` - Opens offscreen browser and auto-initializes SCORM content
*   `scorm_runtime_status` - Get runtime state (open, Initialize status, last API call)

**SCORM API Calls:**
*   `scorm_api_call` - Call any SCORM API method (Initialize, GetValue, SetValue, Commit, Terminate, etc.)
*   `scorm_data_model_get` - Bulk read data model elements with wildcard support

**Sequencing & Navigation (SN):**
*   `scorm_nav_get_state`
*   `scorm_nav_next`
*   `scorm_nav_previous`
*   `scorm_nav_choice`
*   `scorm_sn_init`
*   `scorm_sn_reset`

**Validation & Linting:**
*   `scorm_validate_workspace`
*   `scorm_lint_manifest`
*   `scorm_lint_api_usage`
*   `scorm_lint_sequencing`
*   `scorm_validate_compliance`

**Runtime Testing & Debugging:**
*   `scorm_test_api_integration`
*   `scorm_test_navigation_flow`
*   `scorm_debug_api_calls`
*   `scorm_trace_sequencing`
*   `scorm_get_data_model_history`
*   `scorm_assessment_interaction_trace`
*   `scorm_validate_data_model_state`
*   `scorm_get_console_errors`
*   `scorm_compare_data_model_snapshots`
*   `scorm_wait_for_api_call`
*   `scorm_get_current_page_context`
*   `scorm_replay_api_calls`

**Visual & DOM Interaction:**
*   `scorm_capture_screenshot`
*   `scorm_set_viewport_size` - Set window size (320×240 to 7680×4320). Presets: Desktop (1366×768), Tablet (1024×1366), Mobile (390×844)
*   `scorm_dom_click`
*   `scorm_dom_fill`
*   `scorm_dom_query`
*   `scorm_dom_evaluate`
*   `scorm_dom_wait_for`
*   `scorm_keyboard_type`
*   `scorm_get_network_requests`
*   `scorm_dom_find_interactive_elements`
*   `scorm_dom_fill_form_batch`

**Template Automation (requires compatible SCORM template with window.SCORMAutomation):**

*   `scorm_automation_check_availability`
*   `scorm_automation_list_interactions`
*   `scorm_automation_set_response`
*   `scorm_automation_check_answer`
*   `scorm_automation_get_response`
*   `scorm_automation_get_course_structure`
*   `scorm_automation_get_current_slide`
*   `scorm_automation_go_to_slide`
*   `scorm_automation_get_correct_response`
*   `scorm_automation_get_last_evaluation`
*   `scorm_automation_check_slide_answers`
*   `scorm_automation_get_trace`
*   `scorm_automation_clear_trace`
*   `scorm_automation_get_interaction_metadata`
*   `scorm_automation_get_version`
*   `scorm_automation_get_page_layout`
*   `scorm_automation_get_layout_flow`
*   `scorm_automation_get_layout_tree`
*   `scorm_automation_get_element_details`
*   `scorm_automation_validate_page_layout`

**Engagement Tracking (requires compatible SCORM template with engagement tracking enabled):**

*   `scorm_engagement_get_state`
*   `scorm_engagement_get_progress`
*   `scorm_engagement_mark_tab_viewed`
*   `scorm_engagement_set_scroll_depth`
*   `scorm_engagement_reset`

**Audio Control (requires compatible SCORM template with audio support):**

*   `scorm_automation_get_audio_state` - Get hasAudio, audioState (source, position, duration, contextType, isCompleted), and progress
*   `scorm_automation_is_audio_completed_for_context` - Check completion for specific context (slideId, modal-xxx, etc.)
*   `scorm_automation_simulate_audio_complete` - Simulate completion for testing (triggers appropriate engagement tracking)

**Reporting:**
*   `scorm_report`

### 7.4. Token Efficiency & Data Retrieval Best Practices

To prevent excessive token usage, certain MCP tools return summary data by default and require explicit flags to retrieve full details:

**`scorm_get_data_model_history`:**

- **Default Behavior**: Returns `change_count`, `total_changes`, and `has_more` with a limit of 50 changes
- **Full Details**: Set `include_changes: true` to receive the complete `changes` array
- **Pagination**: Use `offset` and `limit` parameters for controlled data retrieval
- **Filtering**: Use `element_prefix`, `since_ts`, or `change_session_id` to narrow results

**`scorm_get_console_errors`:**

- **Default Behavior**: Returns `error_count` and categorized counts (scorm_api, syntax, runtime, network) with a limit of 50 errors
- **Full Details**: Set `include_errors: true` to receive the complete `errors` array
- **Filtering**: Use `severity` (error/warn/info) and `since_ts` to narrow results
- **Limit**: Specify `limit` parameter to control number of errors returned (default: 50)

**Navigation Tools (`scorm_nav_next`, `scorm_nav_previous`, `scorm_nav_choice`):**

- **Default Behavior**: Returns success/applicable status plus `error_count` and categorized error counts
- **Purpose**: Allows agents to detect runtime issues immediately after navigation without separate error query
- **Error Categories**: Same as `scorm_get_console_errors` (scorm_api, syntax, runtime, network)

**`system_get_logs`:**

- **Default Behavior**: Returns last 200 log entries
- **Control**: Use `tail` parameter to specify number of entries (default: 200)
- **Filtering**: Use `levels`, `since_ts`, and `component` to narrow results

AI agents **MUST** start with summary calls and only request full details when debugging specific issues.

## 8. Architectural Anti-Patterns (Forbidden)

- Placing business logic in the GUI (renderer) process.
- Placing SCORM logic anywhere outside the `main` process services.
- Creating redundant utility functions instead of using `src/shared/utils`.
- Using hardcoded strings for IPC channels or event names instead of `src/shared/constants`.
- Direct component-to-component method calls in the GUI (use `EventBus`).
- Using `console.log` instead of the shared logger.
- MCP clients parsing non-JSON output from `stdout`.
