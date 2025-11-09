# Core Application Specification

## 1. Overview

This document defines the core architecture for the SCORM Tester's main process. It serves as the authoritative guide for all backend services, SCORM engine components, and interfacing layers. Its purpose is to ensure a robust, maintainable, and secure foundation.

## 2. Core Architectural Principles

All main process code **MUST** adhere to these non-negotiable principles.

### 2.1. Single Source of Truth
Each piece of application state or logic (e.g., SCORM session state, sequencing engine) **MUST** be owned by a single, authoritative service in the main process. The renderer process is a consumer of this state, not an owner.

### 2.2. Fail-Fast
Services **MUST NOT** silently handle errors or proceed with partial data. Any operation that cannot be completed successfully due to invalid input, missing dependencies, or internal errors **MUST** fail immediately and throw a structured error.

### 2.3. No Fallbacks
There **MUST NOT** be any fallback or "basic" modes of operation. If a required service (e.g., the Sequencing & Navigation service) is unavailable, any feature depending on it **MUST** be disabled and report an error. The system will not attempt to "work around" the failure.

### 2.4. Strict, Structured Logging
All logging **MUST** be directed through the centralized, shared logger (`src/shared/utils/logger.js`). Logs **MUST** be structured and provide context. Direct use of `console.*` is forbidden.

### 2.5. Unidirectional Data Flow
The main process **MUST** act as the authoritative source of state. It pushes state to consumers (like the GUI) but **MUST NOT** depend on or query state from a consumer. It is the master, not a peer.

## 3. System Architecture

The main process is composed of two primary layers: **System Services** for application management and the **SCORM Engine** for all standards-based logic.

```
Main Process
├── System Services
│   ├── WindowManager  (Manages all GUI windows)
│   ├── FileManager    (Handles all file/package operations)
│   └── IpcHandler     (Manages all renderer communication)
│
└── SCORM Engine
    ├── ScormService          (Orchestrator)
    ├── CAM (Content Aggregation)
    ├── RTE (Run-Time Environment)
    └── SN (Sequencing & Navigation)
```

### 3.1. System Services

*   **`WindowManager`**: Responsible for creating, destroying, and managing all `BrowserWindow` instances. It is the sole owner of window objects.
*   **`FileManager`**: The only service authorized to perform filesystem operations (read, write, extract ZIPs). It **MUST** use `PathUtils` for all path resolutions to ensure security.
*   **`IpcHandler`**: The exclusive gateway for all communication with renderer processes. See the **Interfacing (IPC)** section for details.

### 3.2. SCORM Engine

*   **`ScormService`**: The primary entry point and orchestrator for all SCORM-related operations. It delegates tasks to the specialized CAM, RTE, and SN services. It is responsible for managing the overall SCORM session lifecycle.
*   **`CAM (Content Aggregation Model)`**: Responsible for parsing and validating `imsmanifest.xml` and the SCORM package structure. It **MUST** enforce the strict compatibility requirements (e.g., manifest at root).
*   **`RTE (Run-Time Environment)`**: Implements the SCORM API (via `ApiHandler`) and manages the data model for a SCO. It is the source of truth for `cmi.*` data.
*   **`SN (Sequencing & Navigation)`**: Implements the SCORM sequencing and navigation logic. It is the source of truth for the activity tree, sequencing rules, and navigation state.

### 3.3. SCORM Inspector Telemetry

The **`ScormInspectorTelemetryStore`** captures diagnostic data for SCORM package analysis and debugging. This includes:

* **API Call History**: All SCORM API calls (`Initialize`, `SetValue`, `GetValue`, `Commit`, `Terminate`) with parameters, results, timing, and errors.
* **Data Model Change Log**: A sequential history of all mutations to the SCORM data model (`cmi.*` elements and collections). Each change entry includes:
  * `element`: The exact data model path (e.g., `cmi.location`, `cmi.interactions.0.id`)
  * `previousValue`: The value before the change (undefined if not previously set)
  * `newValue`: The value after the change
  * `source`: Origin of the change (`api:SetValue`, `api:Commit`, `internal`, etc.)
  * `timestamp`: Precise millisecond timestamp
  * `sessionId`: SCORM session identifier
  * `collectionIndex` and `collectionProperty`: For collection elements (interactions, objectives, comments)
  * Truncation metadata: For large values (e.g., `suspend_data`), the store records original length/bytes and includes a `truncated` flag

The data model change log is maintained in a **ring buffer** (default 5000 entries, configurable via `SERVICE_DEFAULTS.TELEMETRY.MAX_DATA_MODEL_HISTORY`) and is separate from the API call history to ensure both streams can be independently queried and managed.

**Change Capture**: The `ScormDataModel` emits change events via a callback listener. The `ScormApiHandler` subscribes to these events and forwards them to the telemetry store, ensuring every mutation—whether from API calls or internal LMS operations—is logged.

**Broadcasting**: Changes are immediately broadcast to all renderer windows via IPC (`scorm-data-model-change` channel) for real-time inspector UI updates.

**No Fallbacks**: The change log is the sole mechanism for tracking data model history. There are no legacy snapshot-only modes or alternate pathways.

## 4. Interfacing (IPC)

