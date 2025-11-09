# SCORM MCP Tool Specification - AI Agent Testing & Validation Platform

## Overview

The SCORM MCP Tool transforms your production-ready SCORM Tester into a validation and testing platform specifically designed for AI agents. AI agents write SCORM course files directly; the MCP tools validate, test, debug, and visually inspect those files by actually running them locally, enabling AI agents to see what their courses look like and how they work in real LMS environments.

## Core Problem & Solution

**THE PROBLEM:** AI agents can generate complete SCORM courses (HTML, CSS, JS, imsmanifest.xml) but cannot validate they actually work. Generated content may have:
- Invalid or non-compliant manifest XML
- Broken SCORM API integration code
- Layout issues that break in LMS iframe constraints
- Navigation and sequencing failures
- Device compatibility problems

**THE SOLUTION:** Enable AI agents to test and debug their generated SCORM content by:
1. **Local Execution** - Run courses in controlled environment with your production-ready SCORM engine
2. **Visual Validation** - Capture screenshots to show AI agents how their content actually renders
3. **API Testing** - Execute and monitor SCORM API calls to detect integration bugs
4. **Interactive Debugging** - Step through navigation and sequencing to identify issues
5. **Specific Feedback** - Provide actionable error reports and fix suggestions

## Vision

**"Your production-ready SCORM engine becomes the eyes and testing platform for AI-generated content."**

AI agents do the creative work (writing course files), your tool provides the validation and testing capabilities that AI agents cannot do themselves - actually running the content and seeing how it works.

## Core Principles

- **AI Agent Testing Platform**: Purpose-built for AI agents to test and debug their generated SCORM content
- **Local Execution Environment**: Run SCORM courses locally using production-ready engine for validation
- **Visual Validation**: AI agents can "see" their content through screenshots and visual feedback
- **File-Centric Workflow**: AI agents write files directly, MCP tools test and validate them
- **Standards Compliance**: 100% SCORM 2004 4th Edition compliance validation
- **Real-Time Debugging**: Live API monitoring, sequencing tracing, and navigation testing
- **Actionable Feedback**: Specific error reports with fix suggestions for AI agents

## Architecture

### AI Agent Testing Architecture

The SCORM MCP Tool transforms your existing production-ready SCORM Tester into a testing and validation platform for AI agents. AI agents write SCORM files, the MCP server runs and tests them using your proven SCORM engine, then provides visual and diagnostic feedback.

