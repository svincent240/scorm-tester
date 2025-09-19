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
  - SN_BRIDGE_UNAVAILABLE, SN_NOT_INITIALIZED, NAV_UNSUPPORTED_ACTION
  - INVALID_SCORM_METHOD, SCORM_API_ERROR

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


### 5. Session Management Tools

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

### Sequencing & Navigation (SN)

- scorm_nav_get_state
  - params: { session_id: string }
  - result.data: { ...status }
  - errors: RUNTIME_NOT_OPEN, SN_BRIDGE_UNAVAILABLE, SN_NOT_INITIALIZED

- scorm_nav_next
  - params: { session_id: string }
  - result.data: { success: boolean }
  - errors: RUNTIME_NOT_OPEN, SN_BRIDGE_UNAVAILABLE, NAV_UNSUPPORTED_ACTION

- scorm_nav_previous
  - params: { session_id: string }
  - result.data: { success: boolean }
  - errors: RUNTIME_NOT_OPEN, SN_BRIDGE_UNAVAILABLE, NAV_UNSUPPORTED_ACTION

- scorm_nav_choice
  - params: { session_id: string, targetId: string }
  - result.data: { success: boolean }
  - errors: RUNTIME_NOT_OPEN, SN_BRIDGE_UNAVAILABLE, NAV_UNSUPPORTED_ACTION

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
  - params: { workspace_path: string, session_id?: string, viewport?: { device?: "desktop"|"tablet"|"mobile", width?: number, height?: number, scale?: number }, filter_methods?: string[] }
  - result.data: { supported: true, entry_found: true, calls: any[], metrics: { total_calls: number, by_method: Record<string, number>, first_ts: number|null, last_ts: number|null, duration_ms: number, methods: string[] } }
  - errors: ELECTRON_REQUIRED, MANIFEST_LAUNCH_NOT_FOUND, DEBUG_API_ERROR

- scorm_trace_sequencing
  - params: { workspace_path: string, session_id?: string, viewport?: { device?: "desktop"|"tablet"|"mobile", width?: number, height?: number, scale?: number }, trace_level?: "basic"|"detailed"|"verbose" }
  - result.data: { supported: true, entry_found: true, trace: any[], trace_level: "basic"|"detailed"|"verbose", sequencing_active: boolean }
  - errors: ELECTRON_REQUIRED, MANIFEST_LAUNCH_NOT_FOUND, TRACE_SEQUENCING_ERROR

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

