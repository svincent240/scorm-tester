"use strict";

/**
 * MCP stdio server (JSON-RPC 2.0 only) with tool registry.
 * Transport: JSON-RPC 2.0 over stdio (one message per line on stdout).
 */

const { mapError } = require("./errors");
const ToolRouter = require("./router");
const { scorm_echo } = require("./tools/echo");
const { scorm_open_course, scorm_close_course, scorm_reload_course, scorm_clear_saved_data, scorm_course_status, scorm_session_open, scorm_session_close } = require("./tools/session");
const { scorm_lint_manifest, scorm_lint_api_usage, scorm_lint_parent_dom_access, scorm_validate_workspace, scorm_lint_sequencing, scorm_validate_compliance, scorm_report } = require("./tools/validate");
const { scorm_runtime_open, scorm_runtime_status, scorm_api_call, scorm_data_model_get, scorm_nav_get_state, scorm_nav_next, scorm_nav_previous, scorm_nav_choice, scorm_sn_init, scorm_sn_reset, scorm_capture_screenshot, scorm_trace_sequencing, scorm_get_data_model_history, scorm_get_network_requests, scorm_assessment_interaction_trace, scorm_validate_data_model_state, scorm_get_console_errors, scorm_compare_data_model_snapshots, scorm_wait_for_api_call, scorm_get_current_page_context, scorm_replay_api_calls, scorm_get_page_state, scorm_get_slide_map, scorm_navigate_to_slide, scorm_set_viewport_size } = require("./tools/runtime");
const { scorm_dom_click, scorm_dom_fill, scorm_dom_query, scorm_dom_evaluate, scorm_dom_wait_for, scorm_keyboard_type, scorm_dom_find_interactive_elements, scorm_dom_fill_form_batch, scorm_dom_click_by_text } = require("./tools/dom");
const { scorm_automation_check_availability, scorm_automation_list_interactions, scorm_automation_set_response, scorm_automation_check_answer, scorm_automation_get_response, scorm_automation_get_course_structure, scorm_automation_get_current_slide, scorm_automation_go_to_slide, scorm_automation_get_correct_response, scorm_automation_get_last_evaluation, scorm_automation_check_slide_answers, scorm_automation_get_trace, scorm_automation_clear_trace, scorm_automation_get_interaction_metadata, scorm_automation_get_version, scorm_automation_get_page_layout, scorm_automation_get_layout_flow, scorm_automation_get_layout_tree, scorm_automation_get_element_details, scorm_automation_validate_page_layout, scorm_engagement_get_state, scorm_engagement_get_progress, scorm_engagement_mark_tab_viewed, scorm_engagement_set_scroll_depth, scorm_engagement_reset } = require("./tools/automation");

const getLogger = require('../shared/utils/logger.js');
const fs = require('fs');
const path = require('path');

// Initialize logger with explicit log directory (set by node-bridge.js or electron-entry.js)
const logger = getLogger(process.env.SCORM_TESTER_LOG_DIR);

// Log server startup for debugging (only once when module loads)
if (logger && !global.__mcpServerLoggedStartup) {
  global.__mcpServerLoggedStartup = true;
  logger.info('MCP Server module loaded', {
    logDir: process.env.SCORM_TESTER_LOG_DIR,
    logFiles: {
      ndjson: logger.ndjsonFile,
      errors: logger.errorsFile,
      humanReadable: logger.logFile
    },
    pid: process.pid,
    note: 'Use system_get_logs tool to retrieve logs'
  });
}

const router = new ToolRouter();