```text
┌─────────────────────────────────────────────────────────────┐
│            AI Agent SCORM Testing & Validation Platform    │
├─────────────────────────────────────────────────────────────┤
│  AI Agent (Claude, etc)   │  SCORM MCP Testing Tools        │
│  ┌─────────────────────┐  │  ┌─────────────────────────────┐ │
│  │ Writes Course Files │  │  │ Tests Generated Content     │ │
│  │ - imsmanifest.xml   │  │  │ - Manifest Validation       │ │
│  │ - SCO HTML/CSS/JS   │  │  │ - API Integration Testing   │ │
│  │ - Media Assets      │  │  │ - Visual Screenshot Capture │ │
│  │ - Sequencing Rules  │  │  │ - Navigation Flow Testing   │ │
│  └─────────────────────┘  │  └─────────────────────────────┘ │
│           │                │                │               │
│           ▼                │                ▼               │
│  ┌─────────────────────┐  │  ┌─────────────────────────────┐ │
│  │ Fixes Based on      │  │  │ Detailed Error Reports      │ │
│  │ Testing Feedback    │◄─┼──┤ Screenshot Evidence         │ │
│  │                     │  │  │ Specific Fix Suggestions    │ │
│  └─────────────────────┘  │  └─────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│        Production-Ready SCORM Engine (100% Compliant)      │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────┐ │
│  │ CAM Validator   │   │ RTE API Tester  │   │ SN Debugger │ │
│  │ (Manifest)      │   │ (API & Data)    │   │ (Sequencing)│ │
│  └─────────────────┘   └─────────────────┘   └─────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Deployment Modes

The tool supports multiple deployment modes to serve different use cases:

#### 1. Development Mode (Default)

```bash
npm run mcp
```

- **MCP stdio server** for AI agents (Claude Code, Kilo Code) started via a single command or JSON MCP config pointing to `npm run mcp`
- **Runs inside Electron offscreen by default**; no flags or extra steps required
- **Advanced SCORM Inspector** for detailed package analysis
- **Hybrid workflow** combining AI automation with visual development

#### Single Execution Model

```bash
npm run mcp
```

- **Always real**: MCP stdio server runs inside Electron offscreen (no flags, no modes)
- **Same behavior** in dev and CI; on headless Linux use: `xvfb-run -a npm run mcp`
- **Agent-ready**: Works out of the box via JSON MCP config pointing to `npm run mcp`
- Separate human GUI app remains available for interactive use, sharing the same core engine

### Agent Integration Quick Start (MCP clients)

- Command: `npm run mcp`
- Protocol: JSON-RPC 2.0 over stdio (one JSON-RPC message per line on stdout; no non-JSON output on stdout)
- Headless CI (Linux): `xvfb-run -a npm run mcp`
- Works out of the box for Claude Code / Kilo Code via JSON MCP config pointing to `npm run mcp`

### Architecture: Node.js MCP Server with Lazy Electron Child

The MCP server runs as a Node.js process (`node-bridge.js`) that spawns an Electron child process on-demand:

- **Node.js MCP Server** (`node-bridge.js`): Handles JSON-RPC 2.0 stdio protocol communication. This process **always** runs and **always** sets `global.__electronBridge` with IPC methods.
- **Electron Child Process** (`electron-entry.js`): Spawned lazily via IPC when runtime features (screenshots, browser execution) are needed. Not started for validation-only workflows.
- **Communication**: IPC messages between Node server and Electron child when spawned; Electron stdout/stderr suppressed to avoid polluting MCP protocol
- **Lazy Initialization**: Electron child only spawned when runtime tools are invoked, keeping validation-only workflows lightweight (single process)

**Design Decision**: Bridge mode is the **only** execution mode. There is no "direct mode" or fallback behavior. The Node.js server always sets `global.__electronBridge`, and all runtime operations delegate to the Electron child via IPC. This ensures:
- Reliable stdio protocol handling (Node.js handles stdio, not Electron)
- Clean separation between MCP protocol (Node server) and browser runtime (Electron child)
- Fail-fast behavior when runtime features are unavailable (no silent fallbacks)

Example minimal MCP client config (conceptual):

```json
{
  "command": "npm",
  "args": ["run", "mcp"],
  "env": {},
  "transport": "stdio"
}
```


### JSON-RPC 2.0 Only (Enforced)

- Transport: JSON-RPC 2.0 over stdio (one message per line)
- Stdout: strictly JSON-RPC messages only; any diagnostics must go to stderr
- Supported MCP methods:
  - initialize
  - tools/list
  - tools/call
- No legacy/plain NDJSON shapes are accepted. Clients must speak JSON-RPC 2.0.


### Logging for AI agents — locations and usage

- The MCP server writes structured logs via the shared logger to three files in the same directory:
  - `app.log` — human‑readable
  - `app.ndjson` — machine‑parsable NDJSON (one JSON object per line)
  - `errors.ndjson` — NDJSON containing only error‑level entries
- Location (MCP runs): if `SCORM_TESTER_LOG_DIR` is set in the environment, logs go there. Otherwise, the MCP server uses a repo‑local directory: `./logs/mcp/` (consistent path, no timestamps).
- Behavior: logs are **cleared on MCP startup** (each run overwrites previous session) and truncated when they exceed `SCORM_TESTER_MAX_LOG_BYTES` (default 8MB). Only a single file of each type is retained (no rotations). This matches the main GUI app behavior.
- Request correlation: every JSON‑RPC call is logged in `app.ndjson` with markers like `MCP_TOOLS_CALL`, `MCP_TOOLS_RESULT`, `MCP_TOOLS_ERROR` and includes the JSON‑RPC `id` and `method` for easy tracing.
- Introspection tools:
  - `system_get_logs` (tools/call): `{ tail?: number, levels?: string[], since_ts?: number }` — returns recent NDJSON objects (filterable by levels/time)
  - `system_set_log_level` (tools/call): `{ level: "debug"|"info"|"warn"|"error" }`
- Quick usage (examples):
  - Tail errors only: `tail -f ./logs/mcp/errors.ndjson`
  - Parse NDJSON: `jq -c . ./logs/mcp/app.ndjson | head`
  - View human-readable: `tail -f ./logs/mcp/app.log`

### Unified Console Capture Architecture

Browser console messages from SCORM content are captured using a unified utility (`src/shared/utils/console-capture.js`) shared between GUI and MCP:

- **Capture mechanism**: Electron's `console-message`, `did-fail-load`, and `crashed` events
- **Captures everything**: No filtering at capture level; all console output is recorded
- **Per-session buffering** (MCP only): Messages stored in session-specific buffers, accessible via IPC
- **IPC bridge**: Node.js bridge process retrieves console messages from Electron child via `runtime_getConsoleMessages` IPC handler
- **Categorization**: Messages auto-categorized as `scorm_api`, `syntax`, `runtime`, or `network`
- **GUI integration**: Same utility powers GUI error log display via `onMessage` callback
- **No fallbacks**: Fail-fast if Electron bridge unavailable; ensures consistent behavior

### Fail‑Fast, No Fallbacks, No Silent Errors (Critical)

- This MCP strictly enforces fail‑fast behavior. If any prerequisite is missing (e.g., Electron runtime, SN bridge not initialized, session/runtime not open), the server MUST return a JSON‑RPC error; tools MUST NOT fallback to alternative behaviors or return partial "success".
- No implicit retries, no alternative method name probing, and no silent degradations.
- Error surfacing is part of the debugging experience: callers should see clear, actionable errors to fix compliance and runtime issues quickly.

### Error Model (JSON‑RPC 2.0)

- Protocol errors:
  - -32700 Parse error (id: null)
  - -32600 Invalid Request
  - -32601 Method not found
  - -32602 Invalid params
  - -32000 Server/tool error
- Tool errors use -32000 with data.error_code for precise classification. Common codes:
  - MCP_INVALID_PARAMS, MCP_UNKNOWN_SESSION, RUNTIME_NOT_OPEN, ELECTRON_REQUIRED
  - MANIFEST_NOT_FOUND, CONTENT_FILE_MISSING, MANIFEST_VALIDATION_ERROR
  - SN_BRIDGE_UNAVAILABLE, SN_BRIDGE_ERROR, NAV_UNSUPPORTED_ACTION
  - INVALID_SCORM_METHOD, SCORM_API_ERROR
  - SN_INIT_FAILED, SN_RESET_FAILED

**Important:** `SN_NOT_INITIALIZED` is NOT an error code. When sequencing is not initialized (because `scorm_sn_init` was not called), navigation and state tools return success with `sn_available: false` or `applicable: false` to indicate the operation is not applicable. This is expected for single-SCO courses that don't use complex sequencing. Only actual failures (like `SN_INIT_FAILED` when initialization is attempted but fails) result in errors.

- Result shape:
  - On success: { "jsonrpc":"2.0", "id":N, "result": { data: { …tool specific… } } }
  - On error:   { "jsonrpc":"2-0", "id":N, "error": { code, message, data?: { error_code } } }


### Architectural Anti-Patterns

Clients integrating with the MCP tool **MUST NOT**:

*   **Parse Non-JSON Output:** The `stdout` stream is guaranteed to contain only JSON-RPC 2.0 messages. Clients **MUST NOT** attempt to parse any other format or diagnostic text from `stdout`.
*   **Rely on Fallbacks:** Clients **MUST** handle JSON-RPC errors (like `ELECTRON_REQUIRED`) and **MUST NOT** implement or expect fallback behaviors.
*   **Use Legacy Protocols:** Clients **MUST** send well-formed JSON-RPC 2.0 messages. Plain NDJSON or other legacy message shapes are not supported and will result in a parse error.



### Implementation Status (V1 summary)
- MCP core server, standard envelope, and tool router implemented
- Session lifecycle implemented: open, status, events, close (per-session workspace + artifacts manifest)
- Validation tools implemented: `scorm_lint_manifest`, `scorm_lint_api_usage`, `scorm_validate_workspace`
- Runtime tools available under Electron offscreen: `scorm_test_api_integration`, `scorm_take_screenshot`
- Offscreen BrowserWindows with real SCORM adapter via preload/IPC are used by default
- Next: richer `scorm_session_events`, `scorm_trace_sequencing`, navigation flow testing, expanded validation rules


### Core Components

## MCP Tool Categories - AI Agent Testing & Validation Focus

### 1. File-Level Validation & Linting (Core V1 Tools)

These tools validate AI-generated SCORM files without running them, providing immediate feedback on structure and compliance.

#### `scorm_validate_workspace`
Comprehensive validation of AI-generated SCORM course directory.

**Parameters:**
- `workspace_path` (string): Path to directory containing SCORM files
- `validation_level` (enum): basic|strict|pedantic
- `check_categories` (array): manifest|api_usage|sequencing|files|structure

**Response:**
```json
{
  "success": false,
  "validation_results": {
    "manifest": {
      "valid": false,
      "errors": ["Missing default organization", "Invalid resource href"],
      "warnings": ["Metadata incomplete"]
    },
    "api_usage": {
      "scanned_files": ["sco1.html", "assessment.js"],
      "issues": [
        {
          "file": "sco1.html",
          "line": 45,
          "issue": "Missing Initialize() call before SetValue()",
          "fix_suggestion": "Add API_1484_11.Initialize('') before setting values"
        }
      ]
    }
  },
  "compliance_score": 65,
  "actionable_fixes": [
    "Add <organization> element with items to imsmanifest.xml"
  ]
}
```

#### `scorm_lint_manifest`
Focused validation of imsmanifest.xml against SCORM schemas.

**Parameters:**
- `workspace_path` (string): Course directory path
- `scorm_version` (enum): auto|2004_3rd|2004_4th
- `strict_mode` (boolean): Enforce stricter validation rules

#### `scorm_lint_api_usage`
Scan HTML/JS files for SCORM API integration problems.

**Parameters:**
- `workspace_path` (string): Course directory path
- `scan_depth` (enum): surface|deep
- `api_version` (enum): scorm_1_2|scorm_2004|both

### 2. Runtime Testing & Execution (Visual Validation)

These tools actually run AI-generated SCORM content using your production-ready engine, enabling AI agents to see how their courses work.

#### `scorm_test_api_integration`
Execute course and test SCORM API interactions in controlled environment.

**Parameters:**
- `workspace_path` (string): Course directory path
- `test_scenario` (object): Sequence of actions to test
- `capture_api_calls` (boolean): Record all API interactions

**Response:**
```json
{
  "success": true,
  "api_test_results": {
    "initialize_success": true,
    "api_calls_captured": [
      {
        "method": "Initialize",
        "parameters": [""],
        "result": "true",
        "error_code": "0"
      }
    ],
    "data_model_state": {
      "cmi.core.lesson_status": "incomplete"
    }
  },
  "detected_issues": []
}
```

#### `scorm_take_screenshot`
Capture visual screenshots of SCORM content for AI agent validation.

**Parameters:**
- `workspace_path` (string): Course directory path
- `viewport` (object): Viewport settings (e.g., { device?: 'desktop|tablet|mobile', width?: number, height?: number, scale?: number })
- `capture_options` (object): Screenshot configuration

**Response:**
```json
{
  "success": true,
  "screenshot_data": "base64_encoded_image",
  "layout_analysis": {
    "responsive_issues": [
      {
        "type": "button_too_small",
        "description": "Next button below minimum touch target size",
        "fix_suggestion": "Increase button padding to minimum 44px height"
      }
    ]
  }
}
```

#### `scorm_test_navigation_flow`
Test complete course navigation and sequencing behavior.

**Parameters:**
- `workspace_path` (string): Course directory path
- `navigation_sequence` (array): Steps to execute (start, next, previous, choice)
- `capture_each_step` (boolean): Screenshot each navigation step

### 3. Validation & Testing Tools

#### `scorm_validate_compliance`
Comprehensive SCORM standard compliance checking.

**Parameters:**
- `workspace_path` (string): Path to SCORM package directory or extracted workspace
- `scorm_version` (enum): auto|1.2|2004_3rd|2004_4th
- `validation_level` (enum): basic|strict|pedantic
- `additional_checks` (array): Extra validation categories to include
- `fix_issues` (boolean): Automatically fix common issues

**Response:**
- `compliance_score` (number): Overall compliance percentage
- `errors` (array): Critical compliance violations
- `warnings` (array): Non-critical issues
- `suggestions` (array): Optimization recommendations
- `fixed_issues` (array): Issues automatically resolved
- `validation_report` (string): Detailed HTML report


### 4. Debugging & Optimization Tools

#### `scorm_debug_api_calls`
Monitor and debug SCORM API interactions in real-time.

**Parameters:**
- `workspace_path` (string): Path to SCORM package directory or extracted workspace
- `monitoring_mode` (enum): real_time|batch|replay
- `api_filters` (array): initialize|terminate|get_value|set_value|commit
- `data_elements` (array): Specific cmi elements to monitor
- `session_duration` (number): Monitoring duration in minutes
- `enable_gui` (boolean): Launch visual debugger interface

**Response:**
- `api_call_log` (array): Chronological API call history
- `data_flow_analysis` (object): Data model usage patterns
- `error_analysis` (object): API errors and their contexts
- `performance_metrics` (object): API call timing and frequency
- `recommendations` (array): Optimization suggestions
- `gui_session_id` (string): GUI session identifier if visual debugging enabled



#### `scorm_trace_sequencing`
Real-time sequencing rule debugging and visualization.

**Parameters:**
- `workspace_path` (string): Path to SCORM package directory or extracted workspace
- `trace_level` (enum): basic|detailed|verbose
- `enable_step_through` (boolean): Enable step-by-step sequencing
- `visualize_tree` (boolean): Show activity tree visualization

**Response:**
- `trace_session_id` (string): Tracing session identifier
- `sequencing_active` (boolean): Whether sequencing monitoring is active
- `visual_tree_url` (string): URL for activity tree visualization if enabled
- `trace_log_url` (string): Real-time trace log interface URL

#### `scorm_get_data_model_history`
Retrieve the sequential history of all SCORM data model changes for an open runtime session.

**Parameters:**
- `session_id` (string, required): Active runtime session ID
- `since_ts` (number, optional): Return only changes after this timestamp (milliseconds)
- `element_prefix` (string|array, optional): Filter by element path prefix (e.g., `'cmi.interactions'` or `['cmi.score', 'cmi.objectives']`)
- `change_session_id` (string, optional): Filter by specific session ID (useful when multiple sessions share telemetry)
- `limit` (number, optional): Maximum number of changes to return (default: 1000)
- `offset` (number, optional): Skip this many changes for pagination (default: 0)

**Response:**
- `session_id` (string): Runtime session ID
- `changes` (array): Array of change entries, each containing:
  - `element` (string): Data model path (e.g., `cmi.location`, `cmi.interactions.0.id`)
  - `previousValue` (any): Value before change (undefined if not previously set)
  - `newValue` (any): Value after change
  - `source` (string): Origin of change (`api:SetValue`, `api:Commit`, `internal`, etc.)
  - `timestamp` (number): Millisecond timestamp
  - `timestampIso` (string): ISO 8601 timestamp
  - `sessionId` (string): Session identifier
  - `collectionIndex` (number, optional): For collection elements (interactions, objectives)
  - `collectionProperty` (string, optional): Property name within collection
  - `previousValueTruncated` (boolean): Whether previous value was truncated
  - `newValueTruncated` (boolean): Whether new value was truncated
  - `newValueOriginalLength` (number): Original length if truncated
- `total` (number): Total number of changes in history
- `has_more` (boolean): Whether more changes are available (for pagination)

**Use Cases:**
- Analyze how learner data evolves during a session
- Debug unexpected data model state
- Verify that API calls are correctly updating the data model
- Track suspend_data changes across commits
- Audit interaction and objective data flow
- Compare before/after values to understand state transitions

**Example:**
```javascript
// Get all score-related changes
const scoreHistory = await scorm_get_data_model_history({
  session_id: 'session-abc',
  element_prefix: 'cmi.score'
});