The main process expects a well-behaved client (the renderer). Responsibility for managing API chattiness (e.g., from frequent SCORM `SetValue` calls) lies with the client, not the core application.

### 4.1. Simple Dispatcher Model
The main process `IpcHandler` **MUST** act as a simple, direct dispatcher. It receives requests, forwards them to the appropriate service, and returns a direct response (success or error).

The `IpcHandler` **MUST NOT** implement any of the following:
- Rate-limiting
- Throttling
- Debouncing
- "Soft-OK" responses or other complex timing logic

This simplification of the core is made possible by mandating an intelligent client in the renderer process.

### 4.2. Single IPC Mechanism
All IPC **MUST** be handled through the centralized `IpcHandler` and registered via the **declarative routing system** (`src/main/services/ipc/routes.js`). Legacy or direct use of `ipcMain` is forbidden.

### 4.3. IPC Contract
*   **Channels**: Channel names **MUST** be defined in `src/shared/constants/main-process-constants.js`.
*   **Batched Endpoints**: To support the client-side chattiness management strategy, the main process **MUST** expose endpoints that can accept arrays of operations (e.g., `scorm-set-values` which accepts an array of key/value pairs). The payload schema for these endpoints must be clearly defined.
*   **Error Handling**: If an IPC handler encounters an error, it **MUST** not return a success response. It should throw an error, which the `IpcHandler` will catch and forward to the renderer as a structured error response.

## 5. Error Handling

A systematic approach to error handling is mandatory.

*   **Centralized Handler**: All catch blocks for significant operations **MUST** route errors through the centralized `ErrorHandler` (`src/shared/utils/error-handler.js`).
*   **Structured Errors**: Thrown errors **MUST** be instances of `Error` or the custom `ParserError` where applicable. They should contain clear messages and, if appropriate, a `code` property.
*   **Error Classification**: The `ErrorHandler` is responsible for classifying errors as either `APP` or `SCORM` issues and routing them to the appropriate destination (app logs or the SCORM Inspector). This logic is defined in `error-classifier.js`.

## 6. Logging

*   **Logger**: All modules **MUST** obtain an instance of the shared logger.
*   **Log Levels**:
    *   `error`: For any failure that prevents an operation from completing (e.g., service initialization failure, IPC handler error, security violation). **MUST** include error object and context.
    *   `warn`: For conditions that are unexpected but do not cause a failure (e.g., deprecated API usage, non-standard SCORM structure that is still parsable).
    *   `info`: For significant, non-repetitive lifecycle events (e.g., `Service initialized`, `SCORM package loaded`, `IPC rate-limit engaged`).
    *   `debug`: For detailed diagnostic information useful for troubleshooting. **MUST** be used only when `LOG_LEVEL=debug`.
*   **Context**: All log entries **MUST** include a structured context object to aid debugging. No sensitive information should be logged.

### 6.1 Logging for AI agents — locations and usage

- All Core/Main logging goes through `src/shared/utils/logger.js` and is written to exactly three files in the same directory:
  - `app.log` — human‑readable
  - `app.ndjson` — machine‑parsable NDJSON (one JSON object per line)
  - `errors.ndjson` — NDJSON containing only error‑level entries
- Where to find them (Core/GUI app): by default the Electron userData directory.
  - macOS example: `~/Library/Application Support/scorm-tester/`
  - If `SCORM_TESTER_LOG_DIR` is set at launch, logs are written there instead.
- Behavior: logs are cleared at startup and truncated when they exceed `SCORM_TESTER_MAX_LOG_BYTES` (default 8MB). Only a single file of each type is retained (no rotations).
- Renderer logs are forwarded into the same files via IPC. In `app.ndjson`, look for renderer events like `RENDERER_BACKOFF_ENTER`, `RENDERER_BACKOFF_ACTIVE`, `RENDERER_COALESCED_DUPLICATES`, and `RENDERER_DEBUG_RATE_LIMIT`.
- Quick usage (examples):
  - Tail errors only: `tail -f "~/Library/Application Support/scorm-tester/errors.ndjson"`
  - Parse NDJSON: `jq -c . "~/Library/Application Support/scorm-tester/app.ndjson" | head`

### 6.2 Browser Console Capture (SCORM Content)

Browser console messages from SCORM content are captured using a unified utility shared across GUI and MCP:

- **Location**: `src/shared/utils/console-capture.js`
- **Usage**: Both GUI (window-manager) and MCP (runtime-manager) use `setupConsoleCapture()`
- **Captures**: All Electron `console-message`, `did-fail-load`, and `crashed` events
- **No filtering at capture**: All browser console output is recorded; filtering applied at display/access level
- **Categorization**: Auto-categorizes messages as `scorm_api`, `syntax`, `runtime`, or `network`
- **GUI integration**: Messages forwarded to renderer for error log display via `onMessage` callback
- **MCP integration**: Messages stored in per-session buffers, accessible via IPC (`runtime_getConsoleMessages`)
- **Unified logging**: All captured messages also logged to main app logs for debugging

## 7. Architectural Anti-Patterns

To maintain architectural integrity, the following patterns are strictly forbidden:

*   **Byp

assing IPC Handler:** Services attempting to communicate with the renderer process outside of the `IpcHandler`.
*   **Renderer State Dependency:** The main process querying for or depending on state held within the renderer process.