// Helpful metadata for MCP clients (tools/list)
const TOOL_META = new Map([
  // Connectivity
  ["scorm_echo", { description: "Echo utility for connectivity tests", inputSchema: { type: "object" } }],
  
  // Unified Course Management
  ["scorm_open_course", { description: "Open a SCORM course: Creates workspace, opens runtime, loads content, and auto-initializes (combines session_open + runtime_open)", inputSchema: { type: "object", properties: { package_path: { type: "string" }, viewport: { type: "object", properties: { width: { type: "number" }, height: { type: "number" } } }, timeout_ms: { type: "number" } }, required: ["package_path"] } }],
  ["scorm_close_course", { description: "Close course: Sets cmi.exit='suspend', calls Terminate() to save data, closes runtime, and cleans up", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_reload_course", { description: "Reload course: Atomic close + re-open operation (terminates existing, then creates fresh session with same package)", inputSchema: { type: "object", properties: { session_id: { type: "string" }, package_path: { type: "string" }, viewport: { type: "object" } }, required: ["session_id", "package_path"] } }],
  ["scorm_clear_saved_data", { description: "Clear saved session data for a course (deletes persisted JSON file for hard reset)", inputSchema: { type: "object", properties: { package_path: { type: "string" } }, required: ["package_path"] } }],
  ["scorm_course_status", { description: "Get course status (state, timestamps, artifact count)", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  
  // Legacy (deprecated - use scorm_open_course/scorm_close_course instead)
  ["scorm_session_open", { description: "[DEPRECATED] Use scorm_open_course instead - creates workspace only, requires separate runtime_open", inputSchema: { type: "object", properties: { package_path: { type: "string" } }, required: ["package_path"] } }],
  ["scorm_session_close", { description: "[DEPRECATED] Use scorm_close_course instead", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],

  // Static Validation (no runtime execution)
  ["scorm_lint_manifest", { description: "Parse and validate imsmanifest.xml structure and schema compliance", inputSchema: { type: "object", properties: { workspace_path: { type: "string" } }, required: ["workspace_path"] } }],
  ["scorm_lint_api_usage", { description: "Static analysis of HTML/JS files for SCORM API usage patterns (Initialize/GetValue/SetValue/Terminate)", inputSchema: { type: "object", properties: { workspace_path: { type: "string" } }, required: ["workspace_path"] } }],
  ["scorm_lint_parent_dom_access", { description: "Detect parent window DOM access violations in SCORM content (spec violation)", inputSchema: { type: "object", properties: { workspace_path: { type: "string" } }, required: ["workspace_path"] } }],
  ["scorm_lint_sequencing", { description: "Validate sequencing structure and detect common sequencing rule issues", inputSchema: { type: "object", properties: { workspace_path: { type: "string" } }, required: ["workspace_path"] } }],
  ["scorm_validate_workspace", { description: "Comprehensive validation combining manifest, API usage, and parent DOM checks", inputSchema: { type: "object", properties: { workspace_path: { type: "string" } }, required: ["workspace_path"] } }],
  ["scorm_validate_compliance", { description: "Generate compliance score and aggregate validation report", inputSchema: { type: "object", properties: { workspace_path: { type: "string" } }, required: ["workspace_path"] } }],
  ["scorm_report", { description: "Generate detailed compliance report in JSON or HTML format", inputSchema: { type: "object", properties: { workspace_path: { type: "string" }, session_id: { type: "string" }, format: { type: "string", enum: ["json", "html"] } }, required: ["workspace_path"] } }],

  // Runtime Execution & Testing (Electron required)
  ["scorm_runtime_open", { description: "Open persistent offscreen runtime for a session - loads SCORM content in background browser (Electron required)", inputSchema: { type: "object", properties: { session_id: { type: "string" }, viewport: { type: "object" } }, required: ["session_id"] } }],
  ["scorm_runtime_status", { description: "Get persistent runtime status (open state, URL, Initialize state, last API call)", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],

  // SCORM RTE API Methods (requires open runtime)
  ["scorm_api_call", { description: "Call any SCORM RTE API method (GetValue, SetValue, Commit, Initialize, Terminate, etc.) on persistent runtime", inputSchema: { type: "object", properties: { session_id: { type: "string" }, method: { type: "string" }, args: { type: "array", items: {} } }, required: ["session_id", "method"] } }],
  ["scorm_data_model_get", { description: "Get multiple data model elements in one call - supports wildcards (e.g., 'cmi.interactions.*') for bulk reading", inputSchema: { type: "object", properties: { session_id: { type: "string" }, elements: { type: "array", items: { type: "string" } }, patterns: { type: "array", items: { type: "string" } }, include_metadata: { type: "boolean" } }, required: ["session_id"] } }],

  // Sequencing & Navigation (requires SN bridge initialization)
  ["scorm_sn_init", { description: "Initialize sequencing & navigation engine from manifest", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_sn_reset", { description: "Reset sequencing & navigation engine state", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_nav_get_state", { description: "Get current sequencing & navigation state snapshot", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_nav_next", { description: "Execute sequencing continue (next) navigation request", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_nav_previous", { description: "Execute sequencing previous navigation request", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_nav_choice", { description: "Execute sequencing choice navigation to target activity", inputSchema: { type: "object", properties: { session_id: { type: "string" }, targetId: { type: "string" } }, required: ["session_id", "targetId"] } }],

  // Integrated Testing Tools (Electron required)
  ["scorm_trace_sequencing", { description: "Execute content and capture sequencing structure trace with configurable detail level (Electron required)", inputSchema: { type: "object", properties: { workspace_path: { type: "string" }, session_id: { type: "string" }, trace_level: { type: "string", enum: ["basic", "detailed", "verbose"] }, viewport: { type: "object" } }, required: ["workspace_path"] } }],
  ["scorm_assessment_interaction_trace", { description: "Trace assessment interactions with complete before/after correlation of DOM actions, API calls, and data model state - ideal for debugging assessment issues (requires open runtime)", inputSchema: { type: "object", properties: { session_id: { type: "string" }, actions: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: ["click", "fill", "wait"] }, selector: { type: "string" }, value: { type: ["string", "number", "boolean"] }, ms: { type: "number" } } } }, capture_mode: { type: "string", enum: ["standard", "detailed"] } }, required: ["session_id", "actions"] } }],

  // Screenshot & Visual Validation (Electron required)
  ["scorm_capture_screenshot", { description: "Capture screenshot from persistent runtime session with optional wait/delay", inputSchema: { type: "object", properties: { session_id: { type: "string" }, capture_options: { type: "object", properties: { wait_for_selector: { type: "string" }, wait_timeout_ms: { type: "number" }, delay_ms: { type: "number" } } } }, required: ["session_id"] } }],

  // DOM Interaction (requires open runtime)
  ["scorm_dom_click", { description: "Click DOM element by CSS selector in SCORM content", inputSchema: { type: "object", properties: { session_id: { type: "string" }, selector: { type: "string" }, options: { type: "object", properties: { click_type: { type: "string", enum: ["single", "double", "right"] }, wait_for_selector: { type: "boolean" }, wait_timeout_ms: { type: "number" } } } }, required: ["session_id", "selector"] } }],
  ["scorm_dom_fill", { description: "Fill form input element by CSS selector (text, select, checkbox, radio)", inputSchema: { type: "object", properties: { session_id: { type: "string" }, selector: { type: "string" }, value: { type: ["string", "boolean", "number"] }, options: { type: "object", properties: { wait_for_selector: { type: "boolean" }, wait_timeout_ms: { type: "number" }, trigger_events: { type: "boolean" } } } }, required: ["session_id", "selector", "value"] } }],
  ["scorm_dom_query", { description: "Query DOM element state by CSS selector (text, attributes, visibility, styles, value)", inputSchema: { type: "object", properties: { session_id: { type: "string" }, selector: { type: "string" }, query_type: { type: "string", enum: ["all", "text", "attributes", "visibility", "styles", "value"] } }, required: ["session_id", "selector"] } }],
  ["scorm_dom_evaluate", { description: "Execute arbitrary JavaScript in browser context and return JSON-serializable results", inputSchema: { type: "object", properties: { session_id: { type: "string" }, expression: { type: "string" }, return_by_value: { type: "boolean" } }, required: ["session_id", "expression"] } }],
  ["scorm_dom_wait_for", { description: "Wait for DOM condition to be met (element visible, text appears, attribute value, custom expression)", inputSchema: { type: "object", properties: { session_id: { type: "string" }, condition: { type: "object", properties: { selector: { type: "string" }, visible: { type: "boolean" }, text: { type: "string" }, attribute: { type: "string" }, attribute_value: { type: "string" }, expression: { type: "string" } } }, timeout_ms: { type: "number" } }, required: ["session_id", "condition"] } }],
  ["scorm_keyboard_type", { description: "Simulate keyboard typing in focused element with optional delay between keystrokes", inputSchema: { type: "object", properties: { session_id: { type: "string" }, text: { type: "string" }, options: { type: "object", properties: { selector: { type: "string" }, delay_ms: { type: "number" } } } }, required: ["session_id", "text"] } }],
  ["scorm_dom_find_interactive_elements", { description: "Discover all interactive elements on the current page - returns structured data about forms, buttons, inputs, and assessments with selectors and labels", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_dom_fill_form_batch", { description: "Fill multiple form fields in a single batch operation - reduces multiple scorm_dom_fill calls to one", inputSchema: { type: "object", properties: { session_id: { type: "string" }, fields: { type: "array", items: { type: "object", properties: { selector: { type: "string" }, value: { type: ["string", "boolean", "number"] }, options: { type: "object" } }, required: ["selector", "value"] } } }, required: ["session_id", "fields"] } }],
  ["scorm_dom_click_by_text", { description: "Click element by visible text with fuzzy matching - handles whitespace normalization automatically", inputSchema: { type: "object", properties: { session_id: { type: "string" }, text: { type: "string" }, options: { type: "object", properties: { exact_match: { type: "boolean" }, element_types: { type: "array", items: { type: "string" } } } } }, required: ["session_id", "text"] } }],

  // Network & Debugging
  ["scorm_get_data_model_history", { description: "Retrieve recorded SCORM data model change history for an open runtime session. Returns change count summary by default (limit 50); set include_changes=true for full change details. Use offset/limit for pagination.", inputSchema: { type: "object", properties: { session_id: { type: "string" }, since_ts: { type: "number" }, element_prefix: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] }, change_session_id: { type: "string" }, limit: { type: "number", minimum: 0 }, offset: { type: "number", minimum: 0 }, include_changes: { type: "boolean" } }, required: ["session_id"] } }],
  ["scorm_get_network_requests", { description: "Get network requests made by SCORM content with optional filtering by resource type and timestamp", inputSchema: { type: "object", properties: { session_id: { type: "string" }, options: { type: "object", properties: { resource_types: { type: "array", items: { type: "string" } }, since_ts: { type: "number" }, max_count: { type: "number" } } } }, required: ["session_id"] } }],
  ["scorm_validate_data_model_state", { description: "Validate current data model state against expected values - returns detailed diff with helpful hints for mismatches", inputSchema: { type: "object", properties: { session_id: { type: "string" }, expected: { type: "object" } }, required: ["session_id", "expected"] } }],
  ["scorm_get_console_errors", { description: "Get browser console errors/warnings from SCORM content - categorized by type (scorm_api, syntax, runtime, network). Returns error count by default (limit 50); set include_errors=true for full error details.", inputSchema: { type: "object", properties: { session_id: { type: "string" }, since_ts: { type: "number" }, severity: { type: "array", items: { type: "string", enum: ["error", "warn", "info"] } }, include_errors: { type: "boolean" }, limit: { type: "number" } }, required: ["session_id"] } }],
  ["scorm_compare_data_model_snapshots", { description: "Compare two data model snapshots and return detailed diff showing added, changed, unchanged, and removed elements", inputSchema: { type: "object", properties: { before: { type: "object" }, after: { type: "object" } }, required: ["before", "after"] } }],
  ["scorm_wait_for_api_call", { description: "Wait for a specific SCORM API call to occur - eliminates polling and arbitrary delays", inputSchema: { type: "object", properties: { session_id: { type: "string" }, method: { type: "string" }, timeout_ms: { type: "number" } }, required: ["session_id", "method"] } }],
  ["scorm_get_current_page_context", { description: "Get semantic information about current page - slide number, section title, page type, navigation availability", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_replay_api_calls", { description: "Replay a sequence of API calls to reproduce behavior - useful for debugging and testing", inputSchema: { type: "object", properties: { session_id: { type: "string" }, calls: { type: "array", items: { type: "object", properties: { method: { type: "string" }, args: { type: "array", items: {} } }, required: ["method"] } } }, required: ["session_id", "calls"] } }],
  ["scorm_get_page_state", { description: "Get comprehensive page state in a single call - includes page context, interactive elements, data model, console errors, and network requests", inputSchema: { type: "object", properties: { session_id: { type: "string" }, include: { type: "object", properties: { page_context: { type: "boolean" }, interactive_elements: { type: "boolean" }, data_model: { type: "boolean" }, console_errors: { type: "boolean" }, network_requests: { type: "boolean" } } } }, required: ["session_id"] } }],
  ["scorm_get_slide_map", { description: "Get slide map for single-SCO courses - discovers all slides with titles and IDs for easy navigation", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_navigate_to_slide", { description: "Navigate to a specific slide by index, ID, or title substring - works with single-SCO courses", inputSchema: { type: "object", properties: { session_id: { type: "string" }, slide_identifier: { type: ["string", "number"] } }, required: ["session_id", "slide_identifier"] } }],
  ["scorm_set_viewport_size", { description: "Set viewport size for content window - allows testing mobile and tablet layouts. Presets: Desktop (1366×768), Tablet (1024×1366), Mobile (390×844). Minimum: 320×240, Maximum: 7680×4320", inputSchema: { type: "object", properties: { width: { type: "number", minimum: 320, maximum: 7680 }, height: { type: "number", minimum: 240, maximum: 4320 } }, required: ["width", "height"] } }],

  // Template Automation API (requires compatible SCORM template with window.SCORMAutomation)
  ["scorm_automation_check_availability", { description: "Check if Template Automation API is available in the current course - call this first before using other automation tools", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_automation_list_interactions", { description: "List all registered interactive elements on the current slide using Template Automation API", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_automation_set_response", { description: "Set response for a specific interaction using Template Automation API - validates format and returns detailed errors if format is incorrect (e.g., true-false expects boolean, choice expects string/array, matching expects array of {source, target} objects)", inputSchema: { type: "object", properties: { session_id: { type: "string" }, id: { type: "string" }, response: {} }, required: ["session_id", "id", "response"] } }],
  ["scorm_automation_check_answer", { description: "Trigger evaluation for a single interaction using Template Automation API", inputSchema: { type: "object", properties: { session_id: { type: "string" }, id: { type: "string" } }, required: ["session_id", "id"] } }],
  ["scorm_automation_get_response", { description: "Get current response value for a specific interaction using Template Automation API", inputSchema: { type: "object", properties: { session_id: { type: "string" }, id: { type: "string" } }, required: ["session_id", "id"] } }],
  ["scorm_automation_get_course_structure", { description: "Get course slide structure as defined in course-config.js using Template Automation API", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_automation_get_current_slide", { description: "Get ID of currently active slide using Template Automation API", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_automation_go_to_slide", { description: "Navigate to specific slide using Template Automation API - accepts optional context parameter for navigation mode (e.g., {mode: 'review'})", inputSchema: { type: "object", properties: { session_id: { type: "string" }, slideId: { type: "string" }, context: { type: "object" } }, required: ["session_id", "slideId"] } }],
  ["scorm_automation_get_correct_response", { description: "Get correct answer for an interaction (requires exposeCorrectAnswers enabled) using Template Automation API", inputSchema: { type: "object", properties: { session_id: { type: "string" }, id: { type: "string" } }, required: ["session_id", "id"] } }],
  ["scorm_automation_get_last_evaluation", { description: "Get last evaluation result without re-triggering evaluation using Template Automation API", inputSchema: { type: "object", properties: { session_id: { type: "string" }, id: { type: "string" } }, required: ["session_id", "id"] } }],
  ["scorm_automation_check_slide_answers", { description: "Evaluate all interactions on specified slide (or current slide if omitted) using Template Automation API. Note: The template determines which interactions are 'on' the slide - hidden interactions (e.g., in inactive tabs) may not be included. Use scorm_automation_list_interactions to see all interactions, or check individually with scorm_automation_check_answer.", inputSchema: { type: "object", properties: { session_id: { type: "string" }, slideId: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_automation_get_trace", { description: "Get automation action trace log using Template Automation API", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_automation_clear_trace", { description: "Clear automation action trace log using Template Automation API", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_automation_get_interaction_metadata", { description: "Get metadata for a specific interaction (id, type, registeredAt) using Template Automation API", inputSchema: { type: "object", properties: { session_id: { type: "string" }, id: { type: "string" } }, required: ["session_id", "id"] } }],
  ["scorm_automation_get_version", { description: "Get API version information including API version, phase number, and feature list using Template Automation API", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_automation_get_page_layout", { description: "Get comprehensive page layout in a single call (AI-optimized) - returns tree structure, viewport info, patterns, relationships, and human-readable description. This is the flagship method for understanding layout without screenshots.", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_automation_get_layout_flow", { description: "Get navigation flow analysis including reading order, keyboard/tab flow, attention flow, and analysis of mismatches - essential for accessibility testing", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_automation_get_layout_tree", { description: "Get a simplified layout tree of the current slide's structure using Template Automation API - useful for visual regression testing and debugging layout issues", inputSchema: { type: "object", properties: { session_id: { type: "string" }, max_depth: { type: "number", minimum: 1, maximum: 10 } }, required: ["session_id"] } }],
  ["scorm_automation_get_element_details", { description: "Get detailed layout and style information for a specific element by data-testid using Template Automation API - includes bounding box, computed styles, and visibility status", inputSchema: { type: "object", properties: { session_id: { type: "string" }, testid: { type: "string" } }, required: ["session_id", "testid"] } }],
  ["scorm_automation_validate_page_layout", { description: "Validate current page layout and return potential issues using Template Automation API - detects off-screen content, overlapping elements, text overflow, WCAG AA contrast violations, and zero-size elements", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],

  // Engagement Tracking (requires compatible SCORM template with engagement tracking enabled)
  ["scorm_engagement_get_state", { description: "Get engagement tracking state for current slide - includes completion status, requirements config, and tracked metrics (tabs viewed, interactions completed, scroll depth, time spent)", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_engagement_get_progress", { description: "Get user-friendly engagement progress for current slide - returns percentage complete and list of requirement items with completion status", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],
  ["scorm_engagement_mark_tab_viewed", { description: "Manually mark a tab as viewed (for testing purposes) - simulates user viewing a tab to test engagement tracking", inputSchema: { type: "object", properties: { session_id: { type: "string" }, tab_id: { type: "string" } }, required: ["session_id", "tab_id"] } }],
  ["scorm_engagement_set_scroll_depth", { description: "Manually set scroll depth percentage (for testing purposes) - simulates user scrolling to test engagement tracking", inputSchema: { type: "object", properties: { session_id: { type: "string" }, percentage: { type: "number", minimum: 0, maximum: 100 } }, required: ["session_id", "percentage"] } }],
  ["scorm_engagement_reset", { description: "Reset engagement state for current slide (for testing purposes) - clears all tracked engagement metrics", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }],

  // System Logging & Diagnostics
  ["system_get_logs", { description: "Get recent log entries in NDJSON format - includes browser console errors/warnings and all application logs with filtering by level/timestamp/component", inputSchema: { type: "object", properties: { tail: { type: "number" }, levels: { type: "array", items: { type: "string" } }, since_ts: { type: "number" }, component: { type: "string" } } } }],
      ["system_set_log_level", { description: "Set application log level (debug|info|warn|error)", inputSchema: { type: "object", properties: { level: { type: "string", enum: ["debug", "info", "warn", "error"] } }, required: ["level"] } }],
    ]);  
  router.register("scorm_echo", scorm_echo);
  
  // New unified course management
  router.register("scorm_open_course", scorm_open_course);
  router.register("scorm_close_course", scorm_close_course);
  router.register("scorm_reload_course", scorm_reload_course);
  router.register("scorm_clear_saved_data", scorm_clear_saved_data);
  router.register("scorm_course_status", scorm_course_status);
  
  // Legacy (deprecated)
  router.register("scorm_session_open", scorm_session_open);
  router.register("scorm_session_close", scorm_session_close);
  router.register("scorm_lint_manifest", scorm_lint_manifest);
  router.register("scorm_lint_api_usage", scorm_lint_api_usage);
  router.register("scorm_lint_parent_dom_access", scorm_lint_parent_dom_access);
  router.register("scorm_validate_workspace", scorm_validate_workspace);
  router.register("scorm_lint_sequencing", scorm_lint_sequencing);
  router.register("scorm_validate_compliance", scorm_validate_compliance);
  router.register("scorm_runtime_open", scorm_runtime_open);
  router.register("scorm_runtime_status", scorm_runtime_status);
  router.register("scorm_api_call", scorm_api_call);
  router.register("scorm_data_model_get", scorm_data_model_get);
  router.register("scorm_assessment_interaction_trace", scorm_assessment_interaction_trace);
  router.register("scorm_capture_screenshot", scorm_capture_screenshot);
  router.register("scorm_nav_get_state", scorm_nav_get_state);
  router.register("scorm_nav_next", scorm_nav_next);
  router.register("scorm_nav_previous", scorm_nav_previous);
  router.register("scorm_nav_choice", scorm_nav_choice);
  router.register("scorm_sn_init", scorm_sn_init);
  router.register("scorm_sn_reset", scorm_sn_reset);
  router.register("scorm_trace_sequencing", scorm_trace_sequencing);
  router.register("scorm_get_data_model_history", scorm_get_data_model_history);
  router.register("scorm_get_network_requests", scorm_get_network_requests);
  router.register("scorm_validate_data_model_state", scorm_validate_data_model_state);
  router.register("scorm_get_console_errors", scorm_get_console_errors);
  router.register("scorm_compare_data_model_snapshots", scorm_compare_data_model_snapshots);
  router.register("scorm_wait_for_api_call", scorm_wait_for_api_call);
  router.register("scorm_get_current_page_context", scorm_get_current_page_context);
  router.register("scorm_replay_api_calls", scorm_replay_api_calls);
  router.register("scorm_dom_click", scorm_dom_click);
  router.register("scorm_dom_fill", scorm_dom_fill);
  router.register("scorm_dom_query", scorm_dom_query);
  router.register("scorm_dom_evaluate", scorm_dom_evaluate);
  router.register("scorm_dom_wait_for", scorm_dom_wait_for);
  router.register("scorm_keyboard_type", scorm_keyboard_type);
  router.register("scorm_dom_find_interactive_elements", scorm_dom_find_interactive_elements);
  router.register("scorm_dom_fill_form_batch", scorm_dom_fill_form_batch);
  router.register("scorm_dom_click_by_text", scorm_dom_click_by_text);
  router.register("scorm_get_page_state", scorm_get_page_state);
  router.register("scorm_get_slide_map", scorm_get_slide_map);
  router.register("scorm_navigate_to_slide", scorm_navigate_to_slide);
  router.register("scorm_set_viewport_size", scorm_set_viewport_size);
  router.register("scorm_automation_check_availability", scorm_automation_check_availability);
  router.register("scorm_automation_list_interactions", scorm_automation_list_interactions);
  router.register("scorm_automation_set_response", scorm_automation_set_response);
  router.register("scorm_automation_check_answer", scorm_automation_check_answer);
  router.register("scorm_automation_get_response", scorm_automation_get_response);
  router.register("scorm_automation_get_course_structure", scorm_automation_get_course_structure);
  router.register("scorm_automation_get_current_slide", scorm_automation_get_current_slide);
  router.register("scorm_automation_go_to_slide", scorm_automation_go_to_slide);
  router.register("scorm_automation_get_correct_response", scorm_automation_get_correct_response);
  router.register("scorm_automation_get_last_evaluation", scorm_automation_get_last_evaluation);
  router.register("scorm_automation_check_slide_answers", scorm_automation_check_slide_answers);
  router.register("scorm_automation_get_trace", scorm_automation_get_trace);
  router.register("scorm_automation_clear_trace", scorm_automation_clear_trace);
  router.register("scorm_automation_get_interaction_metadata", scorm_automation_get_interaction_metadata);
  router.register("scorm_automation_get_version", scorm_automation_get_version);
  router.register("scorm_automation_get_page_layout", scorm_automation_get_page_layout);
  router.register("scorm_automation_get_layout_flow", scorm_automation_get_layout_flow);
  router.register("scorm_automation_get_layout_tree", scorm_automation_get_layout_tree);
  router.register("scorm_automation_get_element_details", scorm_automation_get_element_details);
  router.register("scorm_automation_validate_page_layout", scorm_automation_validate_page_layout);
  router.register("scorm_engagement_get_state", scorm_engagement_get_state);
  router.register("scorm_engagement_get_progress", scorm_engagement_get_progress);
  router.register("scorm_engagement_mark_tab_viewed", scorm_engagement_mark_tab_viewed);
  router.register("scorm_engagement_set_scroll_depth", scorm_engagement_set_scroll_depth);
  router.register("scorm_engagement_reset", scorm_engagement_reset);
  router.register("scorm_report", scorm_report);  
  // System tools for logs and log level control
  async function system_get_logs(params = {}) {
    const { tail = 200, levels = [], since_ts = 0, component = null } = params;
    const file = (logger && logger.ndjsonFile) ? logger.ndjsonFile : (logger && logger.logFile);
  if (!file) return { logs: [], note: 'No log file available' };

  const logDir = logger && logger.ndjsonFile ? path.dirname(logger.ndjsonFile) : null;
  const allLogFiles = logDir ? {
    ndjson: logger.ndjsonFile,
    errors: logger.errorsFile,
    human_readable: logger.logFile
  } : null;

  try {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    const slice = lines.slice(-Math.max(0, Math.min(tail, lines.length)));
    const out = [];
    for (const line of slice) {
      try {
        const obj = JSON.parse(line);
        if (since_ts && obj.ts && obj.ts < since_ts) continue;
        if (Array.isArray(levels) && levels.length && obj.level && !levels.includes(obj.level)) continue;
        if (component && obj.component !== component) {
          // allow pass if no component specified in entry
          continue;
        }
        out.push(obj);
      } catch (_) {
        // skip non-JSON lines
      }
    }
    return {
      logs: out,
      log_count: out.length,
      total_lines: lines.length,
      log_directory: logDir,
      log_files: allLogFiles,
      note: 'Includes browser console errors/warnings from SCORM content, application logs, and all MCP operations. Logs are flushed immediately to disk.',
      filters_applied: {
        tail,
        levels: levels.length > 0 ? levels : 'all',
        since_ts: since_ts || 'none',
        component: component || 'all'
      }
    };
  } catch (e) {
    return {
      logs: [],
      error: e.message,
      log_directory: logDir,
      log_files: allLogFiles
    };
  }
}

async function system_set_log_level(params = {}) {
  const { level } = params;
  if (!level) return { success: false, error: 'missing level' };
  try {
    if (logger && typeof logger.setLevel === 'function') {
      logger.setLevel(level);
      logger.info('Log level updated via MCP', { level });
      return { success: true, level };
    }
    return { success: false, error: 'logger not available' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

router.register('system_get_logs', system_get_logs);
router.register('system_set_log_level', system_set_log_level);

  // JSON-RPC helpers (for MCP-compatible clients like Kilo Code)
  function writeJSONRPCResult(id, result) {
    try { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n"); } catch (_) { /* intentionally empty */ }
  }
  function writeJSONRPCError(id, code, message, data) {
    const err = { code, message };
    if (data !== undefined) err.data = data;
    try { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: err }) + "\n"); } catch (_) { /* intentionally empty */ }
  }


async function handleRequest(req) {

  // Detect JSON-RPC 2.0 shape
  const isJSONRPC = req && req.jsonrpc === "2.0";
  const id = req && ("id" in req) ? req.id : undefined;
  const method = req && req.method;
  const params = (req && req.params) || {};

  if (!method || typeof method !== "string") {
    // Enforce JSON-RPC 2.0 only
    return writeJSONRPCError(id ?? null, -32600, "Invalid Request");
  }

  // JSON-RPC compatibility for MCP clients (Kilo Code expects initialize/tools/*)
  if (isJSONRPC) {
    try {
      if (method === "initialize") {
        const result = {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "SCORM MCP", version: "1.0.0" },
          capabilities: { tools: { listChanged: true } }
        };
        return writeJSONRPCResult(id, result);
      }
      if (method === "tools/list") {
        const tools = [];
        try {
          for (const name of router.tools.keys()) {
            const meta = TOOL_META.get(name) || {};
            const tool = {
              name,
              description: meta.description || "SCORM MCP tool",
              inputSchema: meta.inputSchema || { type: "object" }
            };
            // Only include outputSchema if explicitly defined in TOOL_META
            // MCP requires structured content format when outputSchema is present
            if (meta.outputSchema) {
              tool.outputSchema = meta.outputSchema;
            }
            tools.push(tool);
          }
        } catch (_) { /* intentionally empty */ }
        return writeJSONRPCResult(id, { tools });
      }
      if (method === "tools/call") {
        const name = params && (params.name || params.toolName || params.tool);
        const args = (params && (params.arguments || params.args)) || {};
        if (!name || typeof name !== "string") {
          return writeJSONRPCError(id, -32602, "Invalid params: missing tool name");
        }
        try {
          logger?.info('MCP_TOOLS_CALL', { id, method: name, argsMeta: { keys: Object.keys(args||{}), hasArgs: !!args } });
          const toolResult = await router.dispatch(name, args);
          logger?.info('MCP_TOOLS_RESULT', { id, method: name, ok: true });

          // Convert tool result to MCP format: { content: [...], isError: false }
          // Tools return plain objects, so we wrap them in MCP's content array format
          const mcpResult = {
            content: [
              {
                type: "text",
                text: JSON.stringify(toolResult, null, 2)
              }
            ],
            isError: false
          };

          return writeJSONRPCResult(id, mcpResult);
        } catch (err) {
          const mapped = mapError(err);
          logger?.error('MCP_TOOLS_ERROR', { id, method: name, error_code: mapped.error_code, message: mapped.message });

          // Return error in MCP format
          const mcpError = {
            content: [
              {
                type: "text",
                text: mapped.message || "Tool error"
              }
            ],
            isError: true
          };

          return writeJSONRPCResult(id, mcpError);
        }
      }

      // Fallback: allow direct method names over JSON-RPC too
      try {
        logger?.info('MCP_DIRECT_CALL', { id, method, hasParams: !!params });
        const data = await router.dispatch(method, params);
        logger?.info('MCP_DIRECT_RESULT', { id, method, ok: true });
        return writeJSONRPCResult(id, { data });
      } catch (err) {
        // It's a notification if id is undefined.
        const isNotification = id === undefined;
        // If it's an unknown notification, just ignore it.
        if (isNotification && !router.has(method)) {
          logger?.warn('MCP_IGNORED_UNKNOWN_NOTIFICATION', { method });
          return;
        }

        // Standard JSON-RPC method not found if unknown
        if (!router.has(method)) {
          logger?.warn('MCP_DIRECT_UNKNOWN', { id, method });
          return writeJSONRPCError(id, -32601, `Method not found: ${method}`);
        }
        const mapped = mapError(err);
        logger?.error('MCP_DIRECT_ERROR', { id, method, error_code: mapped.error_code, message: mapped.message });
        return writeJSONRPCError(id, -32000, mapped.message || "Server error", { error_code: mapped.error_code });
      }
    } catch (err) {
      return writeJSONRPCError(id, -32000, (err && err.message) || "Server error");
    }
  }

  // If we reach here, the request was not JSON-RPC 2.0; reject.
  return writeJSONRPCError(id ?? null, -32600, "Invalid Request: JSON-RPC 2.0 required");
}

function startServer() {
  // Read newline-delimited JSON from stdin
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.resume(); // Keep stdin in flowing mode

  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        // Log incoming request to stderr for debugging
        logger?.debug('MCP_REQUEST_RECEIVED', msg);
        handleRequest(msg);
      } catch (err) {
        // Log parse error to stderr
        logger?.error('MCP_PARSE_ERROR', { line: line.substring(0, 100), error: err.message });
        // Strict JSON-RPC 2.0: parse errors use -32700 and null id
        writeJSONRPCError(null, -32700, "Parse error");
      }
    }
  });

  process.stdin.on("end", () => {
    // stdin closed - MCP client disconnected
    // Cleanup is handled by node-bridge.js process exit handlers
    process.exit(0);
  });

  // Ensure we exit cleanly on SIGINT/SIGTERM (tests/CI)
  // Cleanup is handled by node-bridge.js signal handlers
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));

}

if (require.main === module) {
  startServer();
}

module.exports = { startServer, router };