// Get recent interaction changes
const recentInteractions = await scorm_get_data_model_history({
  session_id: 'session-abc',
  element_prefix: 'cmi.interactions',
  since_ts: Date.now() - 60000, // Last minute
  limit: 50
});
```


#### `scorm_interactive_develop`
Launch interactive development session with advanced SCORM Inspector.

**Parameters:**
- `workspace_path` (string): Path to SCORM package directory or extracted workspace
- `development_mode` (enum): content_edit|debug_api|validate_live|sequence_test
- `auto_validate` (boolean): Continuous validation during development
- `enable_inspector` (boolean): Launch advanced SCORM Inspector

**Response:**
- `session_id` (string): Development session identifier
- `inspector_active` (boolean): SCORM Inspector availability
- `live_validation` (boolean): Real-time validation status
- `development_url` (string): Local development interface URL
- `available_tools` (array): Available development tools in GUI


### 5. DOM Interaction & Browser Testing Tools

These tools enable AI agents to interact with SCORM content in the browser context, essential for testing interactive courses, filling assessments, and debugging user interaction flows.

#### `scorm_dom_click`
Click DOM elements by CSS selector to simulate user interactions.

**Parameters:**
- `session_id` (string, required): Active runtime session ID
- `selector` (string, required): CSS selector for target element
- `options` (object, optional):
  - `click_type` (enum): single|double|right (default: single)
  - `wait_for_selector` (boolean): Wait for element to appear (default: true)
  - `wait_timeout_ms` (number): Maximum wait time in milliseconds (default: 5000)

**Response:**
- `success` (boolean): Whether click was successful
- `element` (object): Clicked element metadata (tagName, id, className, textContent)

**Use Cases:**
- Navigate course slides by clicking "Next" buttons
- Submit assessment answers
- Trigger interactive elements
- Test navigation controls

#### `scorm_dom_fill`
Fill form inputs, select dropdowns, checkboxes, and radio buttons.

**Parameters:**
- `session_id` (string, required): Active runtime session ID
- `selector` (string, required): CSS selector for input element
- `value` (string|boolean|number, required): Value to fill
- `options` (object, optional):
  - `wait_for_selector` (boolean): Wait for element (default: true)
  - `wait_timeout_ms` (number): Maximum wait time (default: 5000)
  - `trigger_events` (boolean): Fire input/change events (default: true)

**Response:**
- `success` (boolean): Whether fill was successful
- `element` (object): Filled element metadata (tagName, type, value, checked)

**Use Cases:**
- Fill assessment text inputs
- Select dropdown options
- Check/uncheck checkboxes
- Select radio buttons

#### `scorm_dom_query`
Query DOM element state for verification and debugging.

**Parameters:**
- `session_id` (string, required): Active runtime session ID
- `selector` (string, required): CSS selector for element
- `query_type` (enum, optional): all|text|attributes|visibility|styles|value (default: all)

**Response:**
- `found` (boolean): Whether element exists
- `selector` (string): Queried selector
- `textContent` (string): Element text content (if query_type includes text)
- `attributes` (object): Element attributes (if query_type includes attributes)
- `visible` (boolean): Element visibility state (if query_type includes visibility)
- `computedStyles` (object): Computed CSS styles (if query_type includes styles)
- `value` (any): Form element value (if query_type includes value)

**Use Cases:**
- Verify content rendering
- Check element visibility
- Read assessment state
- Debug layout issues

#### `scorm_dom_evaluate`
Execute arbitrary JavaScript in the browser context and return serializable results.

**Parameters:**
- `session_id` (string, required): Active runtime session ID
- `expression` (string, required): JavaScript expression to evaluate
- `return_by_value` (boolean, optional): Return by value vs reference (default: true)

**Response:**
- `result` (any): Evaluation result (must be JSON-serializable)

**Use Cases:**
- Custom DOM queries
- Complex state inspection
- Advanced debugging scenarios
- SCORM API state verification

#### `scorm_dom_wait_for`
Wait for DOM conditions to be met before proceeding.

**Parameters:**
- `session_id` (string, required): Active runtime session ID
- `condition` (object, required): Condition to wait for
  - `selector` (string): CSS selector to wait for
  - `visible` (boolean): Wait for visibility state
  - `text` (string): Wait for text content to include string
  - `attribute` (string): Attribute name to check
  - `attribute_value` (string): Expected attribute value
  - `expression` (string): Custom JavaScript expression
- `timeout_ms` (number, optional): Maximum wait time (default: 10000)

**Response:**
- `success` (boolean): Whether condition was met
- `elapsed_ms` (number): Time taken to meet condition

**Use Cases:**
- Wait for dynamic content to load
- Synchronize test steps with animations
- Wait for SCORM API initialization
- Handle async course behavior

#### `scorm_keyboard_type`
Simulate keyboard typing in focused elements.

**Parameters:**
- `session_id` (string, required): Active runtime session ID
- `text` (string, required): Text to type
- `options` (object, optional):
  - `selector` (string): Element to focus before typing
  - `delay_ms` (number): Delay between keystrokes (default: 0)

**Response:**
- `success` (boolean): Whether typing was successful
- `characters_typed` (number): Number of characters typed
- `element` (object): Target element metadata

**Use Cases:**
- Fill text inputs with realistic typing
- Test keyboard event handlers
- Simulate user text entry

#### `scorm_get_network_requests`
Get network requests made by SCORM content for debugging resource loading and API calls.

**Parameters:**
- `session_id` (string, required): Active runtime session ID
- `options` (object, optional):
  - `resource_types` (array): Filter by resource types (document, script, xhr, fetch, etc.)
  - `since_ts` (number): Only return requests after this timestamp
  - `max_count` (number): Maximum number of requests to return (default: 100)

**Response:**
- `session_id` (string): Session ID
- `request_count` (number): Total number of requests
- `requests` (array): Network request details
  - `id` (number): Request ID
  - `timestamp` (number): Request start time
  - `method` (string): HTTP method
  - `url` (string): Request URL
  - `resourceType` (string): Resource type
  - `statusCode` (number): HTTP status code (if completed)
  - `error` (string): Error message (if failed)

**Use Cases:**
- Debug resource loading failures
- Monitor SCORM API HTTP calls
- Track external dependencies
- Identify network-related issues

**Note:** Browser console logs are available via the existing `system_get_logs` tool, which captures all browser console messages along with application logs.

### 6. Session Management Tools

Stateful tools require an explicit session to isolate resources, enable progress reporting, and manage artifacts.
#### Terminology: MCP session vs SCORM RTE session
- MCP session: Resource container for a single package; manages workspace, artifacts, optional offscreen execution, and event streaming for tool calls.
- SCORM RTE session: The runtime lifecycle inside the content attempt (Initialize → Terminate). A single MCP session may run multiple RTE sessions during testing.


#### `scorm_session_open`
Open a new session bound to a single SCORM package. Creates an isolated workspace and (optionally) an offscreen execution context.

- Parameters:
  - `package_path` (string, required): Absolute path to a .zip or folder
  - `execution` (object, optional): `{ allow_network: false }`
  - `timeout_ms` (number, optional): Session idle timeout
- Response:

## MCP Tool Schemas (as-implemented V1)

Notes:
- All methods are invoked via tools/call and follow JSON-RPC 2.0. On failure, the server returns a JSON-RPC error with code -32000 and data.error_code per Error Model above. No fallbacks and no silent errors.
- All inputs are validated; missing/invalid parameters return -32602 with data.error_code MCP_INVALID_PARAMS.

### Session lifecycle

- scorm_session_open
  - params: { package_path: string, execution?: { allow_network?: boolean }, timeout_ms?: number }
  - result.data: { session_id: string, workspace_path: string }
  - errors: MANIFEST_NOT_FOUND, PATH_RESOLUTION_ERROR

- scorm_session_status
  - params: { session_id: string }
  - result.data: { state: "opening"|"ready"|"running"|"closing", started_at: number, last_activity_at: number, artifacts_count: number }
  - errors: MCP_UNKNOWN_SESSION

- scorm_session_events
  - params: { session_id: string, since_event_id?: number, max_events?: number }
  - result.data: { events: Array<{ id:number,type:string,payload?:object,time:number }>, latest_event_id: number }
  - errors: MCP_UNKNOWN_SESSION

- scorm_session_close
  - params: { session_id: string }
  - result.data: { success: boolean, artifacts_manifest_path?: string }
  - errors: MCP_UNKNOWN_SESSION

### Persistent runtime (per session)

- scorm_runtime_open
  - params: { session_id: string, viewport?: { device?: "desktop"|"tablet"|"mobile", width?: number, height?: number, scale?: number } }
  - result.data: { runtime_id: string, entry_found: boolean, viewport: object }
  - errors: MCP_UNKNOWN_SESSION, ELECTRON_REQUIRED, MANIFEST_NOT_FOUND, MANIFEST_LAUNCH_NOT_FOUND

- scorm_runtime_status
  - params: { session_id: string }
  - result.data: { open: boolean, url?: string, initialize_state?: "none"|"initialized"|"terminated", last_api_method?: string|null, last_api_ts?: number|null }
  - errors: none (unknown session returns open:false or MCP_UNKNOWN_SESSION if session missing)

- scorm_runtime_close
  - params: { session_id: string }
  - result.data: { success: boolean }
  - errors: none

### Attempt lifecycle and API

- scorm_attempt_initialize
  - params: { session_id: string }
  - result.data: { result: "true"|"false" }
  - errors: RUNTIME_NOT_OPEN, SCORM_API_ERROR

- scorm_attempt_terminate
  - params: { session_id: string }
  - result.data: { result: "true"|"false" }
  - errors: RUNTIME_NOT_OPEN, SCORM_API_ERROR

- scorm_api_call
  - params: { session_id: string, method: string, args?: any[] }
  - result.data: { result: string }
  - errors: RUNTIME_NOT_OPEN, INVALID_SCORM_METHOD, SCORM_API_ERROR

- scorm_data_model_get
  - params: { session_id: string, elements?: string[], patterns?: string[], include_metadata?: boolean }
  - result.data: { data: object, metadata?: object, errors?: array, element_count: number }
  - errors: RUNTIME_NOT_OPEN
  - description: Get multiple data model elements in one call. Supports wildcards (e.g., "cmi.interactions.*") for bulk reading. Patterns are expanded based on _count values.

### Sequencing & Navigation (SN)

- scorm_nav_get_state
  - params: { session_id: string }
  - result.data:
    - When SN available: { sn_available: true, ...status }
    - When SN not initialized: { sn_available: false, reason: "SN_NOT_INITIALIZED", message: string }
  - errors: RUNTIME_NOT_OPEN, SN_BRIDGE_UNAVAILABLE, SN_BRIDGE_ERROR
  - Note: Returns success even when SN not initialized (expected for single-SCO courses)

- scorm_nav_next
  - params: { session_id: string }
  - result.data:
    - When applicable: { success: boolean, applicable: true }
    - When not applicable: { success: false, applicable: false, reason: string }
  - errors: RUNTIME_NOT_OPEN, SN_BRIDGE_UNAVAILABLE, NAV_UNSUPPORTED_ACTION
  - Note: Returns success with applicable:false when SN not initialized (expected for single-SCO courses)

- scorm_nav_previous
  - params: { session_id: string }
  - result.data:
    - When applicable: { success: boolean, applicable: true }
    - When not applicable: { success: false, applicable: false, reason: string }
  - errors: RUNTIME_NOT_OPEN, SN_BRIDGE_UNAVAILABLE, NAV_UNSUPPORTED_ACTION
  - Note: Returns success with applicable:false when SN not initialized (expected for single-SCO courses)

- scorm_nav_choice
  - params: { session_id: string, targetId: string }
  - result.data:
    - When applicable: { success: boolean, applicable: true }
    - When not applicable: { success: false, applicable: false, reason: string }
  - errors: RUNTIME_NOT_OPEN, SN_BRIDGE_UNAVAILABLE, NAV_UNSUPPORTED_ACTION
  - Note: Returns success with applicable:false when SN not initialized (expected for single-SCO courses)

- scorm_sn_init
  - params: { session_id: string }
  - result.data: { success: boolean }
  - errors: MCP_UNKNOWN_SESSION, RUNTIME_NOT_OPEN, SN_BRIDGE_UNAVAILABLE, SN_INIT_FAILED

- scorm_sn_reset
  - params: { session_id: string }
  - result.data: { success: boolean }
  - errors: MCP_UNKNOWN_SESSION, RUNTIME_NOT_OPEN, SN_BRIDGE_UNAVAILABLE, SN_RESET_FAILED


### Runtime-bound screenshot

- scorm_capture_screenshot
  - params: { session_id: string, capture_options?: { wait_for_selector?: string, wait_timeout_ms?: number, delay_ms?: number } }
  - result.data: { artifact_path?: string, screenshot_data?: string }
  - errors: RUNTIME_NOT_OPEN, ELECTRON_REQUIRED, CAPTURE_FAILED

### File-centric validation & debugging (stateless)

- scorm_validate_workspace
  - params: { workspace_path: string, validation_level?: "basic"|"strict"|"pedantic", check_categories?: string[] }
  - result.data: { success: boolean, validation_results: object, compliance_score?: number, actionable_fixes?: string[] }
  - errors: MANIFEST_NOT_FOUND, MANIFEST_VALIDATION_ERROR

- scorm_lint_manifest
  - params: { workspace_path: string, scorm_version?: "auto"|"2004_3rd"|"2004_4th", strict_mode?: boolean }
  - result.data: { valid: boolean, errors?: string[], warnings?: string[] }
  - errors: MANIFEST_NOT_FOUND, MANIFEST_VALIDATION_ERROR

- scorm_lint_api_usage
  - params: { workspace_path: string, scan_depth?: "surface"|"deep", api_version?: "scorm_1_2"|"scorm_2004"|"both" }
  - result.data: { scanned_files: string[], issues: Array<{file:string,line:number,issue:string,fix_suggestion?:string}> }
  - errors: CONTENT_FILE_MISSING



  - `session_id` (string)
  - `workspace_path` (string)

#### `scorm_session_status`
Return current session state and high-level metrics.

- Parameters: `session_id` (string)
- Response: `{ state: opening|ready|running|closing, started_at, last_activity_at, artifacts_count }`

#### `scorm_session_events`
Stream/poll structured events emitted during long-running operations.

- Parameters:
  - `session_id` (string)
  - `since_event_id` (number, optional)
  - `max_events` (number, optional)
- Response: `{ events: [...], latest_event_id }`

Event examples: `debug:api_call`, `trace:sequencing_step`, `validation:progress`, `navigation:completed`, `screenshot:capture_done`, `error`.

#### `scorm_session_close`
Shut down resources, close offscreen contexts, and finalize artifacts.


### Runtime test utilities (stateless)

- scorm_test_api_integration
  - params: { workspace_path: string, session_id?: string, viewport?: { device?: "desktop"|"tablet"|"mobile", width?: number, height?: number, scale?: number }, capture_api_calls?: boolean, test_scenario?: object }
  - result.data: { api_test_results: { initialize_success: boolean, data_model_state: object, api_calls_captured?: any[] }, manifest_ok: boolean, scorm_version: string|null, scenario_ack: boolean }
  - errors: ELECTRON_REQUIRED

- scorm_test_navigation_flow
  - params: { workspace_path: string, session_id?: string, viewport?: { device?: "desktop"|"tablet"|"mobile", width?: number, height?: number, scale?: number }, capture_each_step?: boolean, navigation_sequence?: string[] }
  - result.data: { supported: true, entry_found: true, steps_executed: number, artifacts: string[] }
  - errors: ELECTRON_REQUIRED, MANIFEST_LAUNCH_NOT_FOUND, NAV_FLOW_ERROR

- scorm_debug_api_calls
  - params: { workspace_path: string, session_id?: string, viewport?: { device?: "desktop"|"tablet"|"mobile", width?: number, height?: number, scale?: number }, filter_methods?: string[], detect_anomalies?: boolean, include_data_model_state?: boolean }
  - result.data: { supported: true, entry_found: true, calls: any[], metrics: { total_calls: number, by_method: Record<string, number>, first_ts: number|null, last_ts: number|null, duration_ms: number, methods: string[] }, anomalies?: array }
  - errors: ELECTRON_REQUIRED, MANIFEST_LAUNCH_NOT_FOUND, DEBUG_API_ERROR
  - description: Enhanced with anomaly detection (missing Initialize/Terminate/Commit, calls before Initialize, etc.) and optional data model state tracking after each SetValue call.

- scorm_trace_sequencing
  - params: { workspace_path: string, session_id?: string, viewport?: { device?: "desktop"|"tablet"|"mobile", width?: number, height?: number, scale?: number }, trace_level?: "basic"|"detailed"|"verbose" }
  - result.data: { supported: true, entry_found: true, trace: any[], trace_level: "basic"|"detailed"|"verbose", sequencing_active: boolean }
  - errors: ELECTRON_REQUIRED, MANIFEST_LAUNCH_NOT_FOUND, TRACE_SEQUENCING_ERROR

- scorm_assessment_interaction_trace
  - params: { session_id: string, actions: array<{ type: "click"|"fill"|"wait", selector?: string, value?: any, ms?: number }>, capture_mode?: "standard"|"detailed" }
  - result.data: { steps: array, issues_detected: array, summary: { total_actions: number, successful_actions: number, total_api_calls: number, data_model_elements_changed: number } }
  - errors: MCP_INVALID_PARAMS, RUNTIME_NOT_OPEN
  - description: Trace assessment interactions with complete before/after correlation. Each step includes DOM state changes, API calls triggered, and data model changes. Automatically detects common issues like missing Commit, incomplete interaction data, etc. Ideal for debugging why assessments aren't updating the data model correctly.

- scorm_dom_find_interactive_elements
  - params: { session_id: string }
  - result.data: { forms: array, buttons: array, inputs: array, assessments: array, navigation: array, interactive_elements: array }
  - errors: MCP_INVALID_PARAMS, RUNTIME_NOT_OPEN, DOM_FIND_ERROR
  - description: Discover all interactive elements on the current page. Returns structured data about forms (with inputs and submit buttons), standalone buttons (with inferred purpose), assessments (with question text and answer options), and navigation controls. Reduces 10+ exploratory queries to 1 call.

- scorm_dom_fill_form_batch
  - params: { session_id: string, fields: array<{ selector: string, value: any, options?: object }> }
  - result.data: { total_fields: number, successful: number, failed: number, results: array, errors?: array }
  - errors: MCP_INVALID_PARAMS, RUNTIME_NOT_OPEN
  - description: Fill multiple form fields in a single batch operation. Automatically handles different input types (text, radio, checkbox, select) and triggers appropriate events. Reduces 10+ scorm_dom_fill calls to 1 for assessment completion.

- scorm_validate_data_model_state
  - params: { session_id: string, expected: object }
  - result.data: { valid: boolean, total_elements: number, matches: number, issues?: array, matched_elements: array }
  - errors: MCP_INVALID_PARAMS, RUNTIME_NOT_OPEN
  - description: Validate current data model state against expected values. Returns detailed diff with helpful hints for mismatches (e.g., "Element was never set - check if SetValue was called"). Instant validation instead of manual comparison.

- scorm_get_console_errors
  - params: { session_id: string, since_ts?: number, severity?: array<"error"|"warning"|"info"> }
  - result.data: { session_id: string, error_count: number, errors: array, categories: { scorm_api: number, syntax: number, runtime: number, network: number } }
  - errors: MCP_INVALID_PARAMS, RUNTIME_NOT_OPEN, CONSOLE_ERROR_FETCH_FAILED
  - description: Get browser console errors/warnings from SCORM content. Filters out app-generated messages and categorizes errors by type. Provides stack traces and source locations. Critical for debugging JavaScript errors that cause silent failures.

- scorm_compare_data_model_snapshots
  - params: { before: object, after: object }
  - result.data: { summary: { total_elements: number, added: number, changed: number, unchanged: number, removed: number }, added: array, changed: array, unchanged: array, removed: array }
  - errors: MCP_INVALID_PARAMS
  - description: Compare two data model snapshots and return detailed diff. Shows what changed, what didn't change (but should have), and what's missing. Useful for comparing expected vs actual state after interactions.

- scorm_wait_for_api_call
  - params: { session_id: string, method: string, timeout_ms?: number }
  - result.data: { found: boolean, call: { method: string, args: array, result: string, error_code: string, timestamp: number }, elapsed_ms: number }
  - errors: MCP_INVALID_PARAMS, RUNTIME_NOT_OPEN, WAIT_TIMEOUT
  - description: Wait for a specific SCORM API call to occur. Returns immediately when the call happens or throws timeout error. Eliminates arbitrary wait delays and polling loops.

- scorm_get_current_page_context
  - params: { session_id: string }
  - result.data: { page_type: string, slide_number: number, total_slides: number, section_title: string, progress_percent: number, navigation_available: { next: boolean, previous: boolean, menu: boolean }, page_title: string, url: string }
  - errors: MCP_INVALID_PARAMS, RUNTIME_NOT_OPEN, PAGE_CONTEXT_ERROR
  - description: Get semantic information about current page. Extracts slide number, section title, progress indicators, and identifies page type (intro, content, assessment, summary). Enables intelligent navigation decisions.

- scorm_replay_api_calls
  - params: { session_id: string, calls: array<{ method: string, args?: array }> }
  - result.data: { success: boolean, total_calls: number, executed_calls: number, failed_at_index?: number, error?: object, results: array }
  - errors: MCP_INVALID_PARAMS, RUNTIME_NOT_OPEN
  - description: Replay a sequence of API calls to reproduce behavior. Shows which call fails and why. Useful for debugging and testing API call sequences.

- Parameters: `session_id` (string)
- Response: `{ success: boolean, artifacts_manifest_path }`

## Data Formats & Integration

### Supported Development Inputs
- **Natural Language**: Development requirements, feature descriptions, debugging requests
- **Structured Data**: JSON configurations, API specifications, validation rules
- **Existing SCORM**: SCORM 1.2/2004 packages for analysis, debugging, and enhancement
- **Development Files**: HTML/CSS/JS content, media assets, configuration files
- **Debug Data**: API logs, error reports, performance metrics
- **Test Scenarios**: Validation requirements, compliance specifications

### Development Output Formats
- **Enhanced SCORM Packages**: Optimized 2004 4th Edition packages with debug integration
- **Development Reports**: Detailed validation, compliance, and optimization analysis
- **Debug Information**: API interaction logs, data model traces, sequencing analysis
- **Developer Documentation**: Implementation guides, API usage examples, best practices

### Development Tool Integration
- **Advanced SCORM Inspector**: Real-time package analysis and debugging
- **Live API Monitoring**: Detailed tracking of all SCORM API interactions
- **Interactive Validation**: Visual compliance checking with auto-fix suggestions
- **Content Development**: Integrated editing and testing environment

## AI Agent Testing Workflow

### Typical AI Agent Development Process

```javascript
// 1. AI agent writes SCORM course files directly
// Creates: imsmanifest.xml, sco1.html, styles.css, script.js, etc.

// 2. Open validation session
const session = await scorm_session_open({
  workspace_path: "./my-generated-course"
});

// 3. Validate file structure and compliance
const validation = await scorm_validate_workspace({
  workspace_path: "./my-generated-course",
  validation_level: "strict"
});

if (!validation.success) {
  console.log("Issues found:", validation.validation_results);
  // AI agent fixes files based on specific feedback
}

// 4. Test SCORM API integration by actually running the course
const apiTest = await scorm_test_api_integration({
  workspace_path: "./my-generated-course",
  capture_api_calls: true
});

// 5. Visual validation - see how the course actually looks
const screenshots = await scorm_take_screenshot({
  workspace_path: "./my-generated-course",
  viewport: { device: "mobile", width: 768, height: 1024 }
});

if (screenshots.layout_analysis.responsive_issues.length > 0) {
  console.log("Layout issues detected:", screenshots.layout_analysis.responsive_issues);
  // AI agent can see exactly what's wrong and fix CSS
}

// 6. Test navigation flow
const navTest = await scorm_test_navigation_flow({
  workspace_path: "./my-generated-course",
  navigation_sequence: ["start", "next", "next", "complete"],
  capture_each_step: true
});

// 7. AI agent iterates on files based on testing results
// 8. Repeat until all tests pass

await scorm_session_close({session_id: session.session_id});
```

### Value for AI Agents

**Before MCP Tool:**
- AI generates SCORM files blindly
- No way to test if they actually work
- Relies on manual testing by humans
- High failure rate in real LMS environments

**After MCP Tool:**
- AI can validate generated files immediately
- See visual evidence of layout issues
- Test SCORM API integration automatically
- Fix issues based on specific feedback
- Confident deployment to LMS systems

## Configuration & Settings

### MCP Server Configuration
Basic server configuration options:
- **Tool Registry**: Available MCP tools and their capabilities
- **Output Formatting**: JSON response structure preferences
- **Error Handling**: Error reporting and diagnostic levels
- **Performance Settings**: Processing timeouts and resource limits

### Validation Settings
Built-in validation configuration:
- **SCORM Compliance Level**: Choose validation strictness (basic, standard, strict)
- **Accessibility Requirements**: Set WCAG compliance level (AA, AAA)
- **Performance Thresholds**: Configure acceptable loading times and file sizes
- **Browser Support**: Select target browsers and devices for compatibility testing

## Development Security & Safety

### Content Safety
- **Sandboxing**: Safe execution of untrusted SCORM content during development
- **Input Validation**: Prevent injection attacks and malformed data
- **Development Isolation**: Isolated testing environments for content validation
- **File System Protection**: Controlled access to development files

### Development Workflow Security
- **Code Injection Prevention**: Safe handling of dynamic SCORM content
- **Resource Management**: Prevent resource exhaustion during development
- **Debug Data Protection**: Secure handling of debugging information
- **Development Environment Isolation**: Separate development from production concerns

## Performance & Optimization

### MCP Tool Performance
- **Fast Response Times**: Sub-second response for most MCP tool operations
- **Efficient Caching**: Cache validation results and package analysis data
- **Lazy Loading**: Load SCORM content and resources on demand
- **Memory Management**: Efficient handling of large SCORM packages
- **Resource Cleanup**: Proper cleanup of temporary files and processes

### Content Processing Optimization
- **Parallel Processing**: Handle multiple SCORM operations concurrently
- **Compression**: Efficient compression of generated SCORM packages and assets
- **File Streaming**: Stream large files to reduce memory usage
- **Background Processing**: Handle time-intensive operations asynchronously
- **Error Recovery**: Graceful handling of processing failures

### Monitoring & Diagnostics
- **Error Tracking**: Comprehensive logging of tool errors and diagnostics
- **Health Monitoring**: System health checks and automated issue detection
- **Debug Information**: Detailed debugging output for troubleshooting

## Implementation Architecture

### Core Foundation
- **MCP Server Framework**: Comprehensive MCP protocol implementation
- **SCORM Engine**: Complete SCORM processing capabilities leveraging existing production-ready components
- **Content Generation**: SCORM package creation tools for AI agents to use
- **Validation Tools**: Enhanced SCORM compliance checking with automated issue resolution
- **Documentation**: Comprehensive API documentation and user guides

### MCP Protocol Layer
- **stdio Communication**: Standard input/output protocol handling for AI agent interaction
- **Tool Registration**: Dynamic registration and discovery of available SCORM tools
- **Request Processing**: Parse and route MCP tool requests from AI agents
- **Response Formatting**: Structure tool outputs as standardized MCP responses

### Advanced Capabilities
- **Multi-Platform Testing**: Comprehensive LMS compatibility testing framework
- **Performance Analytics**: Real-time monitoring and optimization insights
- **Content Optimization**: Advanced compression, accessibility, and mobile optimization
- **Security Framework**: Robust security scanning and vulnerability detection
- **Debugging Tools**: Real-time API monitoring and troubleshooting capabilities

## Development Success Metrics

### Technical Excellence
- **SCORM Compliance**: Maintain 100% compliance with SCORM 2004 4th Edition in all development workflows
- **Development Performance**: Sub-second response times for debugging and validation tools
- **Tool Reliability**: Robust error handling and consistent behavior across development scenarios
- **MCP Integration**: Seamless AI agent integration for complex development workflows
- **Debug Capability**: Comprehensive real-time debugging and inspection features

### Developer Experience Metrics
- **Debug Efficiency**: Rapid identification and resolution of SCORM development issues
- **Validation Accuracy**: Precise compliance checking with actionable improvement suggestions
- **Development Speed**: Accelerated SCORM package creation and optimization workflows
- **Tool Usability**: Intuitive MCP tool interface for AI agent coordination
- **Workflow Coverage**: Complete support for end-to-end SCORM development processes

### Development Impact
- **AI Agent Enablement**: Provide sophisticated SCORM development capabilities to AI systems
- **Quality Assurance**: Automated compliance validation and issue resolution
- **Development Acceleration**: Streamlined workflows for rapid SCORM content creation
- **Standards Adherence**: Strict compliance with SCORM 2004 4th Edition specifications
- **Developer Productivity**: Enhanced development experience with advanced debugging tools


## Implementation Foundations and MVP Scope (Updated)

### Standard Response Envelope and Error Mapping
All tools should return a uniform envelope:

```json
{
  "success": true,
  "error_code": null,
  "message": "",
  "data": { /* tool-specific */ },
  "artifacts": [ { "type": "report|screenshot|trace|patch", "path": "sessions/<id>/..." } ],
  "diagnostics": { "duration_ms": 0 }
}
```

- Error codes map to existing ParserErrorCode where applicable: `MANIFEST_NOT_FOUND`, `CONTENT_FILE_MISSING`, `SECURITY_VIOLATION`, `PATH_RESOLUTION_ERROR`, `MANIFEST_VALIDATION_ERROR`.
- Always prefer actionable `message` text; keep raw stacks only in logs.
- Responses may also include `artifacts_manifest_path` referencing the session's artifacts.json manifest for the full list of generated artifacts.


### Execution Model (Always Real, Offscreen Electron)
- All runtime tools use an offscreen BrowserWindow/WebContents for RTE execution, API injection, sequencing evaluation with UI, and screenshots.
- WebPreferences are fixed: `{ offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false }`.
- Validation-only tools do not create web contents.

### Real Adapter + SN IPC (Always On)
- Electron preload (src/mcp/preload/scorm-preload.js) exposes bridges:
  - SCORM_MCP.apiInvoke(method, args) → routes to ipc 'scorm-mcp:api'
  - SCORM_MCP.snInvoke(action, payload) → routes to ipc 'scorm-mcp:sn'
- Runtime adapter (src/mcp/runtime-adapter.js) registers:
  - ipcMain.handle('scorm-mcp:api', { method, args }) → delegates to ScormApiHandler instance per window
  - ipcMain.handle('scorm-mcp:sn', { action, payload }):
    - Actions:
      - init({ manifestPath, folderPath }) → parse manifest and initialize SN service for the window
      - status() → return SN status snapshot (implementation-defined shape)
      - reset() → reset SN service state for the window
- scorm_trace_sequencing integration:
  - Continues to emit manifest-derived entries (sn_summary, sn_activity_titles)
  - When bridge available and flag enabled, initializes SN engine and emits 'sn_engine_init' and 'sn_engine_status' trace entries

### Security & Path Policies
- Enforce the Compatibility Requirements via PathUtils for all file operations:
  - Manifest must be at package root; no recursive search
  - All paths resolved relative to manifest root; block traversal (`..` outside workspace)
  - Default to offline execution; `allow_network` must be explicitly opted-in per session
- For mutation tools (e.g., compliance fixes):
  - Operate on a copy in the session workspace, never in-place
  - `backup_original: true` by default; produce a patch/diff artifact when changes are made

### Artifacts & Session Directory Layout
- Each session has its own workspace directory: `sessions/<session_id>/`
- Maintain `artifacts.json` manifest listing artifacts with types, paths, and metadata
- All tool responses include relative `artifacts[*].path` inside the session workspace

### MVP (V1) Tool Surface
Ship a small, high-value, file-centric set first:

- Linting & Validation (no runtime window required)
  - `scorm_validate_workspace` (runs a suite of checks across the working folder)
  - `scorm_lint_manifest` (validate imsmanifest.xml vs schemas and rules)
  - `scorm_lint_sequencing` (static SN rule checks and rule conflicts)
  - `scorm_lint_api_usage` (scan HTML/JS for SCORM API anti-patterns)
  - `scorm_validate_compliance` (end-to-end compliance assessment)

- Runtime Debugging (offscreen execution)
  - `scorm_trace_sequencing` (basic tracing)
  - `scorm_debug_api_calls` (API call monitoring)
  - `scorm_take_screenshot` (activity/content screenshots)

- Reporting & Guidance
  - `scorm_report` (HTML/JSON report aggregating findings, with remediation guidance)

Defer to V2 (optional): generation tools and auto-fix tools that modify content directly. Prefer patch proposals by default.


### Implementation Progress (V1) — Updated

Status of the MVP tool surface and related architecture based on current code and tests:

- Linting & Validation
  - scorm_validate_workspace — Implemented ✅
  - scorm_lint_manifest — Implemented ✅
  - scorm_lint_api_usage — Implemented ✅ (basic line-number hints added)
  - scorm_lint_sequencing — Implemented ✅ (flags leaf items missing identifierref)
  - scorm_validate_compliance — Implemented ✅ (basic aggregate scoring + JSON report)

- Runtime Debugging / Execution
  - scorm_test_api_integration — Implemented (Electron-aware; structured fallback when Electron unavailable) ✅
  - scorm_take_screenshot — Implemented ✅
    - Viewport presets (desktop/tablet/mobile) ✅
    - capture_options: wait_for_selector, wait_timeout_ms, delay_ms ✅
  - scorm_test_navigation_flow — Implemented ✅ (optional per-step screenshots + artifacts)
  - scorm_debug_api_calls — Implemented ✅ (capture + filter_methods + metrics)
  - scorm_trace_sequencing — Implemented ✅ (trace levels basic/detailed/verbose + event streaming)

- Reporting & Guidance
  - scorm_report — Implemented ✅ (JSON + HTML; HTML writes artifact when session_id provided)

- Sessions & Artifacts
  - scorm_session_open/status/events/close — Implemented ✅
  - Per-session workspace + artifacts manifest — Implemented ✅
  - Event streaming during runtime ops — Implemented ✅

- Runtime Entry Resolution
  - CAM-based default-organization/item launch resolution — Implemented ✅

- Testing
  - Jest unit tests for MCP tools — Implemented; current run: 21 suites, 30 tests, all passing ✅


### Long-Running Operations
- Return quickly with `session_id` and a `state: running` where applicable
- Clients poll `scorm_session_events` and/or `scorm_session_status`
- Provide `cancel` via `scorm_session_close`

### Testing Strategy (CI-friendly)
- Unit tests per tool: input validation, error mapping, envelope correctness
- Session lifecycle tests: open → analyze/validate → close; assert cleanup and artifacts manifest
- Runtime smoke: minimal course load, API Initialize/Terminate observed, 1 screenshot captured
- Non-regression: reuse existing validator/inspector fixtures and ensure event shapes remain stable

These updates formalize sessions, standardize responses, ensure safe-by-default behavior, and define a pragmatic V1 scope aligned with the current architecture.

## Conclusion

The SCORM MCP Development Tool transforms the existing production-ready SCORM Tester (with 100% SCORM 2004 4th Edition compliance) into a sophisticated AI-enabled development platform. By exposing the advanced debugging, validation, and inspection capabilities through a comprehensive MCP protocol interface, this tool enables AI agents to efficiently create, debug, and optimize SCORM content.

The hybrid architecture preserves the powerful interactive development experience while adding AI agent coordination capabilities. This approach leverages the existing sophisticated SCORM engine, advanced inspector, and real-time debugging features rather than rebuilding them, ensuring immediate production readiness.

Focused on developer workflows rather than learner delivery, this specification provides the blueprint for enhancing SCORM development with AI assistance. The tool serves as a bridge between traditional SCORM development practices and modern AI-driven workflows, maintaining strict compliance standards while dramatically improving development efficiency and quality assurance processes.

This MCP-enhanced development tool positions SCORM content creation at the forefront of AI-assisted development, providing developers and AI agents with the essential capabilities needed for modern e-learning content development workflows.

